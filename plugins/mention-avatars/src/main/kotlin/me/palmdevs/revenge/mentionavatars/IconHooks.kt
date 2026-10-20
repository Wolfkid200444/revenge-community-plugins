package me.palmdevs.revenge.mentionavatars

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.ReplacementSpan
import android.view.View
import android.widget.TextView
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.lang.ref.WeakReference
import java.lang.reflect.Field
import java.util.WeakHashMap
import kotlin.math.roundToInt

private const val TEXT_UTILS = "com.discord.chat.presentation.textutils.TextUtilsKt"
private const val SPAN_TEXT_VIEW = "com.facebook.drawee.span.SimpleDraweeSpanTextView"
private const val DRAWEE_HOLDER = "com.facebook.drawee.view.DraweeHolder"

private const val SHAPE_MARKER = "#palmdevs.mention-avatars:"
private const val ICON_EXTRA = "palmdevs.mention-avatars.icon"

// Relative to the icon size
private const val ICON_GAP = 0.1f

private class GapSpan(private val width: Int) : ReplacementSpan() {
    override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?) = width

    override fun draw(
        canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint,
    ) = Unit
}

// Mentions are rendered into their own builder, so images in them are never attached
internal class IconHooks(classLoader: ClassLoader) {
    private val draweeHolder = classLoader.loadClass(DRAWEE_HOLDER)
    private val onAttach = draweeHolder.getMethod("onAttach")
    private val onDetach = draweeHolder.getMethod("onDetach")
    private val topLevelDrawable = draweeHolder.getMethod("getTopLevelDrawable")
    private val holderFields = HashMap<Class<*>, Field?>()

    // has to be thread safe
    private val icons = WeakHashMap<ReplacementSpan, Icon>()
    // main thread only
    private val shown = WeakHashMap<View, Shown>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val unhooks: List<XC_MethodHook.Unhook>

    private class Icon(val holder: Any, val glyph: Boolean)
    private class Shown(val holders: List<Any>, val callback: Drawable.Callback)

    init {
        val appendImage = classLoader.loadClass(TEXT_UTILS).declaredMethods
            .single { it.name == "appendImage" && it.parameterTypes.size == 9 }
        val textView = classLoader.loadClass(SPAN_TEXT_VIEW)
        val method = { name: String -> textView.declaredMethods.single { it.name == name } }

        val attach = object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                shown[param.thisObject as View]?.holders?.forEach { onAttach(it) }
            }
        }

        val detach = object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                shown[param.thisObject as View]?.holders?.forEach { onDetach(it) }
            }
        }

        unhooks = listOf(
            XposedBridge.hookMethod(appendImage, object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    val url = param.args[3] as String
                    val index = url.indexOf(SHAPE_MARKER)
                    if (index < 0) return

                    val shape = url.substring(index + SHAPE_MARKER.length)
                    val size = param.args[4] as Int
                    param.args[3] = url.substring(0, index)
                    param.args[7] = if (shape == "circle") size / 2f else 0f
                    param.setObjectExtra(ICON_EXTRA, shape)
                }

                override fun afterHookedMethod(param: MethodHookParam) {
                    val shape = param.getObjectExtra(ICON_EXTRA) ?: return

                    // The image is the last character appended
                    val builder = param.args[0] as SpannableStringBuilder
                    val end = builder.length
                    for (span in builder.getSpans(end - 1, end, ReplacementSpan::class.java)) {
                        val holder = holderOf(span) ?: continue
                        synchronized(icons) { icons[span] = Icon(holder, shape == "glyph") }
                    }

                    // Padding insets the image instead of adding space, so we add a [GapSpan] instead
                    // Android allows line breaks around replacement spans, word joiners keep the icon with the name
                    builder.append("⁠⁠⁠")
                    val gap = GapSpan(((param.args[4] as Int) * ICON_GAP).roundToInt())
                    builder.setSpan(gap, end + 1, end + 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
            }),
            XposedBridge.hookMethod(method("setDraweeSpanStringBuilder"), object : XC_MethodHook() {
                override fun afterHookedMethod(param: MethodHookParam) {
                    val view = param.thisObject as TextView
                    val text = param.args[0] as? Spanned ?: return
                    val spans = synchronized(icons) {
                        text.getSpans(0, text.length, ReplacementSpan::class.java)
                            .mapNotNull { span -> icons[span]?.let { span to it } }
                    }
                    if (spans.isEmpty()) return

                    val callback = InvalidateCallback(view)
                    for ((span, icon) in spans) {
                        val drawable = topLevelDrawable(icon.holder) as Drawable? ?: continue
                        drawable.callback = callback
                        if (icon.glyph) drawable.colorFilter =
                            PorterDuffColorFilter(textColorAt(view, text, text.getSpanStart(span)), PorterDuff.Mode.SRC_IN)
                    }

                    val holders = spans.map { it.second.holder }
                    shown[view] = Shown(holders, callback)
                    if (view.isAttachedToWindow) holders.forEach { onAttach(it) }
                }
            }),
            // Also runs when the text changes
            XposedBridge.hookMethod(method("detachCurrentDraweeSpanStringBuilder"), object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    shown.remove(param.thisObject as View)?.holders?.forEach { onDetach(it) }
                }
            }),
            XposedBridge.hookMethod(method("onAttachedToWindow"), attach),
            XposedBridge.hookMethod(method("onFinishTemporaryDetach"), attach),
            XposedBridge.hookMethod(method("onDetachedFromWindow"), detach),
            XposedBridge.hookMethod(method("onStartTemporaryDetach"), detach),
        )
    }

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        synchronized(icons) { icons.clear() }
        mainHandler.post {
            for (state in shown.values) state.holders.forEach { onDetach(it) }
            shown.clear()
        }
    }

    // The last span is the one drawn on top
    private fun textColorAt(view: TextView, text: Spanned, index: Int) =
        text.getSpans(index, index + 1, ForegroundColorSpan::class.java).lastOrNull()?.foregroundColor
            ?: view.currentTextColor

    private fun holderOf(span: ReplacementSpan): Any? {
        val field = synchronized(holderFields) {
            holderFields.getOrPut(span.javaClass) {
                span.javaClass.declaredFields
                    .firstOrNull { draweeHolder.isAssignableFrom(it.type) }
                    ?.apply { isAccessible = true }
            }
        }
        return field?.get(span)
    }

    // Drawables hold their callback weakly, Shown keeps it alive
    private class InvalidateCallback(view: View) : Drawable.Callback {
        private val view = WeakReference(view)

        override fun invalidateDrawable(who: Drawable) {
            view.get()?.invalidate()
        }

        override fun scheduleDrawable(who: Drawable, what: Runnable, `when`: Long) {
            view.get()?.postDelayed(what, `when` - SystemClock.uptimeMillis())
        }

        override fun unscheduleDrawable(who: Drawable, what: Runnable) {
            view.get()?.removeCallbacks(what)
        }
    }
}
