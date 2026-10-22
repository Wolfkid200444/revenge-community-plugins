package me.palmdevs.revenge.messagelogger

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.view.View
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import org.json.JSONArray
import org.luckypray.dexkit.wrap.DexMethod
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.ConcurrentHashMap

private const val DRAWEE_SPAN_TEXT_VIEW = "com.facebook.drawee.span.SimpleDraweeSpanTextView"
private const val MESSAGE = "com.discord.chat.bridge.Message"

private const val GREYED_ALPHA = 0.5f

internal class LoggerHooks(dexFinder: DexFinder) {
    private val dimmed = ConcurrentHashMap.newKeySet<String>()

    // Main thread only
    private val boundAttachments = WeakHashMap<View, String>()
    private val greyed = Collections.newSetFromMap(WeakHashMap<View, Boolean>())

    private val mainHandler = Handler(Looper.getMainLooper())

    private val greyedPaint = Paint().apply {
        colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
        alpha = (GREYED_ALPHA * 255).toInt()
    }

    private val attachmentOf: Method
    private val accessoryClass: Class<*>
    private val itemViewField: Field
    private var attachmentIdField: Field? = null

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        // Message content is set with this after Discord appends its edited label
        val setDraweeSpanStringBuilder = dexFinder.classLoader.loadClass(DRAWEE_SPAN_TEXT_VIEW).declaredMethods
            .single { it.name == "setDraweeSpanStringBuilder" }

        val attachmentClass = dexFinder.findClass {
            matcher {
                usingEqStrings("Attachment(id=", ", filename=")
            }
        } ?: error("Attachment not found")

        // Returns the accessory showing an attachment, the class all attachment accessories extend
        accessoryClass = dexFinder.findMethod {
            matcher {
                paramTypes(attachmentClass.name, MESSAGE, "int", "int", "int", "java.lang.Boolean")
            }
        }?.returnType ?: error("Attachment accessory factory not found")

        attachmentOf = accessoryClass.declaredMethods.single { it.parameterCount == 0 && it.returnType == attachmentClass }
        val uploadOverlay = accessoryClass.declaredMethods.single {
            it.parameterTypes.singleOrNull()?.name == "kotlin.jvm.functions.Function2"
        }

        val bindAccessory = dexFinder.findMethod {
            matcher {
                paramCount(2)
                usingEqStrings("reactions", "addNewReactionAccessibilityLabel")
            }
        } ?: error("MessageAccessoriesAdapter.onBindViewHolder not found")

        val viewHolderClass = bindAccessory.parameterTypes[0]
        itemViewField = generateSequence<Class<*>>(viewHolderClass) { it.superclass }
            .flatMap { it.declaredFields.asSequence() }
            .first { it.type == View::class.java && !Modifier.isStatic(it.modifiers) }
            .apply { isAccessible = true }

        // Attachments in a grid have an adapter of their own
        val bindGridAttachment = dexFinder.findMethod {
            matcher {
                paramTypes(viewHolderClass.name, "int")
                addInvoke(DexMethod(uploadOverlay).serialize())
            }
        } ?: error("Attachment grid adapter onBindViewHolder not found")

        unhooks = listOf(
            setDraweeSpanStringBuilder.hook(before = { param ->
                (param.args[0] as? SpannableStringBuilder)?.styleHistory()
            }),
            bindAccessory.hook(after = attachmentBinder(bindAccessory)),
            bindGridAttachment.hook(after = attachmentBinder(bindGridAttachment)),
        )
    }

    fun setDimmed(json: String, dim: Boolean) {
        val array = JSONArray(json)
        val ids = (0 until array.length()).map(array::getString).toSet()
        if (dim) dimmed.addAll(ids) else dimmed.removeAll(ids)

        // Attachments that didn't change aren't bound again
        mainHandler.post {
            for ((view, id) in boundAttachments) if (id in ids) view.setGreyed(dim)
        }
    }

    fun clear() = dimmed.clear()

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        dimmed.clear()

        mainHandler.post {
            for (view in greyed.toList()) view.setGreyed(false)
            boundAttachments.clear()
        }
    }

    private fun attachmentBinder(onBindViewHolder: Method): (XC_MethodHook.MethodHookParam) -> Unit {
        // Adapters keep their items in their only list
        val items = onBindViewHolder.declaringClass.declaredFields
            .single { List::class.java.isAssignableFrom(it.type) && !Modifier.isStatic(it.modifiers) }
            .apply { isAccessible = true }

        return { param -> bindAttachment(param, items) }
    }

    private fun bindAttachment(param: XC_MethodHook.MethodHookParam, itemsField: Field) {
        val view = itemViewField.get(param.args[0]) as View
        val item = (itemsField.get(param.thisObject) as List<*>).getOrNull(param.args[1] as Int)
        val id = item?.takeIf(accessoryClass::isInstance)?.let { attachmentId(attachmentOf.invoke(it)!!) }

        if (id != null) boundAttachments[view] = id else boundAttachments.remove(view)
        view.setGreyed(id != null && id in dimmed)
    }

    private fun View.setGreyed(grey: Boolean) {
        if (grey) {
            if (greyed.add(this)) setLayerType(View.LAYER_TYPE_HARDWARE, greyedPaint)
        } else if (greyed.remove(this)) {
            setLayerType(View.LAYER_TYPE_NONE, null)
        }
    }

    // toString the data class so we can get the fields
    private fun attachmentId(attachment: Any): String? {
        val field = attachmentIdField ?: run {
            val id = attachment.toString().substringAfter("Attachment(id=").substringBefore(", ")
            attachment.javaClass.declaredFields
                .filter { it.type == String::class.java }
                .onEach { it.isAccessible = true }
                .firstOrNull { it.get(attachment) == id }
                ?.also { attachmentIdField = it }
        } ?: return null

        return field.get(attachment) as String?
    }
}

private inline fun Method.hook(
    crossinline before: (XC_MethodHook.MethodHookParam) -> Unit = {},
    crossinline after: (XC_MethodHook.MethodHookParam) -> Unit = {},
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = before(param)
    override fun afterHookedMethod(param: MethodHookParam) = after(param)
})
