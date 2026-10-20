@file:JvmName("ShowTimeoutDuration")

package me.palmdevs.revenge.showtimeoutduration

import io.github.revenge.bridge.asDelegate
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod

/** Shows the time left on a member's timeout above their messages, counting down. */
@Suppress("UNUSED")
val showTimeoutDuration = plugin {
    var hooks: TimeoutHooks? = null

    start {
        hooks = TimeoutHooks(classLoader)

        registerNativeMethod("palmdevs.timeout.put") { args ->
            val json by args.asDelegate().string()
            hooks?.put(json)
            null
        }

        registerNativeMethod("palmdevs.timeout.clear") {
            hooks?.clear()
            null
        }
    }

    stop {
        hooks?.dispose()
        hooks = null
    }
}
