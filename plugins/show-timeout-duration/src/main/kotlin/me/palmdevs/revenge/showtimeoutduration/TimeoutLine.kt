package me.palmdevs.revenge.showtimeoutduration

import android.content.Context
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RelativeLayout
import android.widget.TextView
import java.lang.reflect.Method

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
        style.applyColors(icon, text)
        update()
    }

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

    class Style(classLoader: ClassLoader) {
        val chatListView: Class<*> = classLoader.loadClass("com.discord.chat.presentation.list.ChatListView")

        private val draweeConstructor = classLoader.loadClass("com.facebook.drawee.view.SimpleDraweeView")
            .getConstructor(Context::class.java)
        private val drawee = classLoader.loadClass("com.facebook.drawee.view.SimpleDraweeView")

        private val getTheme = classLoader.loadClass("com.discord.theme.ThemeManagerKt").getMethod("getTheme")
        private val themeClass = classLoader.loadClass("com.discord.theme.DiscordThemeObject")
        private val textCritical = themeClass.getMethod("getTextFeedbackCritical")
        private val iconCritical = themeClass.getMethod("getIconFeedbackCritical")

        private val setTintColor = classLoader.loadClass("com.discord.theme.utils.ColorUtilsKt")
            .getMethod("setTintColor", drawee, Int::class.javaObjectType)
        private val setReactAsset: Method
        private val clockWarningIcon: Any

        private val setDiscordFont: Method
        private val primaryMedium: Any
        private val setTextSizeSp = classLoader.loadClass("com.discord.SetTextSizeSpKt")
            .getMethod("setTextSizeSp", TextView::class.java, Float::class.javaPrimitiveType, Float::class.javaPrimitiveType)

        init {
            val reactAsset = classLoader.loadClass("com.discord.react_asset_fetcher.ReactAsset")
            setReactAsset = classLoader.loadClass("com.discord.react_asset_fetcher.ReactAssetUtilsKt")
                .getMethod("setReactAsset", drawee, reactAsset)
            clockWarningIcon = reactAsset.getField("ClockWarningIcon").get(null)!!

            val discordFont = classLoader.loadClass("com.discord.fonts.DiscordFont")
            setDiscordFont = classLoader.loadClass("com.discord.fonts.DiscordFontUtilsKt")
                .getMethod("setDiscordFont", TextView::class.java, discordFont)
            primaryMedium = discordFont.getField("PrimaryMedium").get(null)!!
        }

        fun newIcon(context: Context) = (draweeConstructor.newInstance(context) as ImageView).also {
            setReactAsset.invoke(null, it, clockWarningIcon)
        }

        fun applyFont(text: TextView) {
            setDiscordFont.invoke(null, text, primaryMedium)
            setTextSizeSp.invoke(null, text, TEXT_SIZE_SP, TEXT_SIZE_SP)
        }

        fun applyColors(icon: ImageView, text: TextView) {
            val theme = getTheme.invoke(null)
            text.setTextColor(textCritical.invoke(theme) as Int)
            setTintColor.invoke(null, icon, iconCritical.invoke(theme) as Int)
        }
    }
}

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
