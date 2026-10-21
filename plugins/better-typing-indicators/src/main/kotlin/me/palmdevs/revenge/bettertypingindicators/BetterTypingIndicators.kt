@file:JvmName("BetterTypingIndicators")

package me.palmdevs.revenge.bettertypingindicators

import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod

/** Makes room in the chat list for typing indicators that wrap onto more lines. */
@Suppress("UNUSED")
val betterTypingIndicators = plugin {
    var spacing: ChatListSpacing? = null

    start {
        spacing = ChatListSpacing(dexFinder)

        registerNativeMethod("palmdevs.typing.setExtraSpacing") { args ->
            val tag = (args[0] as Number).toInt()
            val extraDp = (args[1] as Number).toFloat()
            withAppActivity { activity ->
                activity.runOnUiThread {
                    spacing?.set(activity, tag, extraDp) { problem -> log.w(problem) }
                }
            }
            null
        }
    }

    stop {
        spacing?.dispose()
        spacing = null
    }
}
