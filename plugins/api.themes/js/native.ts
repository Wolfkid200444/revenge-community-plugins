import {
	callNativeMethod,
	callNativeMethodSync,
} from '@revenge-mod/modules/native'
import type {
	BackgroundSettings,
	ColorsSelection,
	EmojiSelection,
	FontsSelection,
	FontVariant,
	IconsSelection,
	ThemesState,
} from './types'

export function readThemesState(): ThemesState {
	return JSON.parse(callNativeMethodSync('revenge.themes.getState', []))
}

export function writeColorsSelection(selection: ColorsSelection | null) {
	return callNativeMethod('revenge.themes.setColors', [
		selection && JSON.stringify(selection),
	])
}

export function writeFontsSelection(selection: FontsSelection | null) {
	return callNativeMethod('revenge.themes.setFonts', [
		selection && JSON.stringify(selection),
	])
}

export function writeIconsSelection(selection: IconsSelection | null) {
	return callNativeMethod('revenge.themes.setIcons', [
		selection && JSON.stringify(selection),
	])
}

export function writeEmojiSelection(selection: EmojiSelection | null) {
	return callNativeMethod('revenge.themes.setEmoji', [
		selection && JSON.stringify(selection),
	])
}

export function writeBackgroundSettings(settings: BackgroundSettings | null) {
	return callNativeMethod('revenge.themes.setBackground', [
		settings && JSON.stringify(settings),
	])
}

/** Copies a picked image (`file://` or `content://`) into storage. Resolves to its absolute path. */
export function importBackgroundImage(uri: string) {
	return callNativeMethod('revenge.themes.importBackground', [uri])
}

/** Registers {@link name} as a font family React Native can render previews with. */
export function registerPreviewFont(
	name: string,
	variants: Required<FontVariant>[],
) {
	callNativeMethodSync('revenge.themes.previewFont', [
		JSON.stringify({ name, variants }),
	])
}

/**
 * Returns image paths of {@link codepoints} in {@link pack}, or Discord's when {@link pack} is `null`.
 *
 * @returns `null` when neither source provides a preview.
 */
export async function readPreviewEmoji(
	pack: Pick<EmojiSelection, 'images' | 'font'> | null,
	codepoints: string[],
): Promise<(string | null)[]> {
	return JSON.parse(
		await callNativeMethod('revenge.themes.previewEmoji', [
			JSON.stringify({ pack, codepoints }),
		]),
	)
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'revenge.themes.getState': [[], string]
		'revenge.themes.setColors': [[json: string | null], null]
		'revenge.themes.setFonts': [[json: string | null], null]
		'revenge.themes.setIcons': [[json: string | null], null]
		'revenge.themes.setEmoji': [[json: string | null], null]
		'revenge.themes.setBackground': [[json: string | null], null]
		'revenge.themes.importBackground': [[uri: string], string]
		'revenge.themes.previewFont': [[json: string], null]
		'revenge.themes.previewEmoji': [[json: string], string]
	}
}
