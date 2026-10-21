package me.palmdevs.revenge.showtimeoutduration

import android.content.Context
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RelativeLayout
import android.widget.TextView
import io.github.revenge.xposed.api.DexFinder
import java.lang.reflect.Modifier

private const val CHAT_LIST_VIEW_MANAGER = "com.discord.chat.presentation.list.ChatListViewManager"
private const val DRAWEE_VIEW = "com.facebook.drawee.view.SimpleDraweeView"

private const val ICON_SIZE_DP = 16f
private const val ICON_MARGIN_END_DP = 4f
private const val MARGIN_BOTTOM_DP = 2f
private const val TEXT_SIZE_SP = 14f

internal class TimeoutLine(
    context: Context,
    private val style: Style,
    private val header: View,
    /** What the header was laid out below before this was added */
    val below: Int,
    /**
     * Discord's timeout icon next to the author's name that needs to be hidden.
     * Discord sets whether it shows on every bind, it'll come back on its own after this is gone.
     */
    private val discordIcon: View,
) : LinearLayout(context) {
    var messageId: String? = null
        private set
    var showsAuthor = false
        private set

    private var end: Long? = null

    private val density = context.resources.displayMetrics.density
    private val icon = style.newIcon(context)
    // Chat rows are often laid out with sizes measured earlier, so the text can't rely on being measured again when it changes.
    private val text = TextView(context).apply {
        isSingleLine = true
        ellipsize = TextUtils.TruncateAt.END
        style.applyFont(this)
        fontFeatureSettings = "tnum"
    }

    private val tick = Runnable { update() }
    private val relayout = Runnable { chatList()?.measureAndLayout() }

    init {
        id = generateViewId()
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 0, 0, (MARGIN_BOTTOM_DP * density).toInt())

        val iconSize = (ICON_SIZE_DP * density).toInt()
        addView(icon, LayoutParams(iconSize, iconSize).apply {
            marginEnd = (ICON_MARGIN_END_DP * density).toInt()
        })
        addView(text, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    }

    fun bind(messageId: String?, showsAuthor: Boolean, end: Long?) {
        this.messageId = messageId
        this.showsAuthor = showsAuthor
        this.end = end?.takeIf { showsAuthor }

        // The theme may have changed since the last message
        recolor()
        update()
    }

    fun recolor() = style.applyColors(icon, text)

    /** Takes this out of [parent]. */
    fun remove(parent: RelativeLayout) {
        removeCallbacks(tick)
        removeCallbacks(relayout)
        val list = chatList()

        val params = header.layoutParams as RelativeLayout.LayoutParams
        params.addRule(RelativeLayout.BELOW, below)
        header.layoutParams = params
        parent.removeView(this)
        list?.measureAndLayout()
    }

    private fun update() {
        removeCallbacks(tick)

        val remaining = end?.minus(System.currentTimeMillis())
        if (remaining == null || remaining <= 0) {
            setShown(false)
            return
        }

        setShown(true)
        discordIcon.visibility = GONE
        text.text = "${formatDuration(remaining)} timeout remaining"
        if (isAttachedToWindow) postDelayed(tick, remaining % 1000 + 1)
    }

    private fun setShown(shown: Boolean) {
        val visibility = if (shown) VISIBLE else GONE
        if (this.visibility == visibility) return

        this.visibility = visibility
        // Posted, as this may happen while the chat list binds or lays out this row
        if (isAttachedToWindow) {
            removeCallbacks(relayout)
            post(relayout)
        }
    }

    /**
     * React Native ignores layout requests from native views, Discord does this after its own updates too
     * (`ChatListView.measureAndLayout`). Views with a pending layout request are measured again.
     */
    private fun chatList() =
        generateSequence(parent) { it.parent }.firstOrNull(style.chatListView::isInstance) as View?

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        update()
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        removeCallbacks(relayout)
        super.onDetachedFromWindow()
    }

    /** Discord's critical feedback colors in its current theme, as ARGB. */
    class Colors(val text: Int, val icon: Int)

    class Style(dexFinder: DexFinder) {
        val chatListView: Class<*> = dexFinder.classLoader.loadClass(CHAT_LIST_VIEW_MANAGER).declaredMethods
            .single { it.name == "setFloatingChatInputEnabled" && !it.isBridge }
            .parameterTypes[0]

        private val draweeConstructor = dexFinder.classLoader.loadClass(DRAWEE_VIEW).getConstructor(Context::class.java)

        /** Set by JS, as R8 left Discord's theme objects without names to read them by. */
        @Volatile
        var colors: Colors? = null

        private val setTintColor = dexFinder.findMethod {
            matcher {
                modifiers(Modifier.STATIC)
                paramTypes(DRAWEE_VIEW, "java.lang.Integer")
                returnType("void")
            }
        } ?: error("ColorUtils.setTintColor not found")

        private val reactAsset = dexFinder.findClass {
            matcher {
                superClass("java.lang.Enum")
                usingEqStrings("ClockWarningIcon")
            }
        } ?: error("ReactAsset not found")
        private val setReactAsset = dexFinder.findMethod {
            matcher {
                modifiers(Modifier.STATIC)
                paramTypes(DRAWEE_VIEW, reactAsset.name)
            }
        } ?: error("ReactAssetUtils.setReactAsset not found")
        private val clockWarningIcon = reactAsset.enumConstant("ClockWarningIcon")

        private val discordFont = dexFinder.findClass {
            matcher {
                superClass("java.lang.Enum")
                usingEqStrings("PrimaryMedium")
            }
        } ?: error("DiscordFont not found")
        private val setDiscordFont = dexFinder.findMethod {
            matcher {
                modifiers(Modifier.STATIC)
                paramTypes("android.widget.TextView", discordFont.name)
            }
        } ?: error("DiscordFontUtils.setDiscordFont not found")
        private val primaryMedium = discordFont.enumConstant("PrimaryMedium")
        private val setTextSizeSp = dexFinder.findMethod {
            matcher {
                modifiers(Modifier.STATIC)
                paramTypes("android.widget.TextView", "float", "float")
                returnType("void")
            }
        } ?: error("setTextSizeSp not found")

        fun newIcon(context: Context) = (draweeConstructor.newInstance(context) as ImageView).also {
            setReactAsset.invoke(null, it, clockWarningIcon)
        }

        fun applyFont(text: TextView) {
            setDiscordFont.invoke(null, text, primaryMedium)
            setTextSizeSp.invoke(null, text, TEXT_SIZE_SP, TEXT_SIZE_SP)
        }

        fun applyColors(icon: ImageView, text: TextView) {
            val colors = colors ?: return
            text.setTextColor(colors.text)
            setTintColor.invoke(null, icon, colors.icon)
        }
    }
}

private fun Class<*>.enumConstant(name: String): Any =
    enumConstants!!.first { (it as Enum<*>).name == name }

private fun View.measureAndLayout() {
    measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
}

internal fun formatDuration(ms: Long): String {
    val totalSeconds = (ms + 999) / 1000
    val units = listOf(
        totalSeconds / 86400 to "d",
        totalSeconds / 3600 % 24 to "h",
        totalSeconds / 60 % 60 to "m",
        totalSeconds % 60 to "s",
    )

    return units.dropWhile { (value, unit) -> value == 0L && unit != "s" }
        .joinToString(" ") { (value, unit) -> value.toString().padStart(2, '0') + unit }
}
