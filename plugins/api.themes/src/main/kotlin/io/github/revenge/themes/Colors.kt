package io.github.revenge.themes

import android.content.Context
import android.content.res.Resources
import de.robv.android.xposed.XC_MethodHook
import io.github.revenge.Logger
import io.github.revenge.xposed.api.DexFinder
import org.luckypray.dexkit.wrap.DexMethod
import java.lang.reflect.Modifier
import java.util.EnumMap
import java.util.Locale

private const val THEME_MODULE = "com.discord.theme.ThemeModule"

/** Suffix of Discord's per-theme color resources, eg. `background_code_ash` is `BACKGROUND_CODE` of [ThemeBase.DARK]. */
internal val ThemeBase.resourceSuffix: String
    get() = when (this) {
        ThemeBase.DARK -> "ash"
        ThemeBase.DARKER -> "dark"
        ThemeBase.LIGHT -> "light"
        ThemeBase.MIDNIGHT -> "onyx"
    }

/** `TEXT_NORMAL` of [ThemeBase.DARK] to `text_normal_ash`, the color resource Discord's native theme reads. */
internal fun semanticColorResourceName(base: ThemeBase, name: String): String =
    "${name.lowercase(Locale.ROOT)}_${base.resourceSuffix}"

/** Parsed colors, keyed by lowercase color resource name. Invalid hex values are dropped. */
internal class NativeColors(colors: ThemeColors) {
    val resources: Map<String, Int> = buildMap {
        for ((name, hex) in colors.raw) parseHexColor(hex)?.let { put(name.lowercase(Locale.ROOT), it) }

        for ((id, values) in colors.semantic) {
            val base = ThemeBase.of(id) ?: continue
            for ((name, hex) in values) parseHexColor(hex)?.let { put(semanticColorResourceName(base, name), it) }
        }
    }
}

/**
 * Discord native theme colors, by color resource name.
 *
 * Discord's theme objects and other native views read colors through `getColorCompat`.
 * Semantic colors only apply where Discord has a resource for them, others follow raw colors.
 */
internal class DiscordNativeColors(private val dexFinder: DexFinder, private val log: Logger) {
    @Volatile
    private var colors: NativeColors? = null

    private var hooked = false

    // Theme objects cache their colors, so they are dropped on change
    private val themeCache: EnumMap<*, *>? by lazy {
        runCatching {
            val updateSaturation = dexFinder.classLoader.loadClass(THEME_MODULE)
                .getDeclaredMethod("updateSaturation", Double::class.javaPrimitiveType)
            val field = dexFinder.findField {
                matcher {
                    modifiers(Modifier.STATIC)
                    type(EnumMap::class.java)
                    addReadMethod(DexMethod(updateSaturation).serialize())
                }
            } ?: error("ThemeManager theme cache not found")
            field.isAccessible = true
            field.get(null) as EnumMap<*, *>
        }.onFailure { log.w("Native theme cache not found, colors apply after restart: ${it.message}") }.getOrNull()
    }

    @Synchronized
    fun apply(values: ThemeColors?) {
        val next = values?.let(::NativeColors)?.takeIf { it.resources.isNotEmpty() }
        if (next == null && colors == null) return

        colors = next
        if (next != null && !hooked) {
            hooked = true
            hookColorCompat()
        }
        themeCache?.clear()
    }

    private fun hookColorCompat() {
        val getColorCompat = runCatching {
            dexFinder.findMethod {
                matcher {
                    modifiers(Modifier.STATIC)
                    paramTypes("int", Resources.Theme::class.java.name, Resources::class.java.name)
                    returnType("int")
                    addInvoke($$"Landroid/content/res/Resources;->getColor(ILandroid/content/res/Resources$Theme;)I")
                }
            } ?: error("not found")
        }.getOrElse {
            log.w("getColorCompat(Resources) not found, colors won't apply natively: ${it.message}")
            return
        }

        getColorCompat.hookBefore {
            override(args[2] as? Resources, args[0] as Int)?.let { result = it }
        }

        runCatching {
            dexFinder.findMethod {
                matcher {
                    declaredClass(getColorCompat.declaringClass.name)
                    paramTypes(Context::class.java.name, "int")
                    returnType("int")
                    addInvoke("Landroid/content/Context;->getColor(I)I")
                }
            } ?: error("not found")
        }.onSuccess { method ->
            method.hookBefore {
                override((args[0] as? Context)?.resources, args[1] as Int)?.let { result = it }
            }
        }.onFailure { log.w("getColorCompat(Context) not hooked: ${it.message}") }
    }

    private fun override(resources: Resources?, id: Int): Int? {
        val values = colors?.resources ?: return null
        val name = runCatching { resources?.getResourceEntryName(id) }.getOrNull() ?: return null
        return values[name.lowercase(Locale.ROOT)]
    }
}
