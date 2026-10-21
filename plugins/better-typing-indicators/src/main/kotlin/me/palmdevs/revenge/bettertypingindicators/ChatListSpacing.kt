package me.palmdevs.revenge.bettertypingindicators

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import io.github.revenge.xposed.api.DexFinder
import org.luckypray.dexkit.wrap.DexMethod
import java.lang.ref.WeakReference

private const val CHAT_LIST_VIEW_MANAGER = "com.discord.chat.presentation.list.ChatListViewManager"
private const val RECYCLER_VIEW = "androidx.recyclerview.widget.RecyclerView"

private const val MAX_ANCESTORS = 30
private const val MAX_ATTEMPTS = 10
private const val RETRY_DELAY_MS = 16L

/** The space after the last message only fits a one line typing indicator. */
internal class ChatListSpacing(dexFinder: DexFinder) {
    private val recyclerView = dexFinder.classLoader.loadClass(RECYCLER_VIEW)
    private val chatListView = dexFinder.classLoader.loadClass(CHAT_LIST_VIEW_MANAGER).declaredMethods
        .single { it.name == "setFloatingChatInputEnabled" && !it.isBridge }
        .parameterTypes[0]

    private val setFloating = chatListView.getMethod("setFloatingChatInputEnabled", Boolean::class.javaPrimitiveType)
    private val setInverted = chatListView.getMethod("setInverted", Boolean::class.javaPrimitiveType)

    private val decorationField = dexFinder.findField {
        matcher {
            declaredClass(chatListView.name)
            addReadMethod(DexMethod(setFloating).serialize())
            addReadMethod(DexMethod(setInverted).serialize())
        }
    } ?: error("ChatListView.verticalSpacingItemDecoration not found")

    private val floatingField = dexFinder.findField {
        matcher {
            declaredClass(chatListView.name)
            type(Boolean::class.javaPrimitiveType!!)
            addWriteMethod(DexMethod(setFloating).serialize())
        }
    } ?: error("ChatListView.floatingTreatmentEnabled not found")

    private val endSpacingField = dexFinder.findField {
        matcher {
            declaredClass(decorationField.type.name)
            type(Int::class.javaPrimitiveType!!)
            addWriteMethod(DexMethod(setFloating).serialize())
        }
    } ?: error("VerticalSpacingItemDecoration.endItemSpacingPx not found")

    private val markItemDecorInsetsDirty = dexFinder.findMethod {
        matcher {
            declaredClass(RECYCLER_VIEW)
            paramCount(0)
            addCaller(DexMethod(setFloating).serialize())
            addInvoke($$"Landroid/view/View;->getLayoutParams()Landroid/view/ViewGroup$LayoutParams;")
        }
    } ?: error("RecyclerView.markItemDecorInsetsDirty not found")

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
        val previous = endSpacingField.getInt(decoration)
        val spacing = baseSpacing(list, decoration) + extraPx
        endSpacingField.setInt(decoration, spacing)
        if (spacing == previous) return

        val wasAtBottom = !list.canScrollVertically(1)
        markItemDecorInsetsDirty.invoke(list)
        list.measureAndLayout()

        // Keep the last message in view
        if (wasAtBottom && spacing > previous && list.canScrollVertically(1)) list.scrollBy(0, spacing - previous)
    }

    /** Discord's own end spacing for [list]. */
    private fun baseSpacing(list: View, decoration: Any): Int {
        endSpacingField.setInt(decoration, -1)
        // let setFloatingChatInputEnabled write the right spacing back
        setFloating.invoke(list, floatingField.getBoolean(list))
        return endSpacingField.getInt(decoration)
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
        if (view !is ViewGroup || recyclerView.isInstance(view)) return null
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
