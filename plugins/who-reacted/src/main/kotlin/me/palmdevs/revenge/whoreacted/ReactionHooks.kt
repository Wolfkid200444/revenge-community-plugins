package me.palmdevs.revenge.whoreacted

import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Method
import java.util.WeakHashMap

private const val CHAT = "com.discord.chat"
private const val CHAT_LIST_VIEW = "$CHAT.presentation.list.ChatListView"
private const val ACCESSORIES_ADAPTER = "$CHAT.presentation.message.MessageAccessoriesAdapter"
private const val MESSAGE_PART_HOLDER = "$CHAT.presentation.message.viewholder.MessagePartViewHolder"
private const val REACTIONS_HOLDER = "$CHAT.presentation.message.viewholder.ReactionsViewHolder"
private const val MESSAGE_REACTION_EMOJI = "$CHAT.bridge.reaction.MessageReactionEmoji"
private const val REACTION_VIEW = "com.discord.reactions.ReactionView"
private const val REACTION_VIEW_BINDING = "com.discord.reactions.databinding.ReactionViewBinding"

/** Avatar LRU cache. */
private const val CACHE_CAPACITY = 2000

/** Adds the avatars JS stored to the reaction pills of chat messages. */
@Suppress("CanConvertToMultiDollarString")
internal class ReactionHooks(classLoader: ClassLoader) {
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
    private val draweeConstructor = AvatarStack.draweeConstructor(classLoader)

    private val chatListView = classLoader.loadClass(CHAT_LIST_VIEW)
    private val reactionsHolder = classLoader.loadClass(REACTIONS_HOLDER)
    private val adapterMessageId = classLoader.loadClass(ACCESSORIES_ADAPTER).getDeclaredField("messageId")
        .apply { isAccessible = true }
    private val emojiClass = classLoader.loadClass(MESSAGE_REACTION_EMOJI)
    private val emojiId = emojiClass.getMethod("getId")
    private val emojiName = emojiClass.getMethod("getName")

    // The pill's count, whose color and font the "+N" pill takes
    private val reactionViewBinding = classLoader.loadClass(REACTION_VIEW).getDeclaredField("binding")
        .apply { isAccessible = true }
    private val reactionCount = classLoader.loadClass(REACTION_VIEW_BINDING).getField("reactionCount1")

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        // [MessageAccessoriesAdapter.onBindViewHolder] binds a message's reactions with [ReactionsViewHolder.bind], which sets each pill with [ReactionView.setReaction].
        val adapter = classLoader.loadClass(ACCESSORIES_ADAPTER)
        val onBindViewHolder = adapter.getDeclaredMethod(
            "onBindViewHolder",
            classLoader.loadClass(MESSAGE_PART_HOLDER),
            Int::class.javaPrimitiveType,
        )

        // The pill only sees the reaction. The message ID is taken from the adapter.
        val reactionView = classLoader.loadClass(REACTION_VIEW)
        val reactionInterface = classLoader.loadClass("$REACTION_VIEW\$Reaction")
        val setReaction = reactionView.getDeclaredMethod(
            "setReaction",
            reactionInterface,
            classLoader.loadClass("$REACTION_VIEW\$ReactionsTheme"),
        )
        val getEmoji = reactionInterface.getMethod("getEmoji")
        val getCount = reactionInterface.getMethod("getCount")
        val getBurstCount = reactionInterface.getMethod("getBurstCount")

        unhooks = listOf(
            onBindViewHolder.hook(
                before = { param ->
                    if (reactionsHolder.isInstance(param.args[0]))
                        bindingMessageId.set(adapterMessageId.get(param.thisObject) as String?)
                },
                after = { bindingMessageId.remove() },
            ),
            setReaction.hook(after = { param ->
                val view = param.thisObject as LinearLayout
                val reaction = param.args[0]
                val burstCount = getBurstCount.invoke(reaction) as Int
                // Discord shows reactions with both types as two pills, the burst one has a burst count
                val burst = burstCount > 0
                val count = if (burst) burstCount else getCount.invoke(reaction) as Int

                val messageId = bindingMessageId.get()
                val emoji = getEmoji.invoke(reaction)
                if (messageId == null || count == 0 || !emojiClass.isInstance(emoji)) {
                    synchronized(bound) { bound.remove(view) }
                    render(view, emptyList(), 0)
                    return@hook
                }

                val key = reactionKey(messageId, (emojiId.invoke(emoji) ?: emojiName.invoke(emoji)) as String?, burst)
                synchronized(bound) { bound[view] = Bound(key, count) }
                render(view, synchronized(avatars) { avatars[key] }.orEmpty(), count)
            }),
        )
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
            val countText = reactionCount.get(reactionViewBinding.get(view)) as TextView
            setAvatars(urls, count, countText.currentTextColor, countText.typeface)
        }
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
