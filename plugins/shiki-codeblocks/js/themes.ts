import { getIndex } from './assets'
import { DiscordThemeName } from './discord'

export type ThemeName = string

interface ThemeInfo {
	label: string
	/** Omitted for dual-theme variants. */
	type?: 'dark' | 'light'
}

let themes: Record<ThemeName, ThemeInfo> | undefined

/** Theme name (as Shiki registers it) to its label and type. */
export function getThemes() {
	themes ??= {
		[DiscordThemeName]: { label: 'Discord' },
		...getIndex().themes,
	}
	return themes
}

/** Themes made for Discord's light (`light`) or dark (`dark`, `darker`, `midnight`) themes. */
export function themesOfType(type: 'dark' | 'light') {
	const themes = getThemes()
	return Object.keys(themes).filter(
		name => (themes[name]!.type ?? type) === type,
	)
}
