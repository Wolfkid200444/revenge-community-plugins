package io.github.revenge.themes

import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

internal const val THEMES_STATE_FORMAT = 1

/** Discord theme names, keyed the way JS `tokens.themes` names them. */
internal enum class ThemeBase(val id: String) {
    DARK("dark"),
    DARKER("darker"),
    LIGHT("light"),
    MIDNIGHT("midnight");

    companion object {
        fun of(id: String): ThemeBase? = entries.find { it.id == id }
    }
}

internal data class ThemeColors(
    /** Base id to semantic color name to hex. */
    val semantic: Map<String, Map<String, String>> = emptyMap(),
    /** Raw color name to hex. */
    val raw: Map<String, String> = emptyMap(),
)

internal data class FontVariant(
    val path: String,
    val weight: Int = 400,
    val italic: Boolean = false,
    /** Variable font axis tag to value, eg. `wght` to 600. */
    val axes: Map<String, Float> = emptyMap(),
)

internal data class ColorsSelection(
    val plugin: String,
    val group: String,
    val theme: String,
    val values: ThemeColors,
)

/** Where one font family comes from. */
internal data class FontSource(
    val plugin: String,
    val group: String,
    val pack: String,
    val variants: List<FontVariant>,
)

/** Font families picked one by one, each from any pack. */
internal data class FontsSelection(
    /** Requested family name to the pack providing it. */
    val sources: Map<String, FontSource>,
) {
    /** Requested family name to its variants. */
    val families: Map<String, List<FontVariant>> get() = sources.mapValues { it.value.variants }
}

internal data class IconsSelection(
    val plugin: String,
    /** Empty in states written before packs had groups. */
    val group: String = "",
    val pack: String,
    /** Asset name to absolute file path. */
    val icons: Map<String, String>,
    /** Drawable resource name to absolute file path, for native consumers. */
    val drawables: Map<String, String> = emptyMap(),
)

internal data class EmojiSelection(
    val plugin: String,
    val group: String,
    val pack: String,
    /** Absolute directory of images named like Discord's, eg. `emoji-1f600.png`. */
    val images: String? = null,
    /** Absolute font file, or [SYSTEM_EMOJI_FONT]. Draws emoji [images] lacks. */
    val font: String? = null,
)

/** User's background settings, applied by JS. Unset values keep the color theme's. */
internal data class BackgroundSettings(
    /** `theme`, `custom` or `none`. */
    val source: String,
    /** Absolute image path, for `custom`. */
    val path: String? = null,
    val opacity: Double? = null,
    val blur: Double? = null,
    val dimming: Double? = null,
)

internal data class ThemesState(
    val format: Int = THEMES_STATE_FORMAT,
    val colors: ColorsSelection? = null,
    val fonts: FontsSelection? = null,
    val icons: IconsSelection? = null,
    val emoji: EmojiSelection? = null,
    val background: BackgroundSettings? = null,
)

/** Reads and writes `state.json` in the plugin's storage dir. */
internal class ThemesStateStore(dir: File) {
    private val file = AtomicFile(File(dir, "state.json"))

    @Volatile
    var state: ThemesState = ThemesState()
        private set

    /** Loads the state, falling back to empty on a missing, malformed or newer file. */
    fun load(onError: (Throwable) -> Unit): ThemesState {
        state = runCatching {
            if (!file.baseFile.isFile) return@runCatching ThemesState()
            val parsed = themesStateOf(JSONObject(file.readFully().decodeToString()))
            if (parsed.format != THEMES_STATE_FORMAT) ThemesState() else parsed
        }.onFailure(onError).getOrDefault(ThemesState())
        return state
    }

    @Synchronized
    fun update(transform: (ThemesState) -> ThemesState): ThemesState {
        val next = transform(state)
        val out = file.startWrite()
        try {
            out.write(next.toJson().toString().encodeToByteArray())
            file.finishWrite(out)
        } catch (e: Throwable) {
            file.failWrite(out)
            throw e
        }
        state = next
        return next
    }
}

// JSON, in the shape JS reads and writes. Unknown keys are ignored.

internal fun themesStateOf(json: JSONObject) = ThemesState(
    format = json.optInt("format", THEMES_STATE_FORMAT),
    colors = json.optJSONObject("colors")?.let(::colorsSelectionOf),
    fonts = json.optJSONObject("fonts")?.let(::fontsSelectionOf),
    icons = json.optJSONObject("icons")?.let(::iconsSelectionOf),
    emoji = json.optJSONObject("emoji")?.let(::emojiSelectionOf),
    background = json.optJSONObject("background")?.let(::backgroundSettingsOf),
)

internal fun backgroundSettingsOf(json: JSONObject) = BackgroundSettings(
    source = json.getString("source"),
    path = json.optStringOrNull("path"),
    opacity = json.optDoubleOrNull("opacity"),
    blur = json.optDoubleOrNull("blur"),
    dimming = json.optDoubleOrNull("dimming"),
)

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (isNull(key)) null else optDouble(key).takeIf { it.isFinite() }

internal fun colorsSelectionOf(json: JSONObject) = ColorsSelection(
    plugin = json.getString("plugin"),
    group = json.getString("group"),
    theme = json.getString("theme"),
    values = json.optJSONObject("values")?.let(::themeColorsOf) ?: ThemeColors(),
)

/** Reads `{ families: { <name>: { plugin, group, pack, variants } } }`. */
internal fun fontsSelectionOf(json: JSONObject) = FontsSelection(
    sources = json.optJSONObject("families").mapValues { value ->
        val source = value as JSONObject
        FontSource(
            plugin = source.getString("plugin"),
            group = source.getString("group"),
            pack = source.getString("pack"),
            variants = fontVariantsOf(source.getJSONArray("variants")),
        )
    },
)

private fun fontVariantsOf(json: JSONArray) = (0 until json.length()).map { fontVariantOf(json.getJSONObject(it)) }

internal fun iconsSelectionOf(json: JSONObject) = IconsSelection(
    plugin = json.getString("plugin"),
    group = json.optString("group"),
    pack = json.getString("pack"),
    icons = json.optJSONObject("icons").stringMap(),
    drawables = json.optJSONObject("drawables").stringMap(),
)

internal fun emojiSelectionOf(json: JSONObject) = EmojiSelection(
    plugin = json.getString("plugin"),
    group = json.getString("group"),
    pack = json.getString("pack"),
    images = json.optStringOrNull("images"),
    font = json.optStringOrNull("font"),
)

internal fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

private fun themeColorsOf(json: JSONObject) = ThemeColors(
    semantic = json.optJSONObject("semantic").mapValues { (it as? JSONObject).stringMap() },
    raw = json.optJSONObject("raw").stringMap(),
)

internal fun fontVariantOf(json: JSONObject) = FontVariant(
    path = json.getString("path"),
    weight = json.optInt("weight", 400),
    italic = json.optBoolean("italic", false),
    axes = json.optJSONObject("axes").mapValues { (it as Number).toFloat() },
)

private inline fun <T> JSONObject?.mapValues(transform: (Any) -> T): Map<String, T> {
    if (this == null) return emptyMap()
    return keys().asSequence().associateWith { transform(get(it)) }
}

private fun JSONObject?.stringMap(): Map<String, String> = mapValues { it.toString() }

internal fun ThemesState.toJson(): JSONObject = JSONObject().apply {
    put("format", format)
    colors?.let { put("colors", it.toJson()) }
    fonts?.let { put("fonts", it.toJson()) }
    icons?.let { put("icons", it.toJson()) }
    emoji?.let { put("emoji", it.toJson()) }
    background?.let { put("background", it.toJson()) }
}

private fun BackgroundSettings.toJson() = JSONObject().apply {
    put("source", source)
    path?.let { put("path", it) }
    opacity?.let { put("opacity", it) }
    blur?.let { put("blur", it) }
    dimming?.let { put("dimming", it) }
}

private fun ColorsSelection.toJson() = JSONObject().apply {
    put("plugin", plugin)
    put("group", group)
    put("theme", theme)
    put("values", JSONObject().apply {
        put("semantic", JSONObject().apply { for ((base, colors) in values.semantic) put(base, JSONObject(colors)) })
        put("raw", JSONObject(values.raw))
    })
}

private fun FontsSelection.toJson() = JSONObject().apply {
    put("families", JSONObject().apply {
        for ((family, source) in sources) put(family, JSONObject().apply {
            put("plugin", source.plugin)
            put("group", source.group)
            put("pack", source.pack)
            put("variants", JSONArray().apply {
                for (variant in source.variants) put(JSONObject().apply {
                    put("path", variant.path)
                    put("weight", variant.weight)
                    put("italic", variant.italic)
                    put("axes", JSONObject().apply { for ((tag, value) in variant.axes) put(tag, value.toDouble()) })
                })
            })
        })
    })
}

private fun IconsSelection.toJson() = JSONObject().apply {
    put("plugin", plugin)
    put("group", group)
    put("pack", pack)
    put("icons", JSONObject(icons))
    put("drawables", JSONObject(drawables))
}

private fun EmojiSelection.toJson() = JSONObject().apply {
    put("plugin", plugin)
    put("group", group)
    put("pack", pack)
    images?.let { put("images", it) }
    font?.let { put("font", it) }
}

/**
 * Parses `#RGB`, `#RRGGBB` or `#RRGGBBAA` (CSS order) to an ARGB color int.
 * Returns `null` for anything else.
 */
internal fun parseHexColor(hex: String): Int? {
    if (!hex.startsWith('#')) return null
    val body = hex.substring(1)
    if (body.any { Character.digit(it, 16) < 0 }) return null

    val rgba = when (body.length) {
        3 -> body.map { "$it$it" }.joinToString("") + "ff"
        6 -> body + "ff"
        8 -> body
        else -> return null
    }

    val rgb = rgba.substring(0, 6).toLong(16)
    val alpha = rgba.substring(6, 8).toLong(16)
    return ((alpha shl 24) or rgb).toInt()
}
