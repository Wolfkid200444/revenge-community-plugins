package me.palmdevs.revenge.shikicodeblocks

import android.graphics.Paint
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.Logger
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.util.Collections
import java.util.WeakHashMap

private const val TEXT_UTILS = "com.discord.chat.presentation.textutils"
private const val CODE_STYLE = "$TEXT_UTILS.CodeStyle"
private const val RENDER_CONTEXT = "$TEXT_UTILS.RenderContext"
private const val CODE_BLOCK_NODE = "com.discord.chat.bridge.contentnode.CodeBlockContentNode"
private const val BLOCK_BACKGROUND_SPAN = "com.discord.span.utilities.spannable.BlockBackgroundSpan"

/**
 * Hooks Discord's native code block renderer, `CodeStyle`.
 *
 * `renderCodeBlock` sets up the block (background, font, padding) around `renderCode`, which appends the highlighted content.
 * `renderCode` is replaced for blocks with a [Highlight], and `renderCodeBlock` then paints its background in the theme's color.
 * Blocks without one keep Discord's highlighting.
 *
 * Rows are rendered again whenever they scroll back into view, by then [cache] may have dropped their blocks.
 * So each code block node takes its highlight from [cache] once it is created (right after JS stored it),
 * and keeps it for as long as Discord keeps the node.
 *
 * Blocks also get a span from [taps], opening them in the viewer where their text can be selected.
 */
internal fun hookCodeStyle(
    classLoader: ClassLoader,
    cache: HighlightCache,
    taps: CodeBlockTaps?,
    log: Logger,
): List<XC_MethodHook.Unhook> {
    val codeStyle = classLoader.loadClass(CODE_STYLE)
    val node = classLoader.loadClass(CODE_BLOCK_NODE)
    val getLang = node.getMethod("getLang")
    val getContent = node.getMethod("getContent")
    val spoilerIsHidden = classLoader.loadClass(RENDER_CONTEXT).getMethod("spoilerIsHidden")
    val renderCode = codeStyle.findRenderMethod("renderCode", node)
    val renderCodeBlock = codeStyle.findRenderMethod("renderCodeBlock", node)

    // Only the background is lost without it, so a missing field is not fatal.
    val fillPaint = runCatching {
        classLoader.loadClass(BLOCK_BACKGROUND_SPAN).getDeclaredField("fillPaint").apply { isAccessible = true }
    }.onFailure { log.w("Code block backgrounds will keep Discord's color", it) }.getOrNull()

    // Nodes are data classes, so equal blocks share an entry. It goes once the node that added it is collected.
    val attached = Collections.synchronizedMap(WeakHashMap<Any, Highlight>())
    val highlightOf = { target: Any -> cache[getLang.invoke(target) as String, getContent.invoke(target) as String] }

    // renderCode is only called by renderCodeBlock, on the same thread, so this hands the highlight over.
    val rendered = ThreadLocal<Highlight?>()

    return XposedBridge.hookAllConstructors(node, object : XC_MethodHook() {
        override fun afterHookedMethod(param: MethodHookParam) {
            val target = param.thisObject
            highlightOf(target)?.let { attached[target] = it }
        }
    }).toList() + listOf(
        renderCode.hook(before = { param ->
            val rc = param.args[2]
            if (spoilerIsHidden.invoke(rc) == true) return@hook

            val target = param.args[1]
            val highlight = attached[target] ?: highlightOf(target) ?: return@hook

            (param.args[0] as SpannableStringBuilder).appendHighlighted(getContent.invoke(target) as String, highlight)
            rendered.set(highlight)
            param.result = null
        }),
        renderCodeBlock.hook(
            before = { param ->
                rendered.set(null)
                param.setObjectExtra(EXTRA_START, (param.args[0] as SpannableStringBuilder).length)
            },
            after = { param ->
                val highlight = rendered.get()
                rendered.set(null)

                val builder = param.args[0] as SpannableStringBuilder
                val start = param.getObjectExtra(EXTRA_START) as Int
                if (highlight != null && fillPaint != null) builder.paintBlockBackground(start, fillPaint, highlight.bg)

                // Tapping a hidden spoiler reveals it instead
                val rc = param.args[2]
                if (taps != null && taps.enabled && spoilerIsHidden.invoke(rc) != true) {
                    val target = param.args[1]
                    val span = taps.span(
                        getLang.invoke(target) as String,
                        getContent.invoke(target) as String,
                        highlight,
                        rc,
                    )
                    builder.span(span, start, builder.length)
                }
            },
        ),
    )
}

private const val EXTRA_START = "start"

private fun Class<*>.findRenderMethod(name: String, node: Class<*>): Method =
    declaredMethods.single { it.name == name && it.parameterTypes.size == 3 && it.parameterTypes[1] == node }
        .apply { isAccessible = true }

private inline fun Method.hook(
    crossinline before: (XC_MethodHook.MethodHookParam) -> Unit = {},
    crossinline after: (XC_MethodHook.MethodHookParam) -> Unit = {},
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = before(param)
    override fun afterHookedMethod(param: MethodHookParam) = after(param)
})

internal fun SpannableStringBuilder.appendHighlighted(content: String, highlight: Highlight) {
    val text = highlight.text ?: content
    val start = length
    append(text)
    setSpan(ForegroundColorSpan(highlight.fg), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)

    val backgrounds = highlight.backgrounds
    for (i in 0 until backgrounds.size - 2 step 3) {
        val from = backgrounds[i]
        val to = backgrounds[i + 1]
        if (from in 0..<to && to <= text.length) span(BackgroundColorSpan(backgrounds[i + 2]), start + from, start + to)
    }

    val spans = highlight.spans
    for (i in 0 until spans.size - 3 step 4) {
        val from = spans[i]
        val to = spans[i + 1]
        if (from < 0 || to > text.length || from >= to) continue

        val color = spans[i + 2]
        val style = spans[i + 3]
        if (color != highlight.fg) span(ForegroundColorSpan(color), start + from, start + to)

        val typeface = when (style and (FontStyle.BOLD or FontStyle.ITALIC)) {
            FontStyle.BOLD -> Typeface.BOLD
            FontStyle.ITALIC -> Typeface.ITALIC
            FontStyle.BOLD or FontStyle.ITALIC -> Typeface.BOLD_ITALIC
            else -> null
        }
        if (typeface != null) span(StyleSpan(typeface), start + from, start + to)
        if (style and FontStyle.UNDERLINE != 0) span(UnderlineSpan(), start + from, start + to)
        if (style and FontStyle.STRIKETHROUGH != 0) span(StrikethroughSpan(), start + from, start + to)
    }
}

private fun SpannableStringBuilder.span(what: Any, start: Int, end: Int) =
    setSpan(what, start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)

/** Recolors the block background span that `renderCodeBlock` added from [start] on. */
private fun SpannableStringBuilder.paintBlockBackground(start: Int, fillPaint: Field, color: Int) {
    val type = fillPaint.declaringClass
    for (span in getSpans(start, length, type)) {
        if (getSpanStart(span) < start) continue
        (fillPaint.get(span) as Paint).color = color
    }
}
