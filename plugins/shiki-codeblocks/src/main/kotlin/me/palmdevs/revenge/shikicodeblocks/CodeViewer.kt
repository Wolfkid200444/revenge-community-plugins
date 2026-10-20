package me.palmdevs.revenge.shikicodeblocks

import android.app.Activity
import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.lang.reflect.Proxy

private const val NESTED_TOUCH = "com.discord.react_gesture_handler.nested_touch"
private const val NESTED_CLICKABLE_SPAN = "$NESTED_TOUCH.NestedClickableSpan"
private const val DISCORD_FONT = "com.discord.fonts.DiscordFont"
private const val DISCORD_FONT_SPAN = "com.discord.chat.presentation.textutils.DiscordFontSpan"

/**
 * Makes spans that open a code block in [showCodeViewer] when tapped.
 *
 * Message text uses Discord's own touch handling, which only taps spans implementing `NestedClickableSpan`.
 * The interface lives in Discord's class loader, so the spans are proxies of it. They aren't `CharacterStyle`s,
 * so the block keeps its look.
 */
internal class CodeBlockTaps(classLoader: ClassLoader, private val open: (CodeBlock) -> Unit) {
    /** Set by JS from the plugin's settings. Checked on taps too, so it applies to blocks already rendered. */
    @Volatile var enabled = true

    private val type = classLoader.loadClass(NESTED_CLICKABLE_SPAN)
    // The message row's long press (its actions) is registered on it with `setOnLongClickListenerNested`
    private val getNestedLongClickListener = classLoader.loadClass("$NESTED_TOUCH.NestedScrollOnTouchUtilsKt")
        .getMethod("getNestedLongClickListener", View::class.java)
    // The lowest priority, so anything else tappable in a block wins
    private val priority = classLoader.loadClass("$NESTED_CLICKABLE_SPAN\$TouchPriority").enumConstants!!.first()

    private val getTheme = classLoader.loadClass("com.discord.chat.presentation.textutils.RenderContext")
        .getMethod("getTheme")
    private val theme = classLoader.loadClass("com.discord.theme.DiscordThemeObject")
    private val getTextCode = theme.getMethod("getTextCode")
    private val getBackgroundCode = theme.getMethod("getBackgroundCode")

    /** A span for a block of [lang] and [content], rendered with [rc] (a `RenderContext`). */
    fun span(lang: String, content: String, highlight: Highlight?, rc: Any): Any {
        val theme = getTheme.invoke(rc)
        val block = CodeBlock(
            lang,
            content,
            highlight,
            fg = getTextCode.invoke(theme) as Int,
            bg = getBackgroundCode.invoke(theme) as Int,
        )

        return Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { proxy, method, args ->
            when (method.name) {
                "onClick" -> if (enabled) open(block)
                "onLongClick" -> handOverLongPress(args!![0] as View)
                "getTouchPriority" -> priority
                // Taps past the end of a line count too, so the whole block can be tapped
                "getExpandsTouchTargetToLineBounds" -> true
                "equals" -> proxy === args?.get(0)
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "CodeBlockTapSpan"
                else -> null
            }
        }
    }

    /**
     * Long presses go to the message row instead, as for the rest of the message.
     * Always handled, so Discord doesn't turn it into a tap that opens the viewer.
     */
    private fun handOverLongPress(view: View): Boolean {
        var parent = view.parent
        while (parent is View) {
            val listener = getNestedLongClickListener.invoke(null, parent) as View.OnLongClickListener?
            if (listener != null) {
                listener.onLongClick(parent)
                break
            }
            parent = parent.parent
        }
        return true
    }
}

/** Makes spans of Discord's code font, or returns `null` if this Discord version has none. */
internal fun codeFontOf(classLoader: ClassLoader): ((Context) -> Any)? = runCatching {
    val font = classLoader.loadClass(DISCORD_FONT)
    val codeNormal = font.getField("CodeNormal").get(null)
    val span = classLoader.loadClass(DISCORD_FONT_SPAN).getConstructor(Context::class.java, font)
    return { context: Context -> span.newInstance(context, codeNormal) }
}.getOrNull()

/** A code block as the viewer shows it. Colors are Discord's when it has no [highlight]. */
internal class CodeBlock(
    val lang: String,
    val content: String,
    val highlight: Highlight?,
    val fg: Int,
    val bg: Int,
)

/**
 * Shows [block] in a dialog where its text can be selected, as chat messages can't be.
 * Long lines scroll horizontally instead of wrapping.
 *
 * [codeFont] makes the span of Discord's code font, or `null` to use the system monospace font.
 */
internal fun showCodeViewer(activity: Activity, block: CodeBlock, codeFont: ((Context) -> Any)?) {
    val dp = activity.resources.displayMetrics.density
    fun px(value: Int) = (value * dp).toInt()

    val fg = block.highlight?.fg ?: block.fg
    val bg = block.highlight?.bg ?: block.bg
    val muted = withAlpha(fg, 0x99)

    val highlighted = SpannableStringBuilder().apply {
        if (block.highlight != null) appendHighlighted(block.content, block.highlight) else append(block.content)
        codeFont?.let { setSpan(it(activity), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    }

    val code = TextView(activity).apply {
        typeface = Typeface.MONOSPACE
        textSize = 13f
        setTextColor(fg)
        highlightColor = withAlpha(fg, 0x40)
        setPadding(px(16), px(4), px(16), px(16))
        setTextIsSelectable(true)
        setText(highlighted, TextView.BufferType.SPANNABLE)
    }

    val header = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(px(16), px(8), px(4), 0)

        addView(TextView(activity).apply {
            text = block.lang.trim().ifEmpty { "Code" }
            typeface = Typeface.MONOSPACE
            textSize = 12f
            setTextColor(muted)
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))

        addView(TextView(activity).apply {
            text = "Copy"
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(fg)
            setPadding(px(12), px(8), px(12), px(8))
            // The raw content, so ANSI keeps its colors when sent again. Selecting copies what's shown.
            setOnClickListener { copy(activity, block.content) }
        })
    }

    val card = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        // Taps around it close the viewer, not taps on it
        isClickable = true
        background = GradientDrawable().apply {
            setColor(bg)
            setStroke(px(1), withAlpha(fg, 0x22))
            cornerRadius = px(12).toFloat()
        }
        clipToOutline = true

        addView(header)
        addView(ScrollView(activity).apply {
            addView(HorizontalScrollView(activity).apply { addView(code) })
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }

    val dialog = Dialog(activity, android.R.style.Theme_DeviceDefault_Dialog_NoActionBar)
    dialog.apply {
        setContentView(FrameLayout(activity).apply {
            setPadding(px(16), px(24), px(16), px(24))
            setOnClickListener { dialog.dismiss() }
            addView(card, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER))
        })
        setCanceledOnTouchOutside(true)
        window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(MATCH_PARENT, WRAP_CONTENT)
        }
        show()
    }
}

private fun copy(context: Context, content: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("Code", content))
    // Android 13 and later confirm copies themselves
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU)
        Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
}

private fun withAlpha(color: Int, alpha: Int) = (color and 0x00FFFFFF) or (alpha shl 24)
