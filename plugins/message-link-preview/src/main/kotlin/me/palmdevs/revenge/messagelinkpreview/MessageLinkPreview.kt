@file:JvmName("MessageLinkPreview")

package me.palmdevs.revenge.messagelinkpreview

import io.github.revenge.bridge.asDelegate
import io.github.revenge.plugins.plugin
import io.github.revenge.xposed.api.registerNativeMethod

@Suppress("UNUSED")
val messageLinkPreview = plugin {
    var hooks: PreviewHooks? = null

    start {
        hooks = PreviewHooks(dexFinder)

        registerNativeMethod("palmdevs.message-link-preview.put") { args ->
            val json by args.asDelegate().string()
            hooks?.put(json)
            null
        }

        registerNativeMethod("palmdevs.message-link-preview.clear") {
            hooks?.clear()
            null
        }

        registerNativeMethod("palmdevs.message-link-preview.setMaxHeight") { args ->
            val dp by args.asDelegate().int()
            hooks?.maxHeightDp = dp
            null
        }

        registerNativeMethod("palmdevs.message-link-preview.setInteractive") { args ->
            val enabled by args.asDelegate().boolean()
            hooks?.setInteractive(enabled)
            null
        }
    }

    stop {
        hooks?.dispose()
        hooks = null
    }
}
