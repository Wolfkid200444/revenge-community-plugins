package me.palmdevs.revenge.messagelogger

import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.CharacterStyle
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.text.style.UpdateAppearance

// Must match the markers in JS
private const val HISTORY_START = ''
private const val HISTORY_END = ''
private const val EDITED_START = ''
private const val EDITED_SEPARATOR = ''
private const val EDITED_END = ''

private const val HISTORY_ALPHA = 0.5f

// Same as Discord's edited label
private const val EDITED_SIZE = 0.75f

/** Fades edits of a message and styles their edited labels, and removes the markers JS put. */
internal fun SpannableStringBuilder.styleHistory() {
    if (TextUtils.indexOf(this, HISTORY_START) < 0 && TextUtils.indexOf(this, EDITED_START) < 0) return

    // Backwards, so earlier markers keep their positions
    while (true) {
        val text = toString()
        val start = maxOf(text.lastIndexOf(HISTORY_START), text.lastIndexOf(EDITED_START))
        if (start < 0) return

        if (text[start] == HISTORY_START) {
            val end = text.indexOf(HISTORY_END, start)
            if (end >= 0) delete(end, end + 1)
            delete(start, start + 1)

            val contentEnd = if (end >= 0) end - 1 else length
            setSpan(FadeSpan(HISTORY_ALPHA), start, contentEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            continue
        }

        val separator = text.indexOf(EDITED_SEPARATOR, start)
        val end = text.indexOf(EDITED_END, start)
        if (separator !in 0..end) {
            delete(start, start + 1)
            continue
        }

        val color = text.substring(start + 1, separator).toIntOrNull()
        delete(end, end + 1)
        delete(start, separator + 1)

        val labelEnd = start + end - separator - 1
        setSpan(RelativeSizeSpan(EDITED_SIZE), start, labelEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (color != null) setSpan(ForegroundColorSpan(color), start, labelEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
}

// Added after the content's own spans, so it fades their colors too
private class FadeSpan(private val alpha: Float) : CharacterStyle(), UpdateAppearance {
    override fun updateDrawState(paint: TextPaint) {
        paint.alpha = (paint.alpha * alpha).toInt()
    }
}
