@file:Suppress("CanConvertToMultiDollarString")
package me.palmdevs.revenge.messagelinkpreview

import android.content.Context
import android.util.Log
import android.view.ViewGroup
import io.github.revenge.xposed.api.DexFinder
import org.luckypray.dexkit.wrap.DexMethod
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.lang.reflect.Proxy

private const val TAG = "MessageLinkPreview"

private const val CHAT = "com.discord.chat"
private const val MESSAGE = "$CHAT.bridge.Message"
private const val MESSAGE_VIEW = "$CHAT.presentation.message.MessageView"
private const val MESSAGE_VIEW_MANAGERS = "$CHAT.messagemanager.MessageViewManagers"
private const val MESSAGE_VIEW_MANAGER = "$MESSAGE_VIEW_MANAGERS\$MessageViewManager"
private const val SYSTEM_MESSAGE_VIEW_MANAGER = "$MESSAGE_VIEW_MANAGERS\$SystemMessageViewManager"
private const val AUTOMOD_MESSAGE_VIEW_MANAGER = "$MESSAGE_VIEW_MANAGERS\$AutoModerationSystemMessageViewManager"

/** Discord's message views, the same ones `DCDMessageView` and friends use. */
internal class MessageViews(dexFinder: DexFinder) {
    private val classLoader = dexFinder.classLoader

    private val messageViewClass = classLoader.loadClass(MESSAGE_VIEW)
    private val setMessage = dexFinder.findMethod {
        matcher {
            declaredClass(MESSAGE_VIEW)
            usingEqStrings("message", "messageContext", "eventHandler")
        }
    } ?: error("MessageView.setMessage not found")

    val contextClass: Class<*> = setMessage.parameterTypes[1]
    val eventHandlerClass: Class<*> = setMessage.parameterTypes[2]
    val componentProviderClass: Class<*> = setMessage.parameterTypes[3]

    // Argument [DCDMessageView] passes for chain part (ONLY).
    private val onlyChainPart: Any = run {
        val chainPart = dexFinder.findClass {
            matcher {
                superClass("java.lang.Enum")
                usingEqStrings("ONLY", "START", "MIDDLE", "END")
            }
        } ?: error("ChainPart not found")
        val only = chainPart.enumConstants!!.first { (it as Enum<*>).name == "ONLY" }
        // Discord Kotlin's Function0
        val function0 = setMessage.parameterTypes[4]

        Proxy.newProxyInstance(classLoader, arrayOf(function0)) { proxy, method, args ->
            when (method.name) {
                "invoke" -> only
                "equals" -> proxy === args?.get(0)
                "hashCode" -> System.identityHashCode(proxy)
                else -> "ChainPart.ONLY"
            }
        }
    }

    private val setSystemMessage = dexFinder.findMethod {
        matcher {
            addCaller(DexMethod(setRowOf(SYSTEM_MESSAGE_VIEW_MANAGER)).serialize())
            paramTypes(MESSAGE, contextClass.name, eventHandlerClass.name)
        }
    } ?: error("SystemMessageWrapperView.setMessage not found")
    private val systemMessageViewClass = setSystemMessage.declaringClass

    private val setAutomodMessage = dexFinder.findMethod {
        matcher {
            addCaller(DexMethod(setRowOf(AUTOMOD_MESSAGE_VIEW_MANAGER)).serialize())
            paramTypes(MESSAGE, contextClass.name, eventHandlerClass.name, componentProviderClass.name, "boolean")
        }
    } ?: error("AutomodSystemMessageWrapperView.setMessage not found")
    private val automodMessageViewClass = setAutomodMessage.declaringClass

    private val emptyEventHandler = (dexFinder.findClass {
        matcher {
            addInterface(eventHandlerClass.name)
            fieldCount(1)
        }
    } ?: error("ChatEventHandler.Empty not found")).let { empty ->
        empty.declaredFields.single { it.type == empty }.apply { isAccessible = true }.get(null)
    }

    // [DCDMessageView] row parser
    private val setRow = setRowOf(MESSAGE_VIEW_MANAGER)
    private val convertRow = dexFinder.findMethod {
        matcher {
            addCaller(DexMethod(setRow).serialize())
            modifiers(Modifier.STATIC)
            paramTypes(String::class.java)
        }
    } ?: error("MessageViewManagers.convertRowJsonToMessageRow not found")
    private val messageRowClass = convertRow.returnType
    private val rowMessage = dexFinder.findField {
        matcher {
            declaredClass(messageRowClass.name)
            addReadMethod(DexMethod(setRow).serialize())
        }
    } ?: error("MessageRow.message not found")
    private val messageContext = dexFinder.findMethod {
        matcher {
            addCaller(DexMethod(setRow).serialize())
            paramTypes(messageRowClass.name)
            returnType(contextClass.name)
        }
    } ?: error("MessageContextKt.getMessageContext not found")

    private fun setRowOf(manager: String): Method = classLoader.loadClass(manager).declaredMethods
        .single { it.name == "setRow" && !it.isBridge }

    /** Returns the preview's `Message` and `MessageContext`. */
    fun parse(preview: Preview): Pair<Any, Any>? {
        preview.parsed?.let { return it }
        val row = preview.row
        if (row == null || preview.parseFailed) return null

        return try {
            val messageRow = convertRow.invoke(null, row)
            (rowMessage.get(messageRow)!! to messageContext.invoke(null, messageRow)!!)
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
    ) {
        val (message, context) = parsed
        val handler = eventHandler ?: emptyEventHandler

        when (kind) {
            Kind.MESSAGE -> setMessage.invoke(view, message, context, handler, componentProvider, onlyChainPart, true, false)
            Kind.SYSTEM -> setSystemMessage.invoke(view, message, context, handler)
            Kind.AUTOMOD -> setAutomodMessage.invoke(view, message, context, handler, null, true)
        }
    }

    private fun viewClass(kind: Kind) = when (kind) {
        Kind.MESSAGE -> messageViewClass
        Kind.SYSTEM -> systemMessageViewClass
        Kind.AUTOMOD -> automodMessageViewClass
    }
}
