import type {
	FontPackDefinition,
	FontVariant,
	ThemeBackground,
	ThemeColors,
} from '@revenge-mod/themes-api/types'

/** Vendetta and Bunny theme format (spec 2). */
export interface LegacyTheme {
	spec: 2
	name: string
	description?: string
	authors?: { name: string; id?: string }[]
	/** Semantic colors mapped to `[dark, light, midnight?]` hex values. */
	semanticColors?: Record<string, string[]>
	rawColors?: Record<string, string>
	background?: {
		url: string
		/** Image opacity. */
		alpha?: number
		/** Blur radius. */
		blur?: number
	}
}

/** Bunny font pack format (spec 1). */
export interface LegacyFontPack {
	spec: 1
	name: string
	description?: string
	/** Maps Discord font family name (such as `ggsans-NormalItalic`) to font download URL. */
	main: Record<string, string>
}

const HexColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const FontWeights: Record<string, number> = {
	Normal: 400,
	Medium: 500,
	Semibold: 600,
	SemiBold: 600,
	Bold: 700,
	ExtraBold: 800,
	Black: 900,
}

export function parseLegacyTheme(json: unknown): LegacyTheme {
	const theme = json as Partial<LegacyTheme> | null
	if (typeof theme !== 'object' || !theme)
		throw new Error('Theme is not an object')
	if (theme.spec !== 2) throw new Error(`Unsupported theme spec: ${theme.spec}`)
	if (typeof theme.name !== 'string') throw new Error('Theme has no name')
	return theme as LegacyTheme
}

export function parseLegacyFontPack(json: unknown): LegacyFontPack {
	const pack = json as Partial<LegacyFontPack> | null
	if (typeof pack !== 'object' || !pack)
		throw new Error('Font pack is not an object')
	if (pack.spec !== 1)
		throw new Error(`Unsupported font pack spec: ${pack.spec}`)
	if (typeof pack.name !== 'string') throw new Error('Font pack has no name')
	if (typeof pack.main !== 'object' || !pack.main)
		throw new Error('Font pack has no fonts')
	return pack as LegacyFontPack
}

/** Converts legacy `[dark, light, midnight?]` hex arrays to active Discord base themes. */
export function legacyThemeColors(theme: LegacyTheme): ThemeColors {
	const dark: Record<string, string> = {}
	const light: Record<string, string> = {}
	const midnight: Record<string, string> = {}

	for (const [name, values] of Object.entries(theme.semanticColors ?? {})) {
		const [d, l, m] = values
		if (d && HexColor.test(d)) dark[name] = d
		if (l && HexColor.test(l)) light[name] = l
		const mid = m ?? d
		if (mid && HexColor.test(mid)) midnight[name] = mid
	}

	const raw: Record<string, string> = {}
	for (const [name, value] of Object.entries(theme.rawColors ?? {}))
		if (HexColor.test(value)) raw[name] = value

	return {
		semantic: { dark, darker: dark, light, midnight },
		raw,
	}
}

/** Converts a legacy background, skipping one without an `http(s)` URL. */
export function legacyThemeBackground(
	theme: LegacyTheme,
): ThemeBackground | undefined {
	const background = theme.background
	if (
		typeof background?.url !== 'string' ||
		!/^https?:\/\//i.test(background.url)
	)
		return

	return {
		path: background.url,
		opacity:
			typeof background.alpha === 'number' ? background.alpha : undefined,
		blur: typeof background.blur === 'number' ? background.blur : undefined,
	}
}

/**
 * Groups font files into families with upright and italic variants, deriving weights from name suffixes.
 *
 * @param files Map of font family names to downloaded local file paths.
 */
export function legacyFontFamilies(
	files: Record<string, string>,
): FontPackDefinition['families'] {
	const families: FontPackDefinition['families'] = {}

	for (const [name, path] of Object.entries(files)) {
		const italic = name.endsWith('Italic') && name !== 'Italic'
		const family = italic ? name.slice(0, -'Italic'.length) : name
		const style = family.slice(family.lastIndexOf('-') + 1)

		const variant: FontVariant = {
			path,
			weight: FontWeights[style] ?? 400,
			italic,
		}

		;(families[family] ??= []).push(variant)
	}

	return families
}

export function fontFileExtensionOf(url: string) {
	return /\.otf(?:$|[?#])/i.test(url) ? '.otf' : '.ttf'
}
