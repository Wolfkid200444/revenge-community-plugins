package me.palmdevs.revenge.whoreacted

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.reflect.Constructor

private const val DRAWEE_VIEW = "com.facebook.drawee.view.SimpleDraweeView"
/** Default avatars are bundled with Discord, sent as their resource name after this. Must match `ResourcePrefix` in JS. */
private const val RESOURCE_PREFIX = "res:"

internal const val MAX_AVATARS = 5

private const val AVATAR_SIZE_DP = 18f
private const val AVATAR_STEP_DP = 12f
private const val RING_DP = 1.5f

private const val MARGIN_START_DP = 8f
private const val PLACEHOLDER_COLOR = 0x33808080
private const val MORE_TEXT_SIZE_SP = 10f
private const val MORE_PADDING_DP = 4f
/** ...of the count's color, for the "+N" pill's background */
private const val MORE_BACKGROUND_ALPHA = 0.2f

/**
 * Overlapping round avatars.
 *
 * Discord uses Fresco's `SimpleDraweeView` for images, so we can use its cache.
 */
internal class AvatarStack(context: Context, private val draweeConstructor: Constructor<*>) : ViewGroup(context) {
    private val density = context.resources.displayMetrics.density
    private val size = (AVATAR_SIZE_DP * density).toInt()
    private val step = (AVATAR_STEP_DP * density).toInt()
    private val ring = RING_DP * density

    private val clearPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    }

    private val avatars = mutableListOf<ImageView>()
    private val more = TextView(context).apply {
        gravity = Gravity.CENTER
        maxLines = 1
        includeFontPadding = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, MORE_TEXT_SIZE_SP)
        val padding = (MORE_PADDING_DP * density).toInt()
        setPadding(padding, 0, padding, 0)
        minWidth = size
        background = GradientDrawable().apply { cornerRadius = size / 2f }
        visibility = GONE
    }

    init {
        addView(more)
    }

    /**
     * Displays up to [MAX_AVATARS] of [urls]. More than [MAX_AVATARS] reactors ([count]),
     * the last avatar is replaced with "+N" in the count's [color] and [typeface].
     */
    fun setAvatars(urls: List<String>, count: Int, color: Int, typeface: Typeface?) {
        val shown = if (count > MAX_AVATARS) urls.take(MAX_AVATARS - 1) else urls.take(MAX_AVATARS)

        while (avatars.size > shown.size) removeView(avatars.removeAt(avatars.size - 1))
        while (avatars.size < shown.size) createAvatar().also {
            avatars += it
            // Before "+N", which stays on top
            addView(it, avatars.size - 1)
        }

        shown.forEachIndexed { i, url ->
            val avatar = avatars[i]
            if (avatar.tag != url) {
                avatar.tag = url
                // SimpleDraweeView overrides this to load with Fresco
                avatar.setImageURI(resolve(url))
            }
        }

        val hidden = count - shown.size
        more.visibility = if (count > MAX_AVATARS && hidden > 0) VISIBLE else GONE
        if (more.visibility == VISIBLE) {
            more.text = "+$hidden"
            more.setTextColor(color)
            more.typeface = typeface
            (more.background as GradientDrawable).setColor(withAlpha(color, MORE_BACKGROUND_ALPHA))
        }

        requestLayout()
        invalidate()
    }

    /** Bundled avatars to Fresco's `res:///<id>`, unknown ones show the placeholder. */
    private fun resolve(url: String): Uri? {
        if (!url.startsWith(RESOURCE_PREFIX)) return Uri.parse(url)

        @Suppress("DiscouragedApi")
        val id = resources.getIdentifier(url.removePrefix(RESOURCE_PREFIX), "drawable", context.packageName)
        return if (id != 0) Uri.parse("res:///$id") else null
    }

    private fun createAvatar() = (draweeConstructor.newInstance(context) as ImageView).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(PLACEHOLDER_COLOR)
        }
        outlineProvider = ViewOutlineProvider.BACKGROUND
        clipToOutline = true
    }

    private fun visibleChildren() = (0 until childCount).map(::getChildAt).filter { it.visibility != GONE }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val exactly = MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY)
        for (avatar in avatars) avatar.measure(exactly, exactly)
        more.measure(MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED), exactly)

        val children = visibleChildren()
        val width = children.lastOrNull()?.let { step * (children.size - 1) + it.measuredWidth } ?: 0
        setMeasuredDimension(width, size)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val rtl = layoutDirection == View.LAYOUT_DIRECTION_RTL
        visibleChildren().forEachIndexed { i, child ->
            val left = if (rtl) width - i * step - child.measuredWidth else i * step
            child.layout(left, 0, left + child.measuredWidth, size)
        }
    }

    override fun dispatchDraw(canvas: Canvas) {
        // The rings are cleared on a layer, not through to the pill
        val layer = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)
        super.dispatchDraw(canvas)
        canvas.restoreToCount(layer)
    }

    override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
        // The first item has nothing below it
        if (child !== (avatars.firstOrNull() ?: more)) {
            val radius = size / 2f + ring
            canvas.drawRoundRect(
                child.left - ring, child.top - ring, child.right + ring, child.bottom + ring,
                radius, radius, clearPaint,
            )
        }
        return super.drawChild(canvas, child, drawingTime)
    }

    companion object {
        fun draweeConstructor(classLoader: ClassLoader): Constructor<*> =
            classLoader.loadClass(DRAWEE_VIEW).getConstructor(Context::class.java)

        fun layoutParams(context: Context) = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
            marginStart = (MARGIN_START_DP * context.resources.displayMetrics.density).toInt()
        }

        private fun withAlpha(color: Int, alpha: Float) =
            Color.argb((Color.alpha(color) * alpha).toInt(), Color.red(color), Color.green(color), Color.blue(color))
    }
}
