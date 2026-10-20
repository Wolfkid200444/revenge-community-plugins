package io.github.revenge.themes

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class EmojiTest {
    @Test
    fun `codepoints come from Discord's asset names`() {
        assertEquals("1f600", emojiCodepointsOf("emoji-1f600.png"))
        assertEquals("1f469-200d-2764-fe0f-200d-1f469", emojiCodepointsOf("emoji-1f469-200d-2764-fe0f-200d-1f469.png"))
    }

    @Test
    fun `other assets are not emoji`() {
        assertNull(emojiCodepointsOf("fonts/ggsans-Normal.ttf"))
        assertNull(emojiCodepointsOf("emoji-1f600.webp"))
        assertNull(emojiCodepointsOf("emoji-.png"))
        assertNull(emojiCodepointsOf("emoji-1F600.png"))
        assertNull(emojiCodepointsOf("emoji-1f600--200d.png"))
    }

    @Test
    fun `image names fall back to dropping variation selectors`() {
        assertEquals(listOf("emoji-1f600.png"), emojiImageNamesOf("1f600"))
        assertEquals(
            listOf("emoji-2764-fe0f-200d-1f525.png", "emoji-2764-200d-1f525.png"),
            emojiImageNamesOf("2764-fe0f-200d-1f525"),
        )
    }

    @Test
    fun `codepoints become emoji text`() {
        assertEquals("😀", emojiTextOf("1f600"))
        assertEquals("❤️", emojiTextOf("2764-fe0f"))
        assertNull(emojiTextOf("110000"))
    }
}
