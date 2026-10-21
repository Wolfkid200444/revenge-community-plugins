package me.palmdevs.revenge.whoreacted

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextSwitcher
import android.widget.TextView
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.WeakHashMap

private const val SHORTCUTS_FLEXBOX = "com.discord.reactions.ShortcutsFlexbox"
private const val CHAT_LIST_VIEW_MANAGER = "com.discord.chat.presentation.list.ChatListViewManager"

/** Avatar LRU cache. */
private const val CACHE_CAPACITY = 2000

/** Adds the avatars JS stored to the reaction pills of chat messages. */
@Suppress("CanConvertToMultiDollarString")
internal class ReactionHooks(dexFinder: DexFinder) {
    private val avatars = object : LinkedHashMap<String, List<String>>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<String>>) = size > CACHE_CAPACITY
    }

    /** The reaction a pill shows, and how many reacted. */
    private data class Bound(val key: String, val count: Int)

    // Changed on the main thread only, also read by JS for [shownKeys]
    private val bound = WeakHashMap<LinearLayout, Bound>()
    // Main thread only
    private val stacks = WeakHashMap<LinearLayout, AvatarStack>()

    private val bindingMessageId = ThreadLocal<String?>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val draweeConstructor = AvatarStack.draweeConstructor(dexFinder.classLoader)

    private val chatListView = dexFinder.classLoader.loadClass(CHAT_LIST_VIEW_MANAGER).declaredMethods
        .single { it.name == "setFloatingChatInputEnabled" && !it.isBridge }
        .parameterTypes[0]

    // Message accessories (reactions, forum post actions, ...) carry their message ID
    private val accessoryClass = dexFinder.findClass {
        matcher { usingEqStrings("messageId", "accessoryDescription") }
    } ?: error("MessageAccessory not found")
    private val accessoryMessageId = dexFinder.findMethod {
        matcher {
            declaredClass(accessoryClass.name)
            paramCount(0)
            returnType(String::class.java)
        }
    } ?: error("MessageAccessory.getMessageId not found")

    private val emojiClass = dexFinder.findClass {
        matcher { addUsingString("MessageReactionEmoji(name=") }
    } ?: error("MessageReactionEmoji not found")

    private val reactionInterface = dexFinder.findClass {
        matcher {
            modifiers(Modifier.INTERFACE)
            addMethod { name("getCount") }
            addMethod { returnType(emojiClass.name) }
        }
    } ?: error("ReactionView.Reaction not found")
    private val getCount = reactionInterface.getMethod("getCount")
    private val getEmoji = reactionInterface.methods.single { it.returnType == emojiClass }
    private val getBurstCount = reactionInterface.methods
        .single { it.returnType == Int::class.javaPrimitiveType && it.parameterCount == 0 && it != getCount }

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        // [MessageAccessoriesAdapter.onBindViewHolder] binds reactions via [ShortcutsFlexbox.setReactions].
        // Pills only see individual reactions, so take message ID from bound accessory.
        val onBindViewHolder = dexFinder.findMethod {
            matcher {
                paramCount(2)
                usingEqStrings("reactions", "addNewReactionAccessibilityLabel")
            }
        } ?: error("MessageAccessoriesAdapter.onBindViewHolder not found")
        val adapterItems = dexFinder.findField {
            matcher {
                declaredClass(onBindViewHolder.declaringClass.name)
                type(List::class.java)
            }
        } ?: error("MessageAccessoriesAdapter.items not found")

        val setReactions = dexFinder.findMethod {
            matcher {
                declaredClass(SHORTCUTS_FLEXBOX)
                usingEqStrings("reactions", "addNewReactionAccessibilityLabel")
            }
        } ?: error("ShortcutsFlexbox.setReactions not found")

        unhooks = listOf(
            onBindViewHolder.hook(
                before = { param ->
                    val item = (adapterItems.get(param.thisObject) as List<*>?)?.getOrNull(param.args[1] as Int)
                    if (accessoryClass.isInstance(item)) bindingMessageId.set(accessoryMessageId.invoke(item) as String?)
                },
                after = { bindingMessageId.remove() },
            ),
            setReactions.hook(after = { param ->
                val flexbox = param.thisObject as ViewGroup
                val pills = pills(param.args[0] as List<*>)
                val messageId = bindingMessageId.get()

                for (i in 0 until flexbox.childCount) {
                    val view = flexbox.getChildAt(i) as? LinearLayout ?: continue
                    val pill = pills.getOrNull(i)
                    // Pills past the reactions are hidden ones Discord keeps for reuse
                    if (pill == null || messageId == null || pill.count == 0 || !emojiClass.isInstance(pill.emoji)) {
                        synchronized(bound) { bound.remove(view) }
                        render(view, emptyList(), 0)
                        continue
                    }

                    val key = reactionKey(messageId, emojiKey(pill.emoji!!), pill.burst)
                    synchronized(bound) { bound[view] = Bound(key, pill.count) }
                    render(view, synchronized(avatars) { avatars[key] }.orEmpty(), pill.count)
                }
            }),
        )
    }

    private class Pill(val emoji: Any?, val burst: Boolean, val count: Int)

    private fun pills(reactions: List<*>): List<Pill> = reactions.flatMap { reaction ->
        val count = getCount.invoke(reaction) as Int
        val burstCount = getBurstCount.invoke(reaction) as Int
        val emoji = getEmoji.invoke(reaction)
        when {
            // both types
            burstCount > 0 && count > 0 -> listOf(Pill(emoji, true, burstCount), Pill(emoji, false, count))
            burstCount > 0 -> listOf(Pill(emoji, true, burstCount))
            else -> listOf(Pill(emoji, false, count))
        }
    }

    /**
     * The emoji's ID, or its name if it has none, matching JS' keys.
     * Since this is a data class, we can toString to get the field values.
     */
    private fun emojiKey(emoji: Any): String? {
        val text = emoji.toString()
        val id = ID_PATTERN.find(text)?.groupValues?.get(1)?.takeIf { it != "null" }
        return id ?: NAME_PATTERN.find(text)?.groupValues?.get(1)
    }

    /** Stores avatars from JS, and updates pills already showing their reactions. */
    fun put(json: String) {
        val updates = JSONObject(json).let { obj ->
            obj.keys().asSequence().associateWith { key ->
                val urls = obj.getJSONArray(key)
                List(urls.length()) { urls.getString(it) }
            }
        }

        synchronized(avatars) { avatars.putAll(updates) }

        mainHandler.post {
            val rendered = synchronized(bound) {
                bound.mapNotNull { (view, reaction) ->
                    updates[reaction.key]?.let { render(view, it, reaction.count); view }
                }
            }
            relayout(rendered)
        }
    }

    /**
     * Lays out the chat lists of [views] again, so their pills fit their new avatars.
     *
     * React Native ignores layout requests from native views, Discord does this after its own updates too
     * (`ChatListView.measureAndLayout`). Views with a pending layout request are measured again.
     */
    private fun relayout(views: List<View>) {
        val lists = views.mapNotNullTo(HashSet()) { view ->
            generateSequence(view.parent) { it.parent }.firstOrNull(chatListView::isInstance) as View?
        }

        for (list in lists) {
            list.measure(
                View.MeasureSpec.makeMeasureSpec(list.width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(list.height, View.MeasureSpec.EXACTLY),
            )
            list.layout(list.left, list.top, list.right, list.bottom)
        }
    }

    /** Reactions of pills on screen, as a JSON array of keys. JS fetches these first. */
    fun shownKeys(): String = synchronized(bound) {
        JSONArray(bound.filterKeys { it.isAttachedToWindow }.values.map { it.key }.distinct()).toString()
    }

    fun clear() {
        synchronized(avatars) { avatars.clear() }
        mainHandler.post {
            synchronized(bound) {
                for (view in bound.keys) render(view, emptyList(), 0)
            }
        }
    }

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        synchronized(avatars) { avatars.clear() }
        mainHandler.post {
            for ((view, stack) in stacks) view.removeView(stack)
            stacks.clear()
            synchronized(bound) { bound.clear() }
        }
    }

    private fun render(view: LinearLayout, urls: List<String>, count: Int) {
        val stack = stacks[view]
        if (urls.isEmpty()) {
            stack?.visibility = View.GONE
            return
        }

        (stack ?: AvatarStack(view.context, draweeConstructor).also {
            view.addView(it, AvatarStack.layoutParams(view.context))
            stacks[view] = it
        }).apply {
            visibility = View.VISIBLE
            val countText = countText(view)
            setAvatars(urls, count, countText?.currentTextColor ?: 0, countText?.typeface)
        }
    }

    // Count view supplying color and font for "+N" pill
    private fun countText(view: ViewGroup): TextView? {
        for (i in 0 until view.childCount) {
            val child = view.getChildAt(i)
            if (child is TextSwitcher) return child.currentView as? TextView
        }
        return null
    }

    private companion object {
        val ID_PATTERN = Regex(""", id=([^,)]*)""")
        val NAME_PATTERN = Regex("""\(name=(.*?), src=""")
    }
}

/** Must match `reactionKey` in JS. */
private fun reactionKey(messageId: String, emoji: String?, burst: Boolean) =
    "$messageId:$emoji:${if (burst) 1 else 0}"

private inline fun Method.hook(
    crossinline before: (XC_MethodHook.MethodHookParam) -> Unit = {},
    crossinline after: (XC_MethodHook.MethodHookParam) -> Unit = {},
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = before(param)
    override fun afterHookedMethod(param: MethodHookParam) = after(param)
})
