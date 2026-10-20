package me.palmdevs.revenge.bettertypingindicators

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import java.lang.ref.WeakReference

private const val CHAT_LIST_VIEW = "com.discord.chat.presentation.list.ChatListView"
private const val SPACING_DECORATION = "com.discord.recycler_view.decorations.VerticalSpacingItemDecoration"

private const val MAX_ANCESTORS = 30
private const val MAX_ATTEMPTS = 10
private const val RETRY_DELAY_MS = 16L

/** The space after the last message only fits a one line typing indicator. */
internal class ChatListSpacing(classLoader: ClassLoader) {
    private val chatListView = classLoader.loadClass(CHAT_LIST_VIEW)
    private val decorationField = chatListView.getDeclaredField("verticalSpacingItemDecoration").apply { isAccessible = true }
    private val floatingField = chatListView.getDeclaredField("floatingTreatmentEnabled").apply { isAccessible = true }
    private val floatingSpacing = chatListView.getDeclaredField("FLOATING_END_ITEM_SPACING_PX").apply { isAccessible = true }.getInt(null)
    private val baseSpacing = chatListView.getDeclaredField("BASE_END_ITEM_SPACING_PX").apply { isAccessible = true }.getInt(null)
    private val invalidateItemDecorations = chatListView.getMethod("invalidateItemDecorations")

    private val decoration = classLoader.loadClass(SPACING_DECORATION)
    private val getEndSpacing = decoration.getMethod("getEndItemSpacingPx")
    private val setEndSpacing = decoration.getMethod("setEndItemSpacingPx", Int::class.javaPrimitiveType)

    // Main thread only
    private val lists = HashMap<Int, WeakReference<View>>()
    private val pending = HashMap<Int, Float>()

    private val handler = Handler(Looper.getMainLooper())

    fun set(activity: Activity, tag: Int, extraDp: Float, onFail: (String) -> Unit) {
        pending[tag] = extraDp
        trySet(activity, tag, MAX_ATTEMPTS, onFail)
    }

    private fun trySet(activity: Activity, tag: Int, attempts: Int, onFail: (String) -> Unit) {
        val extraDp = pending[tag] ?: return

        val list = lists[tag]?.get() ?: run {
            if (extraDp <= 0) {
                pending.remove(tag)
                return
            }

            // JS gets layout events before the view is mounted
            val view = activity.findViewById<View>(tag)
            if (view == null && attempts > 1) {
                handler.postDelayed({ trySet(activity, tag, attempts - 1, onFail) }, RETRY_DELAY_MS)
                return
            }

            pending.remove(tag)
            if (view == null) return onFail("No view with tag $tag")
            findChatList(view) ?: return onFail("No chat list near view with tag $tag")
        }

        pending.remove(tag)
        if (extraDp > 0) lists[tag] = WeakReference(list) else lists.remove(tag)
        apply(list, (extraDp * list.resources.displayMetrics.density).toInt())
    }

    fun dispose() {
        handler.post {
            pending.clear()
            for (ref in lists.values) ref.get()?.let { apply(it, 0) }
            lists.clear()
        }
    }

    private fun apply(list: View, extraPx: Int) {
        val decoration = decorationField.get(list)
        val base = if (floatingField.getBoolean(list)) floatingSpacing else baseSpacing
        val previous = getEndSpacing.invoke(decoration) as Int
        val spacing = base + extraPx
        if (spacing == previous) return

        val wasAtBottom = !list.canScrollVertically(1)
        setEndSpacing.invoke(decoration, spacing)
        invalidateItemDecorations.invoke(list)
        list.measureAndLayout()

        // Keep the last message in view
        if (wasAtBottom && spacing > previous && list.canScrollVertically(1)) list.scrollBy(0, spacing - previous)
    }

    private fun findChatList(view: View): View? {
        var child = view
        repeat(MAX_ANCESTORS) {
            val parent = child.parent as? ViewGroup ?: return null
            for (i in 0 until parent.childCount) {
                val sibling = parent.getChildAt(i)
                if (sibling !== child) findIn(sibling)?.let { return it }
            }
            child = parent
        }
        return null
    }

    private fun findIn(view: View): View? {
        if (chatListView.isInstance(view)) return view
        if (view !is ViewGroup || view.javaClass.name.endsWith("RecyclerView")) return null
        for (i in 0 until view.childCount) findIn(view.getChildAt(i))?.let { return it }
        return null
    }
}

// React Native ignores layout requests from native views
private fun View.measureAndLayout() {
    measure(
        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
}
