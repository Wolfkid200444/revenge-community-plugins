package me.palmdevs.revenge.messagelinkpreview

import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import io.github.revenge.xposed.api.DexFinder
import java.lang.reflect.Modifier
import java.util.WeakHashMap

// See res/layout/embed_view.xml
internal class EmbedParts(dexFinder: DexFinder) {
    val setEmbed = dexFinder.findMethod {
        matcher { usingEqStrings("margins", "embed") }
    } ?: error("EmbedView.setEmbed not found")

    private val embedStrings = setEmbed.parameterTypes[1].declaredFields
        .filter { it.type == String::class.java && !Modifier.isStatic(it.modifiers) }
        .onEach { it.isAccessible = true }

    // Main thread only
    private val parts = WeakHashMap<FrameLayout, Parts>()

    private class Parts(view: FrameLayout) {
        val description = view.byId<TextView>("description")
        val fieldsTopWrap = view.byId<LinearLayout>("fields_top_wrap")
        val footer = view.byId<View>("footer_container")
        val footerText = view.byId<TextView>("footer_text")
        val spacer = view.byId<View>("spacer")
    }

    /** The embed's ID if it starts with [prefix]. Its other strings never do, and R8 renamed the field. */
    fun idWith(embed: Any?, prefix: String): String? = embed?.let {
        embedStrings.firstNotNullOfOrNull { field -> (field.get(it) as String?)?.takeIf { id -> id.startsWith(prefix) } }
    }

    private fun parts(view: FrameLayout) = parts.getOrPut(view) { Parts(view) }

    fun description(view: FrameLayout) = parts(view).description

    fun fieldsTopWrap(view: FrameLayout) = parts(view).fieldsTopWrap

    fun footer(view: FrameLayout) = parts(view).footer

    fun footerText(view: FrameLayout) = parts(view).footerText

    fun spacer(view: FrameLayout) = parts(view).spacer
}

@Suppress("DiscouragedApi")
private fun <T : View> View.byId(name: String): T =
    findViewById(resources.getIdentifier(name, "id", context.packageName))
        ?: error("No $name in ${javaClass.name}")
