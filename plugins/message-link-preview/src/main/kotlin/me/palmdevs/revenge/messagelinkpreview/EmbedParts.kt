package me.palmdevs.revenge.messagelinkpreview

import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

private const val CHAT = "com.discord.chat"
private const val EMBED_VIEW = "$CHAT.presentation.message.view.EmbedView"
private const val EMBED_VIEW_BINDING = "$CHAT.databinding.EmbedViewBinding"
private const val EMBED = "$CHAT.bridge.embed.Embed"

// See res/layout/embed_view.xml
internal class EmbedParts(classLoader: ClassLoader) {
    val embedViewClass: Class<*> = classLoader.loadClass(EMBED_VIEW)

    private val binding = embedViewClass.getDeclaredField("binding").apply { isAccessible = true }
    private val bindingClass = classLoader.loadClass(EMBED_VIEW_BINDING)
    private val bindingDescription = bindingClass.getField("description")
    private val bindingFieldsTopWrap = bindingClass.getField("fieldsTopWrap")
    private val bindingFooterContainer = bindingClass.getField("footerContainer")
    private val bindingFooterText = bindingClass.getField("footerText")
    private val bindingSpacer = bindingClass.getField("spacer")
    private val embedId = classLoader.loadClass(EMBED).getDeclaredField("id").apply { isAccessible = true }

    fun id(embed: Any?) = embedId.get(embed) as String?

    fun description(view: FrameLayout) = bindingDescription.get(binding.get(view)) as TextView

    fun fieldsTopWrap(view: FrameLayout) = bindingFieldsTopWrap.get(binding.get(view)) as LinearLayout

    fun footer(view: FrameLayout) = bindingFooterContainer.get(binding.get(view)) as View

    fun footerText(view: FrameLayout) = bindingFooterText.get(binding.get(view)) as TextView

    fun spacer(view: FrameLayout) = bindingSpacer.get(binding.get(view)) as View
}
