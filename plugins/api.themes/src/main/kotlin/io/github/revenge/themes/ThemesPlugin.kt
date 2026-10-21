@file:JvmName("ThemesPlugin")

package io.github.revenge.themes

import android.app.AndroidAppHelper
import android.net.Uri
import de.robv.android.xposed.XC_MethodHook
import io.github.revenge.bridge.asDelegate
import io.github.revenge.plugins.PluginScope
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeAsyncMethod
import io.github.revenge.xposed.api.registerNativeMethod
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

/**
 * Native half of theming: fonts, icons, emoji and Discord's native colors.
 *
 * Selections live in this plugin's `state.json`, written by JS on pick and read here before React Native starts.
 */
@Suppress("UNUSED")
val themesPlugin = plugin {
    var running = false
    var unhooks = emptyList<XC_MethodHook.Unhook>()
    var previewUnhook: XC_MethodHook.Unhook? = null
    var colors: DiscordNativeColors? = null

    start {
        val store = ThemesStateStore(storageDir)
        val state = store.load { log.e("Failed to read theme state, using defaults", it) }

        // Typefaces, drawables and images are cached once loaded, so packs apply at boot only.
        val fonts = state.fonts?.takeIf { it.families.isNotEmpty() }?.let { FontOverrides(it.families, log) }
        val icons = state.icons?.let { IconOverrides(it.drawables) }?.takeUnless { it.isEmpty() }
        val emoji = state.emoji?.let { emojiOverridesOf(it, File(storageDir, EMOJI_CACHE_DIR)) }

        // Packs shown in settings before picking one, keyed by family name
        val fontPreviews = ConcurrentHashMap<String, List<FontVariant>>()
        val previewFonts = AtomicReference<FontOverrides?>(null)
        val fontsFor = { name: String -> if (name.startsWith(FONT_PREVIEW_PREFIX)) previewFonts.get() else fonts }

        val emojiPreviewRoot = File(storageDir, EMOJI_PREVIEW_DIR).apply { deleteRecursively() }
        val emojiPreviews = ConcurrentHashMap<String, EmojiOverrides>()
        val discordEmoji = DiscordEmoji(appInfo.sourceDir, File(emojiPreviewRoot, "discord"), log)

        unhooks = buildList {
            if (fonts != null) hookReactFontManager(dexFinder, fontsFor, log)?.let(::add)
            if (icons != null) addAll(hookImageSources(dexFinder, { icons }, log))
            if (emoji != null) addAll(hookEmojiAssets({ emoji }, log))
        }

        colors = DiscordNativeColors(dexFinder, log).apply {
            runCatching { apply(state.colors?.values) }.onFailure { log.e("Failed to apply native colors", it) }
        }

        running = true

        fun <T> select(args: List<Any?>, parse: (JSONObject) -> T, write: (ThemesState, T?) -> ThemesState): T? {
            check(running) { "${manifest.id} is not running" }
            val json by args.asDelegate().stringOrNull()
            val selection = json?.let { parse(JSONObject(it)) }
            store.update { write(it, selection) }
            return selection
        }

        registerNativeMethod("revenge.themes.getState") {
            store.state.toJson().toString()
        }

        registerNativeMethod("revenge.themes.setColors") { args ->
            val selection = select(args, ::colorsSelectionOf) { s, v -> s.copy(colors = v) }
            colors?.apply(selection?.values)
            null
        }

        registerNativeMethod("revenge.themes.setFonts") { args ->
            select(args, ::fontsSelectionOf) { s, v -> s.copy(fonts = v) }
            null
        }

        registerNativeMethod("revenge.themes.setIcons") { args ->
            select(args, ::iconsSelectionOf) { s, v -> s.copy(icons = v) }
            null
        }

        registerNativeMethod("revenge.themes.setEmoji") { args ->
            select(args, ::emojiSelectionOf) { s, v -> s.copy(emoji = v) }
            null
        }

        registerNativeMethod("revenge.themes.setBackground") { args ->
            select(args, ::backgroundSettingsOf) { s, v -> s.copy(background = v) }
            null
        }

        // Copies picked image (file:// or content://) into storage. Returns its absolute path.
        registerNativeAsyncMethod("revenge.themes.importBackground") { args ->
            check(running) { "${manifest.id} is not running" }
            val uri by args.asDelegate().string()
            val source = Uri.parse(uri)
            val dir = File(storageDir, BACKGROUNDS_DIR).apply { mkdirs() }

            val extension = source.lastPathSegment?.substringAfterLast('.', "")
                ?.takeIf { it.length in 1..5 && it.all(Char::isLetterOrDigit) }
            val file = File(dir, "${System.currentTimeMillis()}${extension?.let { ".$it" }.orEmpty()}")

            val input = if (source.scheme == "content") {
                checkNotNull(AndroidAppHelper.currentApplication()) { "No application context" }
                    .contentResolver.openInputStream(source)
            } else {
                File(checkNotNull(source.path) { "Not a file: $uri" }).inputStream()
            }
            checkNotNull(input) { "Cannot read $uri" }.use { from -> file.outputStream().use { from.copyTo(it) } }

            // Earlier imports are unused unless still selected
            val selected = store.state.background?.path
            dir.listFiles()?.forEach { if (it != file && it.absolutePath != selected) it.delete() }

            file.absolutePath
        }

        // Registers { name, variants } as font family JS can render with. Hooks ReactFontManager on demand.
        registerNativeMethod("revenge.themes.previewFont") { args ->
            check(running) { "${manifest.id} is not running" }
            val json by args.asDelegate().string()
            val request = JSONObject(json)
            val name = request.getString("name")
            require(name.startsWith(FONT_PREVIEW_PREFIX)) { "Preview font names start with $FONT_PREVIEW_PREFIX" }

            val variants = request.getJSONArray("variants")
            fontPreviews[name] = (0 until variants.length()).map { fontVariantOf(variants.getJSONObject(it)) }
            // New instance drops typefaces cached for an older registration of a name
            previewFonts.set(FontOverrides(fontPreviews.toMap(), log))

            synchronized(fontPreviews) {
                if (fonts == null && previewUnhook == null) previewUnhook = hookReactFontManager(dexFinder, fontsFor, log)
            }
            null
        }

        // Takes { pack: { images?, font? } | null, codepoints: [] }, returns path (or null) per codepoints.
        // Falls back to Discord defaults when omitted from pack or when pack is null.
        registerNativeAsyncMethod("revenge.themes.previewEmoji") { args ->
            check(running) { "${manifest.id} is not running" }
            val json by args.asDelegate().string()
            val request = JSONObject(json)

            val overrides = request.optJSONObject("pack")?.let { pack ->
                val images = pack.optStringOrNull("images")
                val font = pack.optStringOrNull("font")
                val key = cacheKeyOf(images.orEmpty(), font.orEmpty(), fontVersionOf(font))
                emojiPreviews.getOrPut(key) {
                    EmojiOverrides(images?.let(::File), font, File(emojiPreviewRoot, key), log)
                }
            }

            val codepoints = request.getJSONArray("codepoints")
            JSONArray((0 until codepoints.length()).map {
                val name = "emoji-${codepoints.getString(it)}.png"
                (overrides?.fileFor(name) ?: discordEmoji.fileFor(name))?.absolutePath
            }).toString()
        }
    }

    stop {
        running = false
        for (unhook in unhooks) unhook.unhook()
        if (unhooks.isNotEmpty()) requireReload()
        unhooks = emptyList()

        // Previews only change settings rows, so they don't need a reload
        previewUnhook?.unhook()
        previewUnhook = null

        colors?.apply(null)
        colors = null
    }
}

private const val BACKGROUNDS_DIR = "backgrounds"
private const val EMOJI_CACHE_DIR = "emoji-cache"
private const val EMOJI_PREVIEW_DIR = "emoji-preview"

private fun fontVersionOf(font: String?) =
    font?.takeIf { it != SYSTEM_EMOJI_FONT }?.let { File(it).lastModified() } ?: 0

private fun cacheKeyOf(vararg parts: Any) = parts.joinToString("\u0000").hashCode().toUInt().toString(16)

/** Overrides for [selection], drawing into a cache dir of its own. Caches of other selections are deleted. */
private fun PluginScope.emojiOverridesOf(selection: EmojiSelection, root: File): EmojiOverrides? {
    if (selection.images == null && selection.font == null) return null

    // An updated font keeps its path, so its modification time is part of the key
    val key = cacheKeyOf(
        selection.plugin, selection.group, selection.pack, selection.font.orEmpty(), fontVersionOf(selection.font),
    )
    root.listFiles()?.forEach { if (it.name != key) it.deleteRecursively() }

    return EmojiOverrides(selection.images?.let(::File), selection.font, File(root, key), log)
}
