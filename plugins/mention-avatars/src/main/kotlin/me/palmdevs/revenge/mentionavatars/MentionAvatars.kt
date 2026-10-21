@file:JvmName("MentionAvatars")

package me.palmdevs.revenge.mentionavatars

import io.github.revenge.plugins.plugin

/** Rounds mention icons and makes them load. */
@Suppress("UNUSED")
val mentionAvatars = plugin {
    var hooks: IconHooks? = null

    start {
        hooks = IconHooks(dexFinder)
    }

    stop {
        hooks?.dispose()
        hooks = null
    }
}
