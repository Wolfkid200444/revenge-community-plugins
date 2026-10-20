package me.palmdevs.revenge.showtimeoutduration

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.RelativeLayout
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import org.json.JSONObject
import java.util.WeakHashMap

private const val MESSAGE_VIEW = "com.discord.chat.presentation.message.MessageView"
private const val MESSAGE_VIEW_BINDING = "com.discord.chat.databinding.MessageViewBinding"
private const val MESSAGE = "com.discord.chat.bridge.Message"

/** LRU cache. */
private const val CACHE_CAPACITY = 2000

/** Adds a [TimeoutLine] above the author of chat messages whose author is timed out. */
internal class TimeoutHooks(classLoader: ClassLoader) {
    private val ends = object : LinkedHashMap<String, Long>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>) = size > CACHE_CAPACITY
    }

    // Main thread only
    private val lines = WeakHashMap<RelativeLayout, TimeoutLine>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val style = TimeoutLine.Style(classLoader)

    private val messageView = classLoader.loadClass(MESSAGE_VIEW)
    private val messageIdField = classLoader.loadClass(MESSAGE).getDeclaredField("id").apply { isAccessible = true }
    private val bindingField = messageView.getDeclaredField("binding").apply { isAccessible = true }
    private val bindingClass = classLoader.loadClass(MESSAGE_VIEW_BINDING)
    private val header = bindingClass.getField("header")
    private val authorName = bindingClass.getField("authorName")
    private val timeoutIcon = bindingClass.getField("guildCommunicationDisabledIcon")

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        val setMessage = messageView.declaredMethods.single { it.name == "setMessage" }

        unhooks = listOf(XposedBridge.hookMethod(setMessage, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val view = param.thisObject as RelativeLayout
                val id = messageIdField.get(param.args[0]) as String
                val binding = bindingField.get(view) ?: return

                // Only messages that start a group show their author
                val showsAuthor = (authorName.get(binding) as View).visibility == View.VISIBLE
                val end = synchronized(ends) { ends[id] }?.takeIf { showsAuthor && it > System.currentTimeMillis() }

                val line = lines[view] ?: if (end != null) insertLine(view, binding) else return
                line.bind(id, showsAuthor, end)
            }
        }))
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

    private fun insertLine(view: RelativeLayout, binding: Any): TimeoutLine {
        val header = header.get(binding) as View
        val headerParams = header.layoutParams as RelativeLayout.LayoutParams
        val line = TimeoutLine(
            view.context,
            style,
            header,
            headerParams.rules[RelativeLayout.BELOW],
            timeoutIcon.get(binding) as View,
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
