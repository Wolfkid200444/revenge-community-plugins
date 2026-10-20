package me.palmdevs.revenge.messagelinkpreview

import android.content.Context
import android.util.Log
import android.view.ViewGroup

private const val TAG = "MessageLinkPreview"

private const val CHAT = "com.discord.chat"
private const val MESSAGE_VIEW = "$CHAT.presentation.message.MessageView"
private const val SYSTEM_MESSAGE_VIEW = "$CHAT.presentation.message.system.SystemMessageWrapperView"
private const val AUTOMOD_MESSAGE_VIEW = "$CHAT.presentation.message.system.AutomodSystemMessageWrapperView"
private const val EMPTY_EVENT_HANDLER = "$CHAT.presentation.events.ChatEventHandler\$Empty"
private const val MESSAGE_VIEW_MANAGERS = "$CHAT.messagemanager.MessageViewManagers"
private const val MESSAGE_ROW = "$CHAT.bridge.row.MessageRow"
private const val MESSAGE_CONTEXT_KT = "$CHAT.presentation.root.MessageContextKt"

// Default onChainPart (ONLY), allowChildGestures (true) and renderContentOnly (false)
private const val SET_MESSAGE_DEFAULTS = 16 or 32 or 64

/** Discord's message views, the same ones `DCDMessageView` and friends use. */
internal class MessageViews(classLoader: ClassLoader) {
    private val messageViewClass = classLoader.loadClass(MESSAGE_VIEW)
    private val setMessage = messageViewClass.declaredMethods.single { it.name == "setMessage\$default" }
    private val setAccessoriesPool = messageViewClass.methods.single { it.name == "setAccessoriesRecycledViewPool" }

    private val systemMessageViewClass = classLoader.loadClass(SYSTEM_MESSAGE_VIEW)
    private val setSystemMessage = systemMessageViewClass.methods.single { it.name == "setMessage" }
    private val automodMessageViewClass = classLoader.loadClass(AUTOMOD_MESSAGE_VIEW)
    private val setAutomodMessage = automodMessageViewClass.methods.single { it.name == "setMessage" }
    private val emptyEventHandler = classLoader.loadClass(EMPTY_EVENT_HANDLER).getField("INSTANCE").get(null)

    private val managersClass = classLoader.loadClass(MESSAGE_VIEW_MANAGERS)
    private val managers = managersClass.getField("INSTANCE").get(null)
    private val convertRow = managersClass.getDeclaredMethod(
        "access\$convertRowJsonToMessageRow",
        managersClass,
        String::class.java,
    )
    private val messageRowClass = classLoader.loadClass(MESSAGE_ROW)
    private val rowMessage = messageRowClass.getMethod("getMessage")
    private val messageContext = classLoader.loadClass(MESSAGE_CONTEXT_KT)
        .getMethod("getMessageContext", messageRowClass)

    /** Returns the preview's `Message` and `MessageContext`. */
    fun parse(preview: Preview): Pair<Any, Any>? {
        preview.parsed?.let { return it }
        val row = preview.row
        if (row == null || preview.parseFailed) return null

        return try {
            val messageRow = convertRow.invoke(null, managers, row)
            (rowMessage.invoke(messageRow)!! to messageContext.invoke(null, messageRow)!!)
                .also { preview.parsed = it }
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to parse row", e)
            preview.parseFailed = true
            null
        }
    }

    fun isFor(view: ViewGroup, kind: Kind) = viewClass(kind).isInstance(view)

    fun create(context: Context, kind: Kind) =
        (viewClass(kind).getConstructor(Context::class.java).newInstance(context) as ViewGroup).apply {
            setPadding(0, 0, 0, 0)
        }

    fun bind(
        view: ViewGroup,
        kind: Kind,
        parsed: Pair<Any, Any>,
        eventHandler: Any?,
        componentProvider: Any?,
        pool: Any?,
    ) {
        val (message, context) = parsed
        val handler = eventHandler ?: emptyEventHandler

        when (kind) {
            Kind.MESSAGE -> {
                if (pool != null) setAccessoriesPool.invoke(view, pool)
                setMessage.invoke(
                    null,
                    view,
                    message,
                    context,
                    handler,
                    componentProvider,
                    null,
                    false,
                    false,
                    SET_MESSAGE_DEFAULTS,
                    null,
                )
            }
            Kind.SYSTEM -> setSystemMessage.invoke(view, message, context, handler)
            Kind.AUTOMOD -> setAutomodMessage.invoke(view, message, context, handler)
        }
    }

    private fun viewClass(kind: Kind) = when (kind) {
        Kind.MESSAGE -> messageViewClass
        Kind.SYSTEM -> systemMessageViewClass
        Kind.AUTOMOD -> automodMessageViewClass
    }
}
