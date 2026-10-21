package me.palmdevs.revenge.shikicodeblocks

import org.json.JSONArray
import org.json.JSONObject

/**
 * Shiki's rendering of one code block.
 *
 * [spans] is flat, four ints per token: `start, end, color, fontStyle`, offsets into [text] if set, else the block's content.
 * [backgrounds] is flat too: `start, end, color`. Colors are ARGB, and `fontStyle` bits follow Shiki's `FontStyle`.
 * 
 * Colors can be placeholders for Discord's, see [DiscordPalette].
 *
 * [text] is shown instead of the content when it differs, as for ANSI, whose escape sequences aren't shown.
 */
internal class Highlight(
    val fg: Int,
    val bg: Int,
    val spans: IntArray,
    val text: String? = null,
    val backgrounds: IntArray = IntArray(0),
)

internal object FontStyle {
    const val ITALIC = 1
    const val BOLD = 2
    const val UNDERLINE = 4
    const val STRIKETHROUGH = 8
}

/** Highlights keyed by language and content, filled by JS before it sends the rows that contain them. */
internal class HighlightCache(private val capacity: Int) {
    private val entries = object : LinkedHashMap<String, Highlight>(capacity, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Highlight>) = size > capacity
    }

    /** Stores every block of a `{ blocks: [{ lang, content, fg, bg, spans, text?, backgrounds? }] }` payload. */
    fun putAll(json: String) {
        val blocks = JSONObject(json).getJSONArray("blocks")
        val parsed = (0 until blocks.length()).map { i ->
            val block = blocks.getJSONObject(i)
            keyOf(block.getString("lang"), block.getString("content")) to Highlight(
                fg = block.getInt("fg"),
                bg = block.getInt("bg"),
                spans = block.getJSONArray("spans").toIntArray(),
                text = if (block.has("text")) block.getString("text") else null,
                backgrounds = block.optJSONArray("backgrounds")?.toIntArray() ?: IntArray(0),
            )
        }
        synchronized(entries) { for ((key, highlight) in parsed) entries[key] = highlight }
    }

    operator fun get(lang: String, content: String): Highlight? = synchronized(entries) { entries[keyOf(lang, content)] }

    fun clear() = synchronized(entries) { entries.clear() }

    // JS keys by the trimmed language too, as Discord trims it before parsing.
    private fun keyOf(lang: String, content: String) = lang.trim() + '\u0000' + content
}

private fun JSONArray.toIntArray() = IntArray(length()) { getInt(it) }
