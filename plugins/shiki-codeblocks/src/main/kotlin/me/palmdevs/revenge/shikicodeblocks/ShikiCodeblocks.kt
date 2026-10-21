@file:JvmName("ShikiCodeblocks")

package me.palmdevs.revenge.shikicodeblocks

import de.robv.android.xposed.XC_MethodHook
import io.github.revenge.bridge.asDelegate
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod

/**
 * Blocks stored for nodes yet to be created. JS sends the blocks of every row update, and rendered nodes
 * keep their own highlight (see [hookCodeStyle]), so this only has to outlive one update.
 */
private const val CACHE_CAPACITY = 512

/**
 * Renders code blocks with the highlights JS computed with Shiki.
 *
 * JS tokenizes code blocks in the rows it sends to the native chat list and stores the result here,
 * to let native use them when rows are rendered.
 */
@Suppress("UNUSED")
val shikiCodeblocks = plugin {
    val cache = HighlightCache(CACHE_CAPACITY)
    var unhooks = emptyList<XC_MethodHook.Unhook>()
    var taps: CodeBlockTaps? = null

    start {
        val codeFont = codeFontOf(dexFinder)
        taps = runCatching {
            CodeBlockTaps(dexFinder) { block ->
                withAppActivity { activity -> activity.runOnUiThread { showCodeViewer(activity, block, codeFont) } }
            }
        }.onFailure { errors.tryEmit(it) }.getOrNull()

        unhooks = hookCodeStyle(dexFinder, cache, taps) + listOfNotNull(taps?.unhook)

        registerNativeMethod("palmdevs.shiki.put") { args ->
            val json by args.asDelegate().string()
            cache.putAll(json)
            null
        }

        registerNativeMethod("palmdevs.shiki.setOpenOnTap") { args ->
            val enabled by args.asDelegate().boolean()
            taps?.enabled = enabled
            null
        }

        registerNativeMethod("palmdevs.shiki.clear") {
            cache.clear()
            null
        }
    }

    stop {
        for (unhook in unhooks) unhook.unhook()
        unhooks = emptyList()
        // Blocks already rendered keep their spans
        taps?.enabled = false
        taps = null
        cache.clear()
    }
}
