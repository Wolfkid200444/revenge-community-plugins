import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { getIndex, readAsset } from './assets'
import { construct, precompile } from './regex'
import type {
	LanguageRegistration,
	ThemedToken,
	ThemeRegistration,
} from 'shiki/core'
import type { PrecompiledRegex } from './regex'
import type { ThemeName } from './themes'

/** Hightlight cache, see `Highlight` in Highlights.kt. */
export interface Highlight {
	lang: string
	content: string
	fg: number
	bg: number
	/** Flat `start, end, color, fontStyle` quadruples, offsets into `text` if set, else `content`. */
	spans: number[]
	/** What to show instead of `content`, as for ANSI, where escape sequences aren't shown. */
	text?: string
	/** Flat `start, end, color` triples. */
	backgrounds?: number[]
}

/** Upper limit in case Discord manages to render a large code block. */
const MaxContentLength = 20_000

export function createHighlighter() {
	// Source to its precompiled RegExp, from `assets/shiki/regexes` of the grammars loaded
	const regexes = new Map<string, PrecompiledRegex>()

	const shiki = createHighlighterCoreSync({
		// Hermes has no WebAssembly or RegExp `v` flag. Unsupported patterns are skipped instead of failing the grammar.
		engine: createJavaScriptRegexEngine({
			forgiving: true,
			regexConstructor: source => {
				// Only patterns made at runtime (`end` with back-references) aren't precompiled
				const regex = regexes.has(source)
					? regexes.get(source)!
					: precompile(source)
				if (!regex) throw new Error(`Unsupported pattern: ${source}`)
				return construct(regex)
			},
		}),
	})

	// Marked before loading, so grammars embedding each other don't recurse forever
	const languages = new Set<string>()
	const loadLanguage = (name: string) => {
		if (languages.has(name)) return
		languages.add(name)

		const grammar = readAsset<LanguageRegistration>(`langs/${name}`)
		const precompiled = readAsset<Record<string, PrecompiledRegex>>(
			`regexes/${name}`,
		)
		for (const source in precompiled) regexes.set(source, precompiled[source]!)

		for (const embedded of grammar.embeddedLangs ?? []) loadLanguage(embedded)
		shiki.loadLanguageSync(grammar)
	}

	const loadTheme = (name: string) => {
		if (!shiki.getLoadedThemes().includes(name))
			shiki.loadThemeSync(readAsset<ThemeRegistration>(`themes/${name}`))
	}

	/**
	 * Highlights a code block. Blocks in languages that aren't shipped, or too long to tokenize,
	 * are plain but still in the theme's colors, to look like the rest.
	 */
	return function highlight(
		lang: string,
		content: string,
		theme: ThemeName,
	): Highlight {
		loadTheme(theme)

		const id = lang.trim().toLowerCase()
		if (id === 'ansi' && content.length <= MaxContentLength)
			return highlightAnsi(lang, content, theme)

		const name = getIndex().languages[id]
		if (!name || content.length > MaxContentLength) {
			const { fg, bg } = shiki.getTheme(theme)
			return {
				lang: lang.trim(),
				content,
				fg: parseColor(fg) ?? White,
				bg: parseColor(bg) ?? Black,
				spans: [],
			}
		}

		loadLanguage(name)

		const result = shiki.codeToTokens(content, { lang: name, theme })
		const fg = parseColor(result.fg) ?? White
		const spans = createSpans(fg)

		for (const line of result.tokens)
			for (const token of line)
				spans.add(token, token.offset, token.offset + token.content.length)

		return {
			lang: lang.trim(),
			content,
			fg,
			bg: parseColor(result.bg) ?? Black,
			spans: spans.spans,
		}
	}

	/**
	 * ANSI is built into Shiki, with colors from the theme's terminal palette.
	 * Its tokens leave out escape sequences and only carry their line's offset, so the shown text is rebuilt from them.
	 */
	function highlightAnsi(
		lang: string,
		content: string,
		theme: ThemeName,
	): Highlight {
		const result = shiki.codeToTokens(content, { lang: 'ansi', theme })
		const fg = parseColor(result.fg) ?? White
		const spans = createSpans(fg)

		let text = ''
		result.tokens.forEach((line, index) => {
			if (index) text += '\n'
			for (const token of line) {
				const start = text.length
				text += token.content
				spans.add(token, start, text.length)
			}
		})

		return {
			lang: lang.trim(),
			content,
			fg,
			bg: parseColor(result.bg) ?? Black,
			spans: spans.spans,
			text,
			backgrounds: spans.backgrounds,
		}
	}
}

/** Collects token styles into spans. Tokens in the default style are dropped, and adjacent ones of the same style merged. */
function createSpans(fg: number) {
	const spans: number[] = []
	const backgrounds: number[] = []

	return {
		spans,
		backgrounds,
		add(token: ThemedToken, start: number, end: number) {
			const color = parseColor(token.color) ?? fg
			const style = Math.max(token.fontStyle ?? 0, 0)
			if (color !== fg || style) merge(spans, start, end, color, style)

			const background = parseColor(token.bgColor)
			if (background !== null) merge(backgrounds, start, end, background)
		},
	}
}

/** Pushes a `start, end, ...style` span, or extends the last one if it ends at `start` with the same style. */
function merge(
	spans: number[],
	start: number,
	end: number,
	...style: number[]
) {
	const size = 2 + style.length
	const last = spans.length - size
	if (
		last >= 0 &&
		spans[last + 1] === start &&
		style.every((value, i) => spans[last + 2 + i] === value)
	)
		spans[last + 1] = end
	else spans.push(start, end, ...style)
}

const White = 0xffffffff | 0
const Black = 0xff000000 | 0

const colors = new Map<string, number | null>()

/** Parses `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA` to a signed 32-bit ARGB int, like Android's `Color`. */
export function parseColor(hex: string | undefined): number | null {
	if (!hex) return null

	let color = colors.get(hex)
	if (color !== undefined) return color

	let body = hex.startsWith('#') ? hex.slice(1) : ''
	if (body.length === 3 || body.length === 4)
		body = body.replace(/./g, digit => digit + digit)
	if (body.length === 6) body += 'ff'

	color =
		body.length === 8 && /^[\da-f]+$/i.test(body)
			? (Number.parseInt(body.slice(6), 16) << 24) |
				Number.parseInt(body.slice(0, 6), 16)
			: null

	colors.set(hex, color)
	return color
}
