package io.github.revenge.themes

import android.content.res.AssetFileDescriptor
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.os.Build
import android.os.ParcelFileDescriptor
import de.robv.android.xposed.XC_MethodHook
import io.github.revenge.Logger
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipFile

/** Emoji drawn from a font are this many pixels square. Discord's images are 72. */
private const val FONT_EMOJI_SIZE = 128

/** Asset name prefix of Discord's (Twemoji) Unicode emoji images, eg. `emoji-1f469-200d-2764-fe0f-200d-1f469.png`. */
private const val EMOJI_ASSET_PREFIX = "emoji-"
private const val EMOJI_ASSET_SUFFIX = ".png"

/** Font value that draws with the device's own emoji font. */
internal const val SYSTEM_EMOJI_FONT = "system"

private val CODEPOINTS = Regex("[0-9a-f]+(-[0-9a-f]+)*")

/** Codepoints (lowercase hex, `-` separated) of an emoji asset name, or `null` when it isn't one. */
internal fun emojiCodepointsOf(assetName: String): String? {
    if (!assetName.startsWith(EMOJI_ASSET_PREFIX) || !assetName.endsWith(EMOJI_ASSET_SUFFIX)) return null
    val codepoints = assetName.substring(EMOJI_ASSET_PREFIX.length, assetName.length - EMOJI_ASSET_SUFFIX.length)
    return codepoints.takeIf { CODEPOINTS.matches(it) }
}

/**
 * Image names to look for in a pack, for [codepoints] Discord asked for.
 * Packs disagree on keeping variation selectors (`fe0f`), so the name without them is tried second.
 */
internal fun emojiImageNamesOf(codepoints: String): List<String> {
    val withoutVariation = codepoints.split('-').filter { it != "fe0f" }.joinToString("-")
    return listOf(codepoints, withoutVariation).distinct()
        .filter { it.isNotEmpty() }
        .map { "$EMOJI_ASSET_PREFIX$it$EMOJI_ASSET_SUFFIX" }
}

/** The emoji text of [codepoints], or `null` when one isn't a valid code point. */
internal fun emojiTextOf(codepoints: String): String? = runCatching {
    buildString { for (hex in codepoints.split('-')) appendCodePoint(hex.toInt(16)) }
}.getOrNull()

/**
 * Emoji pack applied to Discord's Unicode emoji images.
 *
 * Looks in [images] first, then draws with [font] into [cacheDir]. Emoji neither covers keep Discord's image.
 */
internal class EmojiOverrides(
    private val images: File?,
    font: String?,
    private val cacheDir: File,
    private val log: Logger,
) {
    private val paint: Paint? = font?.let(::paintOf)

    // Asset name to override path, "" for no override
    private val resolved = ConcurrentHashMap<String, String>()

    fun fileFor(assetName: String): File? {
        val path = resolved.getOrPut(assetName) {
            val codepoints = emojiCodepointsOf(assetName) ?: return@getOrPut ""
            (imageOf(codepoints) ?: drawn(codepoints))?.absolutePath ?: ""
        }
        return if (path.isEmpty()) null else File(path)
    }

    private fun imageOf(codepoints: String): File? {
        val dir = images ?: return null
        return emojiImageNamesOf(codepoints).firstNotNullOfOrNull { name -> File(dir, name).takeIf(File::isFile) }
    }

    private fun drawn(codepoints: String): File? {
        val paint = paint ?: return null
        val file = File(cacheDir, "$EMOJI_ASSET_PREFIX$codepoints$EMOJI_ASSET_SUFFIX")
        if (file.isFile) return file

        val text = emojiTextOf(codepoints) ?: return null
        // Leaves emoji the font lacks to Discord, instead of drawing a missing glyph box
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !paint.hasGlyph(text)) return null

        return runCatching {
            val bitmap = drawEmoji(text, paint, FONT_EMOJI_SIZE) ?: return null
            try {
                cacheDir.mkdirs()
                // Fresco reads on several threads, so a file is only ever seen complete
                val temp = File.createTempFile("emoji-", ".tmp", cacheDir)
                temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                if (!temp.renameTo(file)) temp.delete()
                file.takeIf(File::isFile)
            } finally {
                bitmap.recycle()
            }
        }.onFailure { log.e("Failed to draw emoji $codepoints", it) }.getOrNull()
    }

    private fun paintOf(font: String): Paint? {
        val typeface = if (font == SYSTEM_EMOJI_FONT) Typeface.DEFAULT else typefaceOf(File(font)) ?: return null
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.typeface = typeface
            textSize = FONT_EMOJI_SIZE.toFloat()
        }
    }

    /** Only the font itself on API 29+, so glyphs it lacks aren't drawn with the system font. */
    private fun typefaceOf(file: File): Typeface? {
        if (!file.isFile) {
            log.w("Missing emoji font file: ${file.path}")
            return null
        }

        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                Typeface.CustomFallbackBuilder(FontFamily.Builder(Font.Builder(file).build()).build()).build()
            else Typeface.createFromFile(file)
        }.onFailure { log.e("Failed to load emoji font ${file.path}", it) }.getOrNull()
    }
}

/**
 * Discord's emoji images, copied out of its APK into [dir].
 * Read from the APK rather than its assets, which an emoji pack may be hooking.
 */
internal class DiscordEmoji(private val apk: String, private val dir: File, private val log: Logger) {
    fun fileFor(assetName: String): File? {
        emojiCodepointsOf(assetName) ?: return null
        val file = File(dir, assetName)
        if (file.isFile) return file

        return runCatching {
            ZipFile(apk).use { zip ->
                val entry = zip.getEntry("assets/$assetName") ?: return null
                dir.mkdirs()
                val temp = File.createTempFile("emoji-", ".tmp", dir)
                zip.getInputStream(entry).use { input -> temp.outputStream().use { input.copyTo(it) } }
                if (!temp.renameTo(file)) temp.delete()
                file.takeIf(File::isFile)
            }
        }.onFailure { log.e("Failed to copy Discord's $assetName", it) }.getOrNull()
    }
}

/** Draws [text] centered in a [size] pixel square, scaled down to fit. */
private fun drawEmoji(text: String, paint: Paint, size: Int): Bitmap? {
    val ink = Rect()
    paint.getTextBounds(text, 0, text.length, ink)
    if (ink.isEmpty) {
        val metrics = paint.fontMetricsInt
        ink.set(0, metrics.ascent, kotlin.math.ceil(paint.measureText(text)).toInt(), metrics.descent)
    }
    if (ink.isEmpty) return null

    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val scale = minOf(1f, size.toFloat() / ink.width(), size.toFloat() / ink.height())
    Canvas(bitmap).apply {
        translate(size / 2f, size / 2f)
        scale(scale, scale)
        drawText(text, -ink.exactCenterX(), -ink.exactCenterY(), paint)
    }
    return bitmap
}

/**
 * Hooks `AssetManager.open(String, int)` and `openFd(String)`, which Fresco's local asset fetcher reads
 * `asset:///emoji-*.png` images through. Covers native and React Native images alike.
 */
internal fun hookEmojiAssets(overrides: () -> EmojiOverrides?, log: Logger): List<XC_MethodHook.Unhook> {
    val unhooks = mutableListOf<XC_MethodHook.Unhook>()

    runCatching {
        unhooks += AssetManager::class.java.getDeclaredMethod("open", String::class.java, Int::class.javaPrimitiveType)
            .hookBefore {
                val name = args[0] as? String ?: return@hookBefore
                if (!name.startsWith(EMOJI_ASSET_PREFIX)) return@hookBefore
                val file = overrides()?.fileFor(name) ?: return@hookBefore
                result = FileInputStream(file)
            }
    }.onFailure { log.w("AssetManager.open not hooked, emoji packs won't apply: ${it.message}") }

    runCatching {
        unhooks += AssetManager::class.java.getDeclaredMethod("openFd", String::class.java)
            .hookBefore {
                val name = args[0] as? String ?: return@hookBefore
                if (!name.startsWith(EMOJI_ASSET_PREFIX)) return@hookBefore
                val file = overrides()?.fileFor(name) ?: return@hookBefore
                result = AssetFileDescriptor(
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY),
                    0,
                    file.length(),
                )
            }
    }.onFailure { log.w("AssetManager.openFd not hooked: ${it.message}") }

    return unhooks
}
