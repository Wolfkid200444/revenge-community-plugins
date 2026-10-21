package me.palmdevs.revenge.showtimeoutduration

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.RelativeLayout
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import org.json.JSONObject
import java.util.WeakHashMap

private const val MESSAGE_VIEW = "com.discord.chat.presentation.message.MessageView"
private const val MESSAGE = "com.discord.chat.bridge.Message"

/** LRU cache. */
private const val CACHE_CAPACITY = 2000

/** Adds a [TimeoutLine] above the author of chat messages whose author is timed out. */
internal class TimeoutHooks(dexFinder: DexFinder) {
    private val ends = object : LinkedHashMap<String, Long>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>) = size > CACHE_CAPACITY
    }

    // Main thread only
    private val lines = WeakHashMap<RelativeLayout, TimeoutLine>()
    private var ids: ViewIds? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val style = TimeoutLine.Style(dexFinder)

    private val messageIdField = dexFinder.classLoader.loadClass(MESSAGE).getDeclaredField("id")
        .apply { isAccessible = true }

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        val setMessage = dexFinder.findMethod {
            matcher {
                declaredClass(MESSAGE_VIEW)
                usingEqStrings("message", "messageContext", "eventHandler")
            }
        } ?: error("MessageView.setMessage not found")

        unhooks = listOf(XposedBridge.hookMethod(setMessage, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val view = param.thisObject as RelativeLayout
                val id = messageIdField.get(param.args[0]) as String
                val ids = ids ?: ViewIds(view).also { ids = it }
                val header = view.childWithId(ids.header) ?: return

                // Only messages that start a group show their author
                val showsAuthor = header.findViewById<View>(ids.authorName)?.visibility == View.VISIBLE
                val end = synchronized(ends) { ends[id] }?.takeIf { showsAuthor && it > System.currentTimeMillis() }

                val line = lines[view]
                    ?: if (end != null) insertLine(view, header, header.findViewById(ids.timeoutIcon) ?: return) else return
                line.bind(id, showsAuthor, end)
            }
        }))
    }

    /** IDs of the message views Discord's binding holds. R8 merged the binding classes, the IDs keep their names. */
    private class ViewIds(view: View) {
        val header = view.idOf("header")
        val authorName = view.idOf("author_name")
        val timeoutIcon = view.idOf("guild_communication_disabled_icon")
    }

    /** Stores timeout ends from JS, and updates lines already showing their messages. */
    fun put(json: String) {
        val updates = JSONObject(json).let { obj -> obj.keys().asSequence().associateWith { obj.getLong(it) } }
        synchronized(ends) { ends.putAll(updates) }

        mainHandler.post {
            for (line in lines.values) {
                val id = line.messageId ?: continue
                updates[id]?.let { line.bind(id, line.showsAuthor, it.takeIf { end -> end > 0 }) }
            }
        }
    }

    /** Sets the colors JS resolved from Discord's theme, and recolors lines already showing. */
    fun setColors(text: Int, icon: Int) {
        style.colors = TimeoutLine.Colors(text, icon)
        mainHandler.post {
            for (line in lines.values) line.recolor()
        }
    }

    fun clear() {
        synchronized(ends) { ends.clear() }
        mainHandler.post {
            for (line in lines.values) line.bind(null, false, null)
        }
    }

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        synchronized(ends) { ends.clear() }
        mainHandler.post {
            for ((view, line) in lines) line.remove(view)
            lines.clear()
        }
    }

    private fun insertLine(view: RelativeLayout, header: View, timeoutIcon: View): TimeoutLine {
        val headerParams = header.layoutParams as RelativeLayout.LayoutParams
        val line = TimeoutLine(
            view.context,
            style,
            header,
            headerParams.rules[RelativeLayout.BELOW],
            timeoutIcon,
        )

        view.addView(line, RelativeLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            addRule(RelativeLayout.BELOW, line.below)
            marginStart = headerParams.marginStart
        })

        headerParams.addRule(RelativeLayout.BELOW, line.id)
        header.layoutParams = headerParams

        lines[view] = line
        return line
    }
}

@Suppress("DiscouragedApi")
private fun View.idOf(name: String) = resources.getIdentifier(name, "id", context.packageName)

// Not findViewById, as nested messages (such as replies) have views with the same IDs
private fun ViewGroup.childWithId(id: Int): View? =
    (0 until childCount).asSequence().map(::getChildAt).firstOrNull { it.id == id }
