package me.palmdevs.revenge.shikicodeblocks

import android.text.style.ForegroundColorSpan
import io.github.revenge.xposed.api.DexFinder
import java.lang.reflect.Method
import java.lang.reflect.Modifier

/** Discord syntax highlighting roles mapped to JS `Roles` indices. */
private val Providers = listOf(
    "default", // text
    "keyword",
    "literal", // string
    "comment",
    "generics", // builtin
    "types", // type
    "identifier", // title
    "params", // property
    "addition",
    "deletion",
)

internal const val BACKGROUND_CODE = 0
internal const val TEXT_CODE = 1

/**
 * Gets active Discord theme syntax colors using reflection.
 *
 * Handles placeholder ARGB values (`0x010000xx`, where `xx` indexes [Providers]) sent from the JS,
 * and swaps them with actual theme colors from Discord's obfuscated `CodeStyleProviders`.
 */
internal class DiscordPalette(dexFinder: DexFinder, codeStyle: Class<*>) {
    private val providers: List<Any>
    private val provide: Method

    init {
        val providersClass = dexFinder.findClass {
            matcher { addUsingString(TO_STRING_PREFIX) }
        } ?: error("CodeStyleProviders not found")
        val instance = codeStyle.declaredFields
            .single { Modifier.isStatic(it.modifiers) && it.type == providersClass }
            .apply { isAccessible = true }
            .get(null)!!

        // Parse data class toString() to map obfuscated field values back to their role names.
        val text = instance.toString()
        val byName = providersClass.declaredFields
            .filter { !Modifier.isStatic(it.modifiers) }
            .onEach { it.isAccessible = true }
            .map { it.get(instance)!! }
            .associateBy { provider -> Regex("""(\w+)StyleProvider=${Regex.escape(provider.toString())}""").find(text)!!.groupValues[1] }

        providers = Providers.map { byName[it] ?: error("No $it style provider in$text") }
        provide = providers.first().javaClass.declaredMethods
            .single { it.parameterCount == 1 && List::class.java.isAssignableFrom(it.returnType) }
            .apply { isAccessible = true }
    }

    /** Gets the palette for [rc] (`RenderContext`), putting [background] at index [BACKGROUND_CODE]. */
    fun of(rc: Any, background: Int): IntArray {
        val colors = IntArray(providers.size + 1)
        colors[BACKGROUND_CODE] = background
        for ((i, provider) in providers.withIndex()) colors[i + 1] = colorOf(provider, rc) ?: colors[TEXT_CODE]
        return colors
    }

    private fun colorOf(provider: Any, rc: Any) = (provide.invoke(provider, rc) as List<*>)
        .firstNotNullOfOrNull { (it as? ForegroundColorSpan)?.foregroundColor }

    private companion object {
        const val TO_STRING_PREFIX = "CodeStyleProviders(defaultStyleProvider="
    }
}

/** Replaces [color] with the palette color if it matches the placeholder format (`0x010000xx`). */
internal fun IntArray.resolve(color: Int): Int =
    if (color ushr 24 == 0x01 && color and 0x00FFFF00 == 0) getOrElse(color and 0xFF) { color } else color