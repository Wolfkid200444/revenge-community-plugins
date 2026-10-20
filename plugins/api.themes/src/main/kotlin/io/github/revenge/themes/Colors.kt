package io.github.revenge.themes

import android.content.Context
import android.content.res.Resources
import de.robv.android.xposed.XC_MethodHook
import io.github.revenge.Logger
import java.lang.reflect.Method
import java.util.Locale

/** `TEXT_NORMAL` to `getTextNormal`, the getter name on Discord's native theme objects. */
internal fun semanticColorGetterName(name: String): String =
    "get" + name.split('_').filter { it.isNotEmpty() }.joinToString("") { part ->
        part.lowercase(Locale.ROOT).replaceFirstChar { it.uppercaseChar() }
    }

/** Parsed colors, keyed for the native hooks. Invalid hex values are dropped. */
internal class NativeColors(colors: ThemeColors) {
    /** Base to getter name to ARGB. */
    val semantic: Map<ThemeBase, Map<String, Int>> = colors.semantic.entries.mapNotNull { (id, values) ->
        val base = ThemeBase.of(id) ?: return@mapNotNull null
        base to values.entries.mapNotNull { (name, hex) ->
            parseHexColor(hex)?.let { semanticColorGetterName(name) to it }
        }.toMap()
    }.toMap()

    /** Lowercase color resource name to ARGB. */
    val raw: Map<String, Int> = colors.raw.entries.mapNotNull { (name, hex) ->
        parseHexColor(hex)?.let { name.lowercase(Locale.ROOT) to it }
    }.toMap()
}

/**
 * Discord native theme colors: the `com.discord.theme` theme objects (semantic) and
 * `ColorUtilsKt.getColorCompat` (raw, by color resource name).
 *
 * Getters are hooked on demand, so switching themes mid-session only adds hooks.
 */
internal class DiscordNativeColors(private val classLoader: ClassLoader, private val log: Logger) {
    @Volatile
    private var colors: NativeColors? = null

    private val themeClasses: Map<ThemeBase, List<Class<*>>> by lazy {
        mapOf(
            ThemeBase.DARK to listOf("AshTheme", "AshThemeExperiment"),
            ThemeBase.DARKER to listOf("DarkTheme", "DarkThemeExperiment"),
            ThemeBase.LIGHT to listOf("LightTheme", "LightThemeExperiment"),
            ThemeBase.MIDNIGHT to listOf("OnyxTheme", "OnyxThemeExperiment"),
        ).mapValues { (_, names) -> names.mapNotNull { classLoader.loadClassOrNull("com.discord.theme.$it") } }
    }

    private val hooked = mutableMapOf<Method, XC_MethodHook.Unhook>()
    private var rawHooked = false

    @Synchronized
    fun apply(values: ThemeColors?) {
        val next = values?.let(::NativeColors)
        colors = next
        if (next == null) return

        for ((base, getters) in next.semantic)
            for (clazz in themeClasses[base].orEmpty())
                for (name in getters.keys) hookGetter(base, clazz, name)

        if (next.raw.isNotEmpty() && !rawHooked) {
            rawHooked = true
            hookColorCompat()
        }
    }

    private fun hookGetter(base: ThemeBase, clazz: Class<*>, name: String) {
        val method = runCatching { clazz.getDeclaredMethod(name) }.getOrNull() ?: return
        if (method in hooked || method.returnType != Int::class.javaPrimitiveType) return

        hooked[method] = method.hookBefore {
            colors?.semantic?.get(base)?.get(name)?.let { result = it }
        }
    }

    private fun hookColorCompat() {
        val utils = classLoader.loadClassOrNull("com.discord.theme.utils.ColorUtilsKt") ?: run {
            log.w("ColorUtilsKt not found, raw colors won't apply natively")
            return
        }

        val overloads = listOf(
            arrayOf(Resources::class.java, Int::class.javaPrimitiveType, Resources.Theme::class.java),
            arrayOf(Context::class.java, Int::class.javaPrimitiveType),
        )

        for (params in overloads) runCatching {
            utils.getDeclaredMethod("getColorCompat", *params).hookBefore {
                val raw = colors?.raw?.takeIf { it.isNotEmpty() } ?: return@hookBefore
                val resources = when (val owner = args[0]) {
                    is Context -> owner.resources
                    is Resources -> owner
                    else -> return@hookBefore
                }
                val name = runCatching { resources.getResourceEntryName(args[1] as Int) }.getOrNull()
                    ?: return@hookBefore
                raw[name.lowercase(Locale.ROOT)]?.let { result = it }
            }
        }.onFailure { log.w("getColorCompat${params.contentToString()} not hooked: ${it.message}") }
    }
}
