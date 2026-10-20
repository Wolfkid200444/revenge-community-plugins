@file:JvmName("WhoReacted")

package me.palmdevs.revenge.whoreacted

import io.github.revenge.bridge.asDelegate
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod

@Suppress("UNUSED")
val whoReacted = plugin {
    var hooks: ReactionHooks? = null

    start {
        hooks = ReactionHooks(classLoader)

        registerNativeMethod("palmdevs.who-reacted.put") { args ->
            val json by args.asDelegate().string()
            hooks?.put(json)
            null
        }

        registerNativeMethod("palmdevs.who-reacted.shown") {
            hooks?.shownKeys() ?: "[]"
        }

        registerNativeMethod("palmdevs.who-reacted.clear") {
            hooks?.clear()
            null
        }
    }

    stop {
        hooks?.dispose()
        hooks = null
    }
}
