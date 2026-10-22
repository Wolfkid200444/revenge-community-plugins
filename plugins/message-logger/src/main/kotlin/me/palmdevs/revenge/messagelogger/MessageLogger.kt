@file:JvmName("MessageLogger")

package me.palmdevs.revenge.messagelogger

import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod

@Suppress("UNUSED")
val messageLogger = plugin {
    var hooks: LoggerHooks? = null

    start {
        hooks = LoggerHooks(dexFinder)

        registerNativeMethod("palmdevs.message-logger.setDimmed") { args ->
            hooks?.setDimmed(args[0] as String, args[1] as Boolean)
            null
        }

        registerNativeMethod("palmdevs.message-logger.clear") {
            hooks?.clear()
            null
        }
    }

    stop {
        hooks?.dispose()
        hooks = null
    }
}
