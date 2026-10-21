package me.palmdevs.revenge.shikicodeblocks

import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LineBackgroundSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import org.luckypray.dexkit.wrap.DexMethod
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.Collections
import java.util.WeakHashMap

/**
 * Hooks Discord's native code block renderer, `CodeStyle.renderCodeBlock`.
 *
 * Sets up block styling (background, font, padding) around content highlighted with `simpleast` parser.
 * With [Highlight], parser returns no nodes, appends highlighted content, and paints theme background.
 * Blocks without [Highlight] keep Discord highlighting.
 *
 * Rows are rendered again whenever they scroll back into view, by then [cache] may have dropped their blocks.
 * So each code block node takes its highlight from [cache] once it is created (right after JS stored it),
 * and keeps it for as long as Discord keeps the node.
 *
 * Blocks also get a span from [taps], opening them in the viewer where their text can be selected.
 */
internal fun hookCodeStyle(
    dexFinder: DexFinder,
    cache: HighlightCache,
    taps: CodeBlockTaps?,
): List<XC_MethodHook.Unhook> {
    val node = CodeBlockNode(dexFinder)
    val renderCodeBlock = dexFinder.findMethod {
        matcher {
            modifiers(Modifier.STATIC)
            paramTypes(null, node.type.name, null)
        }
    } ?: error("CodeStyle.renderCodeBlock not found")
    val palette = DiscordPalette(dexFinder, renderCodeBlock.declaringClass)
    val spoilerIsHidden = dexFinder.findMethod {
        matcher {
            declaredClass(renderCodeBlock.parameterTypes[2].name)
            paramCount(0)
            returnType("boolean")
            addCaller(DexMethod(renderCodeBlock).serialize())
        }
    } ?: error("RenderContext.spoilerIsHidden not found")
    val parse = dexFinder.findMethod {
        matcher { usingEqStrings("matcher found no matches", "failed to find rule to match source") }
    } ?: error("Parser.parse not found")

    // Nodes are data classes, so equal blocks share an entry. It goes once the node that added it is collected.
    val attached = Collections.synchronizedMap(WeakHashMap<Any, Highlight>())
    val highlightOf = { target: Any -> cache[node.lang(target), node.content(target)] }

    // Hands block over: renderCodeBlock parses content inline on the same thread.
    val pending = ThreadLocal<Pending?>()
    val rendered = ThreadLocal<Highlight?>()

    return XposedBridge.hookAllConstructors(node.type, object : XC_MethodHook() {
        override fun afterHookedMethod(param: MethodHookParam) {
            val target = param.thisObject
            highlightOf(target)?.let { attached[target] = it }
        }
    }).toList() + listOf(
        parse.hook(before = { param ->
            val block = pending.get() ?: return@hook
            pending.set(null)

            // Block background not set yet. Leaves matching token backgrounds transparent.
            block.builder.appendHighlighted(block.content, block.highlight, palette.of(block.rc, Color.TRANSPARENT))
            rendered.set(block.highlight)
            param.result = ArrayList<Any>()
        }),
        renderCodeBlock.hook(
            before = { param ->
                rendered.set(null)
                pending.set(null)

                val builder = param.args[0] as SpannableStringBuilder
                param.setObjectExtra(EXTRA_START, builder.length)
                if (spoilerIsHidden.invoke(param.args[2]) == true) return@hook

                val target = param.args[1]
                val highlight = attached[target] ?: highlightOf(target) ?: return@hook
                pending.set(Pending(builder, param.args[2], node.content(target), highlight))
            },
            after = { param ->
                val highlight = rendered.get()
                rendered.set(null)
                pending.set(null)

                val builder = param.args[0] as SpannableStringBuilder
                val start = param.getObjectExtra(EXTRA_START) as Int
                val fills = builder.blockFills(start)
                val colors = palette.of(param.args[2], fills.firstOrNull()?.color ?: Color.TRANSPARENT)
                if (highlight != null) for (fill in fills) fill.color = colors.resolve(highlight.bg)

                // Tapping a hidden spoiler reveals it instead
                if (taps != null && taps.enabled && spoilerIsHidden.invoke(param.args[2]) != true) {
                    val target = param.args[1]
                    val span = taps.span(node.lang(target), node.content(target), highlight, colors)
                    builder.span(span, start, builder.length)
                }
            },
        ),
    )
}

private class Pending(val builder: SpannableStringBuilder, val rc: Any, val content: String, val highlight: Highlight)

/** Discord's `CodeBlockContentNode` is a data class, so we toString and to get its field values. */
private class CodeBlockNode(dexFinder: DexFinder) {
    val type: Class<*> = dexFinder.findClass {
        matcher { addUsingString(TO_STRING_PREFIX) }
    } ?: error("CodeBlockContentNode not found")

    private val strings = type.declaredFields
        .filter { it.type == String::class.java && !Modifier.isStatic(it.modifiers) }
        .onEach { it.isAccessible = true }

    @Volatile
    private var fields: Pair<Field, Field>? = null

    fun lang(node: Any) = fieldsOf(node).first.get(node) as String

    fun content(node: Any) = fieldsOf(node).second.get(node) as String

    private fun fieldsOf(node: Any): Pair<Field, Field> = fields ?: run {
        val text = node.toString()
        val lang = strings.first { text.startsWith("$TO_STRING_PREFIX${it.get(node)}, content=") }
        (lang to strings.single { it != lang }).also { fields = it }
    }

    private companion object {
        const val TO_STRING_PREFIX = "CodeBlockContentNode(lang="
    }
}

private const val EXTRA_START = "start"

private inline fun Method.hook(
    crossinline before: (XC_MethodHook.MethodHookParam) -> Unit = {},
    crossinline after: (XC_MethodHook.MethodHookParam) -> Unit = {},
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = before(param)
    override fun afterHookedMethod(param: MethodHookParam) = after(param)
})

/** Appends [content] with [highlight], with placeholder colors taken from [palette]. */
internal fun SpannableStringBuilder.appendHighlighted(content: String, highlight: Highlight, palette: IntArray) {
    val text = highlight.text ?: content
    val start = length
    append(text)
    setSpan(ForegroundColorSpan(palette.resolve(highlight.fg)), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)

    val backgrounds = highlight.backgrounds
    for (i in 0 until backgrounds.size - 2 step 3) {
        val from = backgrounds[i]
        val to = backgrounds[i + 1]
        if (from in 0..<to && to <= text.length)
            span(BackgroundColorSpan(palette.resolve(backgrounds[i + 2])), start + from, start + to)
    }

    val spans = highlight.spans
    for (i in 0 until spans.size - 3 step 4) {
        val from = spans[i]
        val to = spans[i + 1]
        if (from < 0 || to > text.length || from >= to) continue

        val color = spans[i + 2]
        val style = spans[i + 3]
        if (color != highlight.fg) span(ForegroundColorSpan(palette.resolve(color)), start + from, start + to)

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

private val fillPaints = Collections.synchronizedMap(HashMap<Class<*>, List<Field>>())

/**
 * Extracts background fill paints applied from [start] onward:
 * - Scans for [LineBackgroundSpan] instances anchored at or after [start].
 * - Uses reflection to filter for [Paint.Style.FILL].
 */
private fun SpannableStringBuilder.blockFills(start: Int): List<Paint> =
    getSpans(start, length, LineBackgroundSpan::class.java).filter { getSpanStart(it) >= start }.flatMap { span ->
        val paints = fillPaints.getOrPut(span.javaClass) {
            span.javaClass.declaredFields.filter { it.type == Paint::class.java }.onEach { it.isAccessible = true }
        }
        paints.map { it.get(span) as Paint }.filter { it.style == Paint.Style.FILL }
    }
