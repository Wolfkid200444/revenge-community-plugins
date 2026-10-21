package me.palmdevs.revenge.mentionavatars

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.drawable.Drawable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.view.View
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.util.WeakHashMap
import kotlin.math.roundToInt

private const val SPAN_TEXT_VIEW = "com.facebook.drawee.span.SimpleDraweeSpanTextView"

private const val SHAPE_MARKER = "#palmdevs.mention-avatars:"
private const val ICON_EXTRA = "palmdevs.mention-avatars.icon"
private const val LAYER_EXTRA = "palmdevs.mention-avatars.layer"

// Relative to the icon size
private const val ICON_GAP = 0.1f

/**
 * Arguments of `TextUtils.appendImage(builder, context, rc, url, width, height, tint, cornerRadius, padding)`,
 * found by type. R8 merged it with its `$default` overload, so the last argument is the mask of arguments left out,
 * and Discord leaves out the corner radius.
 */
private class AppendImageArgs(method: Method) {
    private val types = method.parameterTypes

    val url = types.indexOf(String::class.java)
    val size = url + 1
    private val cornerRadius = types.indexOf(Float::class.javaPrimitiveType)
    private val mask = types.lastIndex

    fun setCornerRadius(args: Array<Any?>, radius: Float) {
        args[cornerRadius] = radius
        // Bits count from the first argument after the builder, the receiver
        args[mask] = (args[mask] as Int) and (1 shl (cornerRadius - 1)).inv()
    }
}

private class GapSpan(private val width: Int) : ReplacementSpan() {
    override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?) = width

    override fun draw(
        canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint,
    ) = Unit
}

/**
 * Mentions are rendered into their own builder, so images in them are never attached.
 * Handle spans to the shown builder for lifecycle attachment and detachment.
 */
internal class IconHooks(dexFinder: DexFinder) {
    private val setBuilder = dexFinder.classLoader.loadClass(SPAN_TEXT_VIEW).declaredMethods
        .single { it.name == "setDraweeSpanStringBuilder" }
    private val builderClass = setBuilder.parameterTypes[0]

    // Image spans added by the builder's `addImage`
    private val builderSpans = dexFinder.findField {
        matcher {
            declaredClass(builderClass.name)
            type(HashSet::class.java)
            addReadMethod {
                declaredClass(builderClass.name)
                paramCount(6)
            }
        }
    } ?: error("DraweeSpanStringBuilder.draweeSpans not found")

    private val builderCallback = builderClass.declaredFields
        .single { Drawable.Callback::class.java.isAssignableFrom(it.type) && !View::class.java.isAssignableFrom(it.type) }
        .apply { isAccessible = true }
    private val drawableFields = HashMap<Class<*>, Field?>()

    // whether the icon is a glyph
    // has to be thread safe
    private val icons = WeakHashMap<ReplacementSpan, Boolean>()

    private val unhooks: List<XC_MethodHook.Unhook>
    private var drawUnhook: XC_MethodHook.Unhook? = null

    // Only used while drawing, on the main thread
    private val tintPaint = TextPaint()
    private val tintMode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)

    // Glyphs use the text's color or gradient
    private val glyphTint = object : XC_MethodHook() {
        override fun beforeHookedMethod(param: MethodHookParam) {
            val span = param.thisObject as ReplacementSpan
            if (synchronized(icons) { icons[span] } != true) return
            val bounds = drawableOf(span)?.bounds ?: return

            val canvas = param.args[0] as Canvas
            val x = param.args[4] as Float
            val top = (param.args[5] as Int).toFloat()
            val bottom = (param.args[7] as Int).toFloat()
            param.setObjectExtra(LAYER_EXTRA, canvas.saveLayer(x, top, x + bounds.width(), bottom, null))
        }

        override fun afterHookedMethod(param: MethodHookParam) {
            val layer = param.getObjectExtra(LAYER_EXTRA) as? Int? ?: return
            val canvas = param.args[0] as Canvas

            // Android skips non-metric spans when drawing replacements, so we need to apply them manually.
            tintPaint.set(param.args[8] as Paint)
            val text = param.args[1] as? Spanned
            text?.getSpans(param.args[2] as Int, param.args[3] as Int, CharacterStyle::class.java)?.forEach {
                if (it !is MetricAffectingSpan) it.updateDrawState(tintPaint)
            }
            tintPaint.style = Paint.Style.FILL
            tintPaint.xfermode = tintMode
            canvas.drawPaint(tintPaint)
            canvas.restoreToCount(layer)
        }
    }

    init {
        val appendImage = dexFinder.findMethod {
            matcher { usingEqStrings("rc", "imageUrl") }
        } ?: error("TextUtils.appendImage not found")
        val args = AppendImageArgs(appendImage)

        unhooks = listOf(
            XposedBridge.hookMethod(appendImage, object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    val url = param.args[args.url] as String
                    val index = url.indexOf(SHAPE_MARKER)
                    if (index < 0) return

                    val shape = url.substring(index + SHAPE_MARKER.length)
                    val size = param.args[args.size] as Int
                    param.args[args.url] = url.substring(0, index)
                    args.setCornerRadius(param.args, if (shape == "circle") size / 2f else 0f)
                    param.setObjectExtra(ICON_EXTRA, shape)
                }

                override fun afterHookedMethod(param: MethodHookParam) {
                    val shape = param.getObjectExtra(ICON_EXTRA) ?: return

                    // The image is the last character appended
                    val builder = param.args[0] as SpannableStringBuilder
                    val end = builder.length
                    for (span in builder.getSpans(end - 1, end, ReplacementSpan::class.java)) {
                        synchronized(icons) { icons[span] = shape == "glyph" }
                        hookDraw(span.javaClass)
                    }

                    // Padding insets the image instead of adding space, so we add a [GapSpan] instead
                    // Android allows line breaks around replacement spans, word joiners keep the icon with the name
                    builder.append("⁠⁠⁠")
                    val gap = GapSpan(((param.args[args.size] as Int) * ICON_GAP).roundToInt())
                    builder.setSpan(gap, end + 1, end + 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
            }),
            // Attaches builder spans if view is attached
            XposedBridge.hookMethod(setBuilder, object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    val builder = param.args[0] as? Spanned ?: return
                    val spans = synchronized(icons) {
                        builder.getSpans(0, builder.length, ReplacementSpan::class.java).filter { it in icons }
                    }
                    if (spans.isEmpty()) return

                    @Suppress("UNCHECKED_CAST")
                    val attached = builderSpans.get(builder) as MutableSet<Any>
                    val callback = builderCallback.get(builder) as Drawable.Callback
                    for (span in spans) {
                        attached.add(span)
                        drawableOf(span)?.callback = callback
                    }
                }
            }),
        )
    }

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        synchronized(this) { drawUnhook?.unhook() }
        synchronized(icons) { icons.clear() }
    }

    // The image span class is only known once one is created
    private fun hookDraw(spanClass: Class<*>) {
        synchronized(this) {
            if (drawUnhook != null) return
            val int = Int::class.javaPrimitiveType
            val draw = spanClass.getDeclaredMethod(
                "draw", Canvas::class.java, CharSequence::class.java, int, int, Float::class.javaPrimitiveType, int, int, int,
                Paint::class.java,
            )
            drawUnhook = XposedBridge.hookMethod(draw, glyphTint)
        }
    }

    private fun drawableOf(span: ReplacementSpan): Drawable? {
        val field = synchronized(drawableFields) {
            drawableFields.getOrPut(span.javaClass) {
                span.javaClass.declaredFields
                    .firstOrNull { Drawable::class.java.isAssignableFrom(it.type) }
                    ?.apply { isAccessible = true }
            }
        }
        return field?.get(span) as Drawable?
    }
}
