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
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import java.lang.reflect.Proxy
import java.util.Collections
import java.util.WeakHashMap

/**
 * Discord's `ClickableSpan` behavior:
 * - Yields touch priority to nested tappable targets.
 * - Inherits the standard three-state colors, underline, and row-level long press.
 * - Expands tap hitboxes past line breaks to cover the full block width.
 */
private const val CLICKABLE_SPAN_DEFAULTS = 1 or 2 or 4 or 8 or 32 or 64

/**
 * Makes spans that open a code block in [showCodeViewer] when tapped.
 *
 * Message text uses Discord touch handling, tapping only Discord `ClickableSpan` instances.
 * Skips link recoloring for these spans to preserve block styling.
 */
internal class CodeBlockTaps(dexFinder: DexFinder, private val open: (CodeBlock) -> Unit) {
    /** Set by JS from the plugin's settings. Checked on taps too, so it applies to blocks already rendered. */
    @Volatile var enabled = true

    private val clickableSpan = dexFinder.findClass {
        matcher {
            superClass("android.text.style.ClickableSpan")
            addUsingString("ClickableSpan(touchPriority=")
        }
    } ?: error("ClickableSpan not found")
    private val constructor = clickableSpan.declaredConstructors.single()
    // Discord bundles Kotlin, so Function1 type differs
    private val function1 = constructor.parameterTypes[5]

    private val spans = Collections.synchronizedSet(Collections.newSetFromMap(WeakHashMap<Any, Boolean>()))

    val unhook: XC_MethodHook.Unhook = XposedBridge.hookMethod(
        clickableSpan.getMethod("updateDrawState", android.text.TextPaint::class.java),
        object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                if (param.thisObject in spans) param.result = null
            }
        },
    )

    fun span(lang: String, content: String, highlight: Highlight?, palette: IntArray): Any {
        val block = CodeBlock(lang, content, highlight, palette)
        val onClick = Proxy.newProxyInstance(function1.classLoader, arrayOf(function1)) { proxy, method, args ->
            when (method.name) {
                "invoke" -> {
                    if (enabled) open(block)
                    null
                }
                "equals" -> proxy === args?.get(0)
                "hashCode" -> System.identityHashCode(proxy)
                else -> "CodeBlockTap"
            }
        }

        return constructor.newInstance(null, null, null, null, null, onClick, CLICKABLE_SPAN_DEFAULTS)
            .also { spans += it }
    }
}

/** Makes spans of Discord's code font, or returns `null` if this Discord version has none. */
internal fun codeFontOf(dexFinder: DexFinder): ((Context) -> Any)? = runCatching {
    val font = dexFinder.findClass {
        matcher {
            superClass("java.lang.Enum")
            usingEqStrings("PrimaryMedium", "CodeNormal")
        }
    } ?: return null
    val codeNormal = font.enumConstants!!.first { (it as Enum<*>).name == "CodeNormal" }
    val span = dexFinder.findClass {
        matcher {
            superClass("android.text.style.MetricAffectingSpan")
            addMethod {
                name("<init>")
                paramTypes("android.content.Context", font.name)
            }
        }
    }?.getConstructor(Context::class.java, font) ?: return null
    return { context: Context -> span.newInstance(context, codeNormal) }
}.getOrNull()

/** A code block as the viewer shows it. Colors are Discord's ([palette]) when it has no [highlight]. */
internal class CodeBlock(
    val lang: String,
    val content: String,
    val highlight: Highlight?,
    val palette: IntArray,
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

    val palette = block.palette
    val fg = palette.resolve(block.highlight?.fg ?: palette[TEXT_CODE])
    val bg = palette.resolve(block.highlight?.bg ?: palette[BACKGROUND_CODE])
    val muted = withAlpha(fg, 0x99)

    val highlighted = SpannableStringBuilder().apply {
        if (block.highlight != null) appendHighlighted(block.content, block.highlight, palette)
        else append(block.content)
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
