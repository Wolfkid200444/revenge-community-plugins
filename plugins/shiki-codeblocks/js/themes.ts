import { getIndex } from './assets'

export type ThemeName = string

/** Theme name (as Shiki registers it) to its label and type. */
export function getThemes() {
	return getIndex().themes
}

/** Themes made for Discord's light (`light`) or dark (`dark`, `darker`, `midnight`) themes. */
export function themesOfType(type: 'dark' | 'light') {
	const themes = getThemes()
	return Object.keys(themes).filter(name => themes[name]!.type === type)
}
