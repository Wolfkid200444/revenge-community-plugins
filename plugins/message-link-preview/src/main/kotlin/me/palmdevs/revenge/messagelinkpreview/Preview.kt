package me.palmdevs.revenge.messagelinkpreview

import org.json.JSONObject

private const val CACHE_CAPACITY = 500

// Must match PreviewView in JS
internal enum class Kind(val jsName: String?) {
    MESSAGE(null),
    SYSTEM("system"),
    AUTOMOD("automod");

    companion object {
        fun of(jsName: String?) = entries.firstOrNull { it.jsName == jsName } ?: MESSAGE
    }
}

internal class Preview(val row: String?, val error: String?, val kind: Kind) {
    var parsed: Pair<Any, Any>? = null
    var parseFailed = false

    fun sameAs(other: Preview?) = other != null && other.row == row && other.error == error && other.kind == kind
}

internal class PreviewStore {
    // has to be thread safe
    private val previews = object : LinkedHashMap<String, Preview>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Preview>) = size > CACHE_CAPACITY
    }

    operator fun get(messageId: String) = synchronized(previews) { previews[messageId] }

    /** Returns the IDs of the previews that changed. */
    fun put(json: String): Set<String> {
        val obj = JSONObject(json)

        return obj.keys().asSequence().mapNotNull { key ->
            val value = obj.getJSONObject(key)
            val preview = Preview(
                value.optString("row").ifEmpty { null },
                value.optString("error").ifEmpty { null },
                Kind.of(value.optString("view").ifEmpty { null }),
            )

            synchronized(previews) {
                // Keep the already parsed one
                if (preview.sameAs(previews[key])) return@mapNotNull null
                previews[key] = preview
            }

            key
        }.toHashSet()
    }

    fun clear() = synchronized(previews) { previews.clear() }
}
