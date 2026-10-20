package me.palmdevs.revenge.messagelinkpreview

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.widget.FrameLayout

private const val FADE_DP = 80

/** Cuts off messages taller than [maxHeightPx] and fades them out. */
@SuppressLint("ViewConstructor")
internal class PreviewContainer(context: Context, private val bottomSpacePx: Int) : FrameLayout(context) {
    var maxHeightPx = Int.MAX_VALUE
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
        }

    var interactive = true

    private var cutOff = false

    init {
        // Make fading edge work
        setWillNotDraw(false)
        isVerticalFadingEdgeEnabled = true
        setFadingEdgeLength((FADE_DP * resources.displayMetrics.density).toInt())
    }

    override fun onInterceptTouchEvent(ev: MotionEvent) = !interactive || super.onInterceptTouchEvent(ev)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
        cutOff = measuredHeight > maxHeightPx
        // Cut off messages fade out at the embed's edge, so they don't get the embed's bottom padding
        setMeasuredDimension(measuredWidth, if (cutOff) maxHeightPx else measuredHeight + bottomSpacePx)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            child.layout(0, 0, child.measuredWidth, child.measuredHeight)
        }
    }

    override fun getTopFadingEdgeStrength() = 0f

    override fun getBottomFadingEdgeStrength() = if (cutOff) 1f else 0f
}
