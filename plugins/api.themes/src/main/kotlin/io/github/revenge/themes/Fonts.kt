package io.github.revenge.themes

import android.content.res.AssetManager
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.graphics.fonts.FontStyle
import android.os.Build
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedHelpers
import io.github.revenge.Logger
import java.io.File
import java.util.concurrent.ConcurrentHashMap

private const val FONTS_ASSET_PATH = "fonts/"

/** Family name prefix of fonts registered for previews, so they never collide with names the app requests. */
internal const val FONT_PREVIEW_PREFIX = "revenge-themes-preview:"
private val FONT_FILE_EXTENSIONS = arrayOf(".ttf", ".otf")

private const val DEFAULT_WEIGHT = 400
private const val MAX_CUSTOM_FALLBACKS = 64

/**
 * Picks the variant closest to [weight] and [italic], like CSS font matching:
 * a matching slant first, then the smallest weight distance, heavier on ties.
 */
internal fun closestFontVariant(variants: List<FontVariant>, weight: Int, italic: Boolean): FontVariant? =
    variants.minWithOrNull(
        compareBy<FontVariant> { if (it.italic == italic) 0 else 1 }
            .thenBy { kotlin.math.abs(it.weight - weight) }
            .thenByDescending { it.weight },
    )

/**
 * Font variation settings for [axes], eg. `'wght' 600, 'slnt' -10`, or `null` without valid axes.
 * Axis tags have exactly four characters.
 */
internal fun fontVariationSettingsOf(axes: Map<String, Float>): String? =
    axes.entries
        .filter { (tag, value) -> tag.length == 4 && tag.all { it.code in 0x20..0x7e && it != '\'' } && value.isFinite() }
        .joinToString(", ") { (tag, value) -> "'$tag' ${value.toBigDecimal().stripTrailingZeros().toPlainString()}" }
        .ifEmpty { null }

/** Splits a React Native `fontFamily` value into its fallback chain. */
internal fun splitFontFamilies(name: String): List<String> =
    name.split(',').map { it.trim() }.filter { it.isNotEmpty() }

/**
 * Font pack applied through React Native's `ReactFontManager`.
 *
 * Only names with a pack entry change. Everything else keeps the stock lookup.
 */
internal class FontOverrides(
    private val families: Map<String, List<FontVariant>>,
    private val log: Logger,
) {
    private data class Key(val name: String, val weight: Int, val italic: Boolean)

    private val cache = ConcurrentHashMap<Key, Typeface>()
    private val unhandled = ConcurrentHashMap.newKeySet<String>()

    private val failed = ConcurrentHashMap.newKeySet<Key>()
    private val brokenFiles = ConcurrentHashMap.newKeySet<String>()

    fun handles(names: List<String>) = names.any { it in families }

    fun typeface(name: String, weight: Int, italic: Boolean, assets: AssetManager?): Typeface? {
        val key = Key(name, weight, italic)
        cache[key]?.let { return it }

        if (name in unhandled || key in failed) return null
        val names = splitFontFamilies(name)
        if (!handles(names)) {
            unhandled.add(name)
            return null
        }

        val typeface = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) buildWithFallbacks(names, weight, italic, assets)
            else buildLegacy(names, weight, italic)
        }.onFailure { log.e("Failed to build typeface for $name", it) }.getOrNull()

        if (typeface == null) {
            failed.add(key)
            return null
        }

        cache[key] = typeface
        return typeface
    }

    private fun buildWithFallbacks(names: List<String>, weight: Int, italic: Boolean, assets: AssetManager?): Typeface? {
        val chain = names.mapNotNull { familyOf(it, assets) }.take(MAX_CUSTOM_FALLBACKS)
        if (chain.isEmpty()) return null

        val builder = Typeface.CustomFallbackBuilder(chain.first())
        for (family in chain.drop(1)) builder.addCustomFallback(family)

        val slant = if (italic) FontStyle.FONT_SLANT_ITALIC else FontStyle.FONT_SLANT_UPRIGHT
        return builder.setStyle(FontStyle(weight.coerceIn(FontStyle.FONT_WEIGHT_MIN, FontStyle.FONT_WEIGHT_MAX), slant))
            .build()
    }

    private fun familyOf(name: String, assets: AssetManager?): FontFamily? {
        val variants = families[name]
        if (variants == null) return assetFamilyOf(name, assets)

        var builder: FontFamily.Builder? = null
        val seen = mutableSetOf<Pair<Int, Boolean>>()

        for (variant in variants) {
            // FontFamily rejects two fonts with one style.
            if (!seen.add(variant.weight to variant.italic)) continue

            if (variant.path in brokenFiles) continue

            val file = File(variant.path)
            if (!file.isFile) {
                brokenFiles.add(variant.path)
                log.w("Missing font file for $name: ${variant.path}")
                continue
            }

            val font = runCatching {
                Font.Builder(file)
                    .setWeight(variant.weight.coerceIn(FontStyle.FONT_WEIGHT_MIN, FontStyle.FONT_WEIGHT_MAX))
                    .setSlant(if (variant.italic) FontStyle.FONT_SLANT_ITALIC else FontStyle.FONT_SLANT_UPRIGHT)
                    .apply { fontVariationSettingsOf(variant.axes)?.let(::setFontVariationSettings) }
                    .build()
            }.onFailure {
                brokenFiles.add(variant.path)
                log.e("Failed to load font ${variant.path}", it)
            }.getOrNull() ?: continue

            builder = builder?.addFont(font) ?: FontFamily.Builder(font)
        }

        return builder?.build()
    }

    /** Stock lookup of `fonts/<name>.ttf|.otf` from the app's assets, for names without a pack entry. */
    private fun assetFamilyOf(name: String, assets: AssetManager?): FontFamily? {
        if (assets == null) return null
        for (ext in FONT_FILE_EXTENSIONS) {
            val font = runCatching { Font.Builder(assets, "$FONTS_ASSET_PATH$name$ext").build() }.getOrNull()
            if (font != null) return FontFamily.Builder(font).build()
        }
        return null
    }

    private fun buildLegacy(names: List<String>, weight: Int, italic: Boolean): Typeface? {
        val variants = names.firstNotNullOfOrNull { families[it] } ?: return null
        val variant = closestFontVariant(variants.filter { File(it.path).isFile }, weight, italic) ?: return null
        val settings = fontVariationSettingsOf(variant.axes)

        val base = if (settings != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Typeface.Builder(variant.path)
                .setFontVariationSettings(settings)
                .setWeight(variant.weight.coerceIn(1, 1000))
                .setItalic(variant.italic)
                .build()
        else Typeface.createFromFile(variant.path)

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Typeface.create(base, weight, italic)
        else Typeface.create(base, (if (weight >= 700) Typeface.BOLD else 0) or (if (italic) Typeface.ITALIC else 0))
    }
}

/**
 * Hooks `ReactFontManager.getTypeface(String, TypefaceStyle, AssetManager)`, the funnel every
 * React Native text style goes through. It runs before RN collapses weight and italic into one of four styles.
 */
internal fun hookReactFontManager(
    classLoader: ClassLoader,
    overrides: (name: String) -> FontOverrides?,
    log: Logger,
): XC_MethodHook.Unhook? {
    val manager = classLoader.loadClassOrNull("com.facebook.react.common.assets.ReactFontManager")
        ?: classLoader.loadClassOrNull("com.facebook.react.views.text.ReactFontManager")
    val style = classLoader.loadClassOrNull("com.facebook.react.common.assets.ReactFontManager\$TypefaceStyle")

    if (manager == null || style == null) {
        log.w("ReactFontManager not found, fonts won't apply")
        return null
    }

    val method = runCatching {
        manager.getDeclaredMethod("getTypeface", String::class.java, style, AssetManager::class.java)
    }.getOrElse {
        log.w("ReactFontManager.getTypeface(String, TypefaceStyle, AssetManager) not found, fonts won't apply")
        return null
    }

    return method.hookBefore {
        val name = args[0] as? String ?: return@hookBefore
        val fonts = overrides(name) ?: return@hookBefore
        val typefaceStyle = args[1] ?: return@hookBefore

        val weight = runCatching { XposedHelpers.getIntField(typefaceStyle, "weight") }.getOrDefault(DEFAULT_WEIGHT)
        val italic = runCatching { XposedHelpers.getBooleanField(typefaceStyle, "italic") }.getOrDefault(false)

        fonts.typeface(name, weight, italic, args[2] as? AssetManager)?.let { result = it }
    }
}
