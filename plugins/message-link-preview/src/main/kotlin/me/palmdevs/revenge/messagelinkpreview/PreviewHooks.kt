package me.palmdevs.revenge.messagelinkpreview

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import io.github.revenge.xposed.api.DexFinder
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.util.WeakHashMap

private const val CHAT_LIST_VIEW_MANAGER = "com.discord.chat.presentation.list.ChatListViewManager"

// Must match EmbedIdPrefix in JS
private const val EMBED_ID_PREFIX = "palmdevs.message-link-preview:"

private const val GAP_DP = 12

internal class PreviewHooks(dexFinder: DexFinder) {
    private class Bound(val messageId: String, val eventHandler: Any?, val componentProvider: Any?)

    private val previews = PreviewStore()
    private val messageViews = MessageViews(dexFinder)
    private val embeds = EmbedParts(dexFinder)

    @Volatile
    var maxHeightDp = 512

    @Volatile
    private var interactive = true

    // Main thread only
    private val bound = WeakHashMap<FrameLayout, Bound>()
    private val containers = WeakHashMap<FrameLayout, PreviewContainer>()
    private val shownViews = WeakHashMap<FrameLayout, ViewGroup>()

    private val bindingAdapter = ThreadLocal<Any?>()
    private val mainHandler = Handler(Looper.getMainLooper())

    private val chatListView = dexFinder.classLoader.loadClass(CHAT_LIST_VIEW_MANAGER).declaredMethods
        .single { it.name == "setFloatingChatInputEnabled" && !it.isBridge }
        .parameterTypes[0]

    private val adapterEventHandler: Field
    private val adapterComponentProvider: Field

    private val unhooks: List<XC_MethodHook.Unhook>

    init {
        val onBindViewHolder = dexFinder.findMethod {
            matcher {
                paramCount(2)
                usingEqStrings("reactions", "addNewReactionAccessibilityLabel")
            }
        } ?: error("MessageAccessoriesAdapter.onBindViewHolder not found")

        val adapterFieldOf = { type: Class<*> ->
            onBindViewHolder.declaringClass.declaredFields.single { it.type == type }.apply { isAccessible = true }
        }

        adapterEventHandler = adapterFieldOf(messageViews.eventHandlerClass)
        adapterComponentProvider = adapterFieldOf(messageViews.componentProviderClass)

        val setEmbed = embeds.setEmbed

        unhooks = listOf(
            // Embeds get the chat's event handler from the adapter binding them
            onBindViewHolder.hook(
                before = { param ->
                    // Previews have adapters of their own
                    param.setObjectExtra("previous", bindingAdapter.get())
                    bindingAdapter.set(param.thisObject)
                },
                after = { param -> bindingAdapter.set(param.getObjectExtra("previous")) },
            ),
            setEmbed.hook(after = { param -> bind(param.thisObject as FrameLayout, param.args[1]) }),
        )
    }

    fun put(json: String) {
        val updates = previews.put(json)
        if (updates.isEmpty()) return

        mainHandler.post {
            val rendered = bound.mapNotNull { (view, target) ->
                if (target.messageId in updates) {
                    render(view, target)
                    view
                } else null
            }

            relayout(rendered)
        }
    }

    fun setInteractive(enabled: Boolean) {
        if (interactive == enabled) return
        interactive = enabled

        mainHandler.post {
            for ((view, target) in bound) render(view, target)
        }
    }

    fun clear() {
        previews.clear()

        mainHandler.post {
            for (container in containers.values) container.visibility = View.GONE
        }
    }

    fun dispose() {
        for (unhook in unhooks) unhook.unhook()
        previews.clear()

        mainHandler.post {
            for (container in containers.values) (container.parent as ViewGroup?)?.removeView(container)
            for (view in bound.keys) setDescriptionWidth(view, ViewGroup.LayoutParams.MATCH_PARENT)
            containers.clear()
            shownViews.clear()
            bound.clear()
        }
    }

    private fun bind(view: FrameLayout, embed: Any?) {
        val id = embeds.idWith(embed, EMBED_ID_PREFIX)
        val adapter = bindingAdapter.get()

        if (id == null || adapter == null) {
            // Embed views are reused for other embeds
            if (bound.remove(view) != null) {
                containers[view]?.visibility = View.GONE
                setDescriptionWidth(view, ViewGroup.LayoutParams.MATCH_PARENT)
            }

            return
        }

        // So holding to copy only covers the channel
        setDescriptionWidth(view, ViewGroup.LayoutParams.WRAP_CONTENT)

        val target = Bound(
            id.removePrefix(EMBED_ID_PREFIX),
            adapterEventHandler.get(adapter),
            adapterComponentProvider.get(adapter),
        )

        bound[view] = target
        render(view, target)
    }

    private fun render(view: FrameLayout, target: Bound) {
        val footer = embeds.footer(view)
        val spacer = embeds.spacer(view)
        val preview = previews[target.messageId]
        val parsed = preview?.let(messageViews::parse)

        if (preview == null || parsed == null) {
            containers[view]?.visibility = View.GONE
            spacer.visibility = View.VISIBLE

            preview?.error?.let {
                embeds.footerText(view).text = it
                footer.visibility = View.VISIBLE
            }

            return
        }

        footer.visibility = View.GONE
        // The container adds it back, EmbedView.reset shows it again for other embeds
        spacer.visibility = View.GONE

        val interactive = interactive
        val container = containers[view] ?: newContainer(view, spacer.layoutParams.height)
        container.visibility = View.VISIBLE
        container.maxHeightPx = (maxHeightDp * view.resources.displayMetrics.density).toInt()
        container.interactive = interactive

        var shown = shownViews[view]
        if (shown != null && !messageViews.isFor(shown, preview.kind)) {
            container.removeView(shown)
            shown = null
        }

        val messageView = shown ?: messageViews.create(view.context, preview.kind).also {
            container.addView(
                it,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
            )
            shownViews[view] = it
        }

        // Discord tracks some touches itself, so the container can't stop them all
        val eventHandler = if (interactive) target.eventHandler else null
        messageViews.bind(messageView, preview.kind, parsed, eventHandler, target.componentProvider)
    }

    private fun newContainer(view: FrameLayout, bottomSpacePx: Int): PreviewContainer {
        val parent = embeds.fieldsTopWrap(view)
        val container = PreviewContainer(view.context, bottomSpacePx)

        // Stretched over the message's side margins, so the avatar lines up with the channel's icon
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        params.topMargin = (GAP_DP * view.resources.displayMetrics.density).toInt()
        params.marginStart = -view.dimen("message_avatar_margin_start")
        params.marginEnd = -view.dimen("message_horizontal_spacing")

        parent.addView(container, parent.indexOfChild(embeds.description(view)) + 1, params)
        containers[view] = container

        return container
    }

    private fun setDescriptionWidth(view: FrameLayout, width: Int) {
        val description = embeds.description(view)
        val params = description.layoutParams
        if (params.width == width) return

        params.width = width
        description.layoutParams = params
    }

    // React Native ignores layout requests from native views, Discord does the same after its own updates
    private fun relayout(views: List<View>) {
        val lists = views.mapNotNullTo(HashSet()) { view ->
            generateSequence(view.parent) { it.parent }.firstOrNull(chatListView::isInstance) as View?
        }

        for (list in lists) {
            list.measure(
                View.MeasureSpec.makeMeasureSpec(list.width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(list.height, View.MeasureSpec.EXACTLY),
            )
            list.layout(list.left, list.top, list.right, list.bottom)
        }
    }
}

private fun View.dimen(name: String): Int {
    val id = resources.getIdentifier(name, "dimen", context.packageName)
    return if (id == 0) 0 else resources.getDimensionPixelSize(id)
}

private inline fun Method.hook(
    crossinline before: (XC_MethodHook.MethodHookParam) -> Unit = {},
    crossinline after: (XC_MethodHook.MethodHookParam) -> Unit = {},
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = before(param)
    override fun afterHookedMethod(param: MethodHookParam) = after(param)
})
