package io.github.revenge.themes

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import de.robv.android.xposed.XC_MethodHook
import io.github.revenge.Logger
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/** Normalizes a drawable name like `ResourceDrawableIdHelper` does. */
internal fun normalizeDrawableName(name: String): String = name.lowercase(Locale.ROOT).replace('-', '_')

/**
 * Drawable resource name of a React Native image source, or `null` when it isn't one.
 *
 * Release builds resolve a packager asset to either a bare resource name (bundle in APK assets),
 * or a `file://.../drawable-<dpi>/<name>.<ext>` path (bundle on the file system).
 */
internal fun drawableNameOfSource(source: String): String? {
    if (source.isEmpty()) return null

    val scheme = source.substringBefore("://", "")
    if (scheme.isEmpty()) {
        // Other schemeless forms (data:, res:) are never resource names.
        if (':' in source) return null
        return normalizeDrawableName(source)
    }

    if (scheme != "file") return null

    val segments = source.substringAfter("://").split('/')
    if (segments.size < 2) return null
    if (!segments[segments.size - 2].startsWith("drawable")) return null

    return normalizeDrawableName(segments.last().substringBeforeLast('.'))
}

/** Icon pack applied to native image loading. JS applies the same pack through asset overrides. */
internal class IconOverrides(drawables: Map<String, String>) {
    private val files = drawables.mapKeys { normalizeDrawableName(it.key) }

    // Source to override path, "" for no override. ImageSource.getUri runs in equals and hashCode.
    private val resolved = ConcurrentHashMap<String, String>()

    fun fileFor(source: String): File? {
        val path = resolved.getOrPut(source) {
            val file = drawableNameOfSource(source)?.let(files::get)?.let(::File)
            if (file?.isFile == true) file.absolutePath else ""
        }
        return if (path.isEmpty()) null else File(path)
    }

    fun isEmpty() = files.isEmpty()
}

/**
 * Hooks React Native's image source resolution (`ImageSource.getUri`) and
 * drawable lookup (`ResourceDrawableIdHelper.getResourceDrawable`).
 */
internal fun hookImageSources(classLoader: ClassLoader, overrides: () -> IconOverrides?, log: Logger): List<XC_MethodHook.Unhook> {
    val unhooks = mutableListOf<XC_MethodHook.Unhook>()

    classLoader.loadClassOrNull("com.facebook.react.views.imagehelper.ImageSource")?.let { clazz ->
        runCatching {
            val getSource = clazz.getDeclaredMethod("getSource")
            unhooks += clazz.getDeclaredMethod("getUri").hookAfter {
                val icons = overrides() ?: return@hookAfter
                val source = getSource.invoke(thisObject) as? String ?: return@hookAfter
                icons.fileFor(source)?.let { result = Uri.fromFile(it) }
            }
        }.onFailure { log.w("ImageSource.getUri not hooked: ${it.message}") }
    } ?: log.w("ImageSource not found, native icon overrides won't apply")

    classLoader.loadClassOrNull("com.facebook.react.views.imagehelper.ResourceDrawableIdHelper")?.let { clazz ->
        runCatching {
            val method = clazz.declaredMethods.first {
                it.name == "getResourceDrawable" &&
                        it.parameterTypes.contentEquals(arrayOf(Context::class.java, String::class.java))
            }
            unhooks += method.hookBefore {
                val icons = overrides() ?: return@hookBefore
                val context = args[0] as? Context ?: return@hookBefore
                val name = args[1] as? String ?: return@hookBefore
                val file = icons.fileFor(name) ?: return@hookBefore
                BitmapFactory.decodeFile(file.absolutePath)?.let { result = BitmapDrawable(context.resources, it) }
            }
        }.onFailure { log.w("ResourceDrawableIdHelper.getResourceDrawable not hooked: ${it.message}") }
    }

    return unhooks
}
