package io.github.revenge.themes

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ThemesHelpersTest {
    private val variants = listOf(
        FontVariant("normal.ttf", 400),
        FontVariant("normal-italic.ttf", 400, italic = true),
        FontVariant("semibold.ttf", 600),
        FontVariant("bold.ttf", 700),
    )

    @Test
    fun `closest variant prefers matching slant over weight`() {
        assertEquals("normal-italic.ttf", closestFontVariant(variants, 700, italic = true)?.path)
    }

    @Test
    fun `closest variant picks the nearest weight`() {
        assertEquals("semibold.ttf", closestFontVariant(variants, 550, italic = false)?.path)
        assertEquals("bold.ttf", closestFontVariant(variants, 900, italic = false)?.path)
    }

    @Test
    fun `closest variant prefers heavier on ties`() {
        assertEquals("semibold.ttf", closestFontVariant(variants, 500, italic = false)?.path)
    }

    @Test
    fun `closest variant falls back to other slant`() {
        val upright = listOf(FontVariant("normal.ttf"))
        assertEquals("normal.ttf", closestFontVariant(upright, 400, italic = true)?.path)
        assertNull(closestFontVariant(emptyList(), 400, italic = false))
    }

    @Test
    fun `font family values split into a fallback chain`() {
        assertEquals(listOf("ggsans-Normal", "NotoSans-Normal"), splitFontFamilies(" ggsans-Normal , NotoSans-Normal,"))
    }

    @Test
    fun `axes become font variation settings`() {
        assertEquals("'wght' 600, 'slnt' -10", fontVariationSettingsOf(linkedMapOf("wght" to 600f, "slnt" to -10f)))
        assertEquals("'opsz' 14.5", fontVariationSettingsOf(mapOf("opsz" to 14.5f)))
        assertNull(fontVariationSettingsOf(emptyMap()))
        assertNull(fontVariationSettingsOf(mapOf("weight" to 600f, "wg'h" to 1f, "wdth" to Float.NaN)))
    }

    @Test
    fun `hex colors parse in CSS order`() {
        assertEquals(0xFF112233.toInt(), parseHexColor("#112233"))
        assertEquals(0x80112233.toInt(), parseHexColor("#11223380"))
        assertEquals(0xFFAABBCC.toInt(), parseHexColor("#abc"))
        assertNull(parseHexColor("112233"))
        assertNull(parseHexColor("#11223"))
        assertNull(parseHexColor("#gg2233"))
    }

    @Test
    fun `semantic names map to native color resources`() {
        assertEquals("background_code_ash", semanticColorResourceName(ThemeBase.DARK, "BACKGROUND_CODE"))
        assertEquals("border_subtle_dark", semanticColorResourceName(ThemeBase.DARKER, "BORDER_SUBTLE"))
        assertEquals("chat_input_background_onyx", semanticColorResourceName(ThemeBase.MIDNIGHT, "CHAT_INPUT_BACKGROUND"))
    }

    @Test
    fun `drawable names come from bare and bundle-folder sources`() {
        assertEquals("design_icon_pluslargeicon", drawableNameOfSource("design_icon_PlusLargeIcon"))
        assertEquals(
            "design_icon_pluslargeicon",
            drawableNameOfSource("file:///data/user/0/x/bundle/drawable-xxhdpi/design_icon_pluslargeicon.png"),
        )
        assertEquals("a_b", drawableNameOfSource("a-b"))
    }

    @Test
    fun `non-drawable sources are ignored`() {
        assertNull(drawableNameOfSource(""))
        assertNull(drawableNameOfSource("https://cdn.discordapp.com/a.png"))
        assertNull(drawableNameOfSource("file:///sdcard/a.png"))
        assertNull(drawableNameOfSource("data:image/png;base64,AAAA"))
        assertNull(drawableNameOfSource("res:/123"))
    }
}
