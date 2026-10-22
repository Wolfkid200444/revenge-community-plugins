import {
	addAssetOverride,
	getAssetsByName,
	removeAssetOverride,
} from '@revenge-mod/assets'
import { pluginDistDirFor } from '@revenge-mod/plugins/constants'
import { createStore } from 'zustand/vanilla'
import {
	discordColors,
	refreshThemedComponents,
	resolvePreviewColors,
	setThemeColors,
} from './colors'
import {
	readPreviewEmoji,
	readThemesState,
	registerPreviewFont,
	writeBackgroundSettings,
	writeColorsSelection,
	writeEmojiSelection,
	writeFontsSelection,
	writeIconsSelection,
} from './native'
import type { PackagerAsset } from '@revenge-mod/assets/types'
import type { PluginManifest } from '@revenge-mod/plugins/types'
import type {
	BackgroundSettings,
	ColorsSelection,
	EmojiPackDefinition,
	EmojiSelection,
	FontPackDefinition,
	FontRole,
	FontSource,
	FontsSelection,
	IconPackDefinition,
	IconsSelection,
	ThemeBackground,
	ThemeBase,
	ThemeDefinition,
	ThemeGroupDefinition,
	ThemesState,
} from './types'

export interface RegisteredGroup extends Partial<ThemeGroupDefinition> {
	themes: Record<string, ThemeDefinition>
	fontPacks: Record<string, FontPackDefinition>
	iconPacks: Record<string, IconPackDefinition>
	emojiPacks: Record<string, EmojiPackDefinition>
}

export type EntryKind = 'themes' | 'fontPacks' | 'iconPacks' | 'emojiPacks'

/** Plugin with registered themes or packs, as displayed in pickers. */
export interface ThemesProvider {
	name: string
	icon?: string
}

export interface ThemesStoreState {
	/** Active plugins depending on this one, keyed by plugin ID. */
	providers: Record<string, ThemesProvider>
	/** Registered theme assets, keyed by plugin ID, then group ID. */
	groups: Record<string, Record<string, RegisteredGroup>>
	/** Persisted theme selections, applied natively at boot. */
	selected: ThemesState
}

export const themesStore = createStore<ThemesStoreState>(() => ({
	providers: {},
	groups: {},
	selected: { format: 1 },
}))

/** Loads persisted selections and applies JS-managed overrides. */
export function loadSelections() {
	const selected = readThemesState()
	themesStore.setState({ selected })

	setThemeColors(selected.colors?.values)
	applyIconOverrides(undefined, selected.icons)
}

/** Removes JS-applied theme overrides without modifying persisted selections. */
export function unloadSelections() {
	setThemeColors(undefined)
	applyIconOverrides(themesStore.getState().selected.icons, undefined)
}

export function registerProvider(plugin: string, manifest: PluginManifest) {
	themesStore.setState(state => ({
		providers: {
			...state.providers,
			[plugin]: { name: manifest.name, icon: manifest.icon },
		},
	}))
}

export function registerGroup(
	plugin: string,
	groupId: string,
	group: ThemeGroupDefinition,
) {
	updateGroup(plugin, groupId, current => ({ ...current, ...group }))
}

export function registerTheme(
	plugin: string,
	groupId: string,
	themeId: string,
	theme: ThemeDefinition,
) {
	registerEntry(plugin, groupId, 'themes', themeId, theme)

	// Refresh theme if active
	if (
		isSelected(themesStore.getState().selected.colors, plugin, groupId, themeId)
	)
		selectTheme(plugin, groupId, themeId).catch(() => {})
}

export function registerFontPack(
	plugin: string,
	groupId: string,
	packId: string,
	pack: FontPackDefinition,
) {
	registerEntry(plugin, groupId, 'fontPacks', packId, pack)

	// Refresh active families provided by this pack
	const update: Record<string, FontSource | null> = {}
	const sources = fontSourcesOf(plugin, groupId, packId, pack)
	for (const [family, source] of Object.entries(
		themesStore.getState().selected.fonts?.families ?? {},
	))
		if (isFromPack(source, plugin, groupId, packId))
			update[family] = sources[family] ?? null

	updateFonts(update).catch(() => {})
}

export function registerIconPack(
	plugin: string,
	groupId: string,
	packId: string,
	pack: IconPackDefinition,
) {
	registerEntry(plugin, groupId, 'iconPacks', packId, pack)

	if (
		isSelected(themesStore.getState().selected.icons, plugin, groupId, packId)
	)
		selectIconPack(plugin, groupId, packId).catch(() => {})
}

export function registerEmojiPack(
	plugin: string,
	groupId: string,
	packId: string,
	pack: EmojiPackDefinition,
) {
	registerEntry(plugin, groupId, 'emojiPacks', packId, pack)

	if (
		isSelected(themesStore.getState().selected.emoji, plugin, groupId, packId)
	)
		selectEmojiPack(plugin, groupId, packId).catch(() => {})
}

/** Removes all registrations for a plugin. */
export function unregisterAll(plugin: string) {
	themesStore.setState(state => ({
		providers: without(state.providers, plugin),
		groups: without(state.groups, plugin),
	}))
}

/** Clears every selection owned by a plugin. */
export async function clearSelectionsOf(plugin: string) {
	const { colors, fonts, icons, emoji } = themesStore.getState().selected

	await Promise.all([
		colors?.plugin === plugin && selectTheme(null),
		fonts && clearFontsOf(plugin, fonts),
		icons?.plugin === plugin && selectIconPack(null),
		emoji?.plugin === plugin && selectEmojiPack(null),
	])
}

export function selectTheme(plugin: null): Promise<void>
export function selectTheme(
	plugin: string,
	groupId: string,
	themeId: string,
): Promise<void>
export async function selectTheme(
	plugin: string | null,
	groupId?: string,
	themeId?: string,
) {
	let selection: ColorsSelection | undefined

	if (plugin !== null) {
		const theme = entryOf(plugin, groupId!, 'themes', themeId!)
		const discord = discordColors()
		if (!discord) throw new Error("Discord's colors haven't loaded yet")

		selection = {
			plugin,
			group: groupId!,
			theme: themeId!,
			values: theme.getColors(discord),
		}
	}

	if (sameJson(themesStore.getState().selected.colors, selection)) return

	setThemeColors(selection?.values)
	setSelected({ colors: selection })
	try {
		await writeColorsSelection(selection ?? null)
	} finally {
		refreshThemedComponents()
	}
}

/**
 * Selects every font family from a pack, falling back to Discord defaults for the rest.
 * Pass `null` to restore Discord's default fonts.
 */
export function selectFontPack(plugin: null): Promise<void>
export function selectFontPack(
	plugin: string,
	groupId: string,
	packId: string,
): Promise<void>
export async function selectFontPack(
	plugin: string | null,
	groupId?: string,
	packId?: string,
) {
	const update: Record<string, FontSource | null> = {}
	for (const family in themesStore.getState().selected.fonts?.families)
		update[family] = null

	if (plugin !== null)
		Object.assign(update, packFontSourcesOf(plugin, groupId!, packId!))

	return updateFonts(update)
}

/**
 * Selects font families of {@link role} from a pack, using Discord defaults for missing ones.
 * Pass `null` to restore Discord defaults for the entire role. Other roles remain unchanged.
 */
export function selectFontRole(role: FontRole, plugin: null): Promise<void>
export function selectFontRole(
	role: FontRole,
	plugin: string,
	groupId: string,
	packId: string,
): Promise<void>
export async function selectFontRole(
	role: FontRole,
	plugin: string | null,
	groupId?: string,
	packId?: string,
) {
	const update: Record<string, FontSource | null> = {}
	for (const family in themesStore.getState().selected.fonts?.families)
		if (fontRoleOf(family) === role) update[family] = null

	if (plugin !== null)
		for (const [family, source] of Object.entries(
			packFontSourcesOf(plugin, groupId!, packId!),
		))
			if (fontRoleOf(family) === role) update[family] = source

	return updateFonts(update)
}

/** Selects a single font family from a pack. Pass `null` to restore the Discord default. */
export function selectFontFamily(family: string, plugin: null): Promise<void>
export function selectFontFamily(
	family: string,
	plugin: string,
	groupId: string,
	packId: string,
): Promise<void>
export async function selectFontFamily(
	family: string,
	plugin: string | null,
	groupId?: string,
	packId?: string,
) {
	if (plugin === null) return updateFonts({ [family]: null })

	const source = packFontSourcesOf(plugin, groupId!, packId!)[family]
	if (!source)
		throw new Error(
			`Font pack ${plugin}/${groupId}/${packId} has no ${family} family`,
		)
	return updateFonts({ [family]: source })
}

/** Discord sans-serif fonts, with Noto Sans as fallback for non-Latin scripts. */
const SansFamilyPattern = /^(?:ggsans|NotoSans)-/

/** Discord monospace code fonts, with Source Code Pro as fallback. */
const MonoFamilyPattern = /^(?:ggmono|SourceCodePro)-/

/** Identifies the {@link FontRole} of {@link family}, or `undefined` for other families (e.g., display or profile effect fonts). */
export function fontRoleOf(family: string): FontRole | undefined {
	if (SansFamilyPattern.test(family)) return 'sans'
	if (MonoFamilyPattern.test(family)) return 'mono'
}

/**
 * Determines where font families originate for a given {@link role} (or all families if omitted):
 * - `{ plugin, group, pack }`: The entire set comes from a single pack.
 * - `null`: All families use Discord defaults.
 * - `'custom'`: Families were selected individually across different sources.
 */
export function fontRoleSelectionOf(
	fonts: FontsSelection | undefined,
	role?: FontRole,
): { plugin: string; group: string; pack: string } | 'custom' | null {
	const inScope = (family: string) => !role || fontRoleOf(family) === role
	const picked = Object.entries(fonts?.families ?? {}).filter(([family]) =>
		inScope(family),
	)
	if (!picked.length) return null

	const [, { plugin, group, pack }] = picked[0]!
	if (!picked.every(([, source]) => isFromPack(source, plugin, group, pack)))
		return 'custom'

	// A pack selected as a whole has all scoped families selected
	const registered =
		themesStore.getState().groups[plugin]?.[group]?.fontPacks[pack]
	if (
		registered &&
		Object.keys(registered.families).filter(inScope).length !== picked.length
	)
		return 'custom'

	return { plugin, group, pack }
}

export function selectIconPack(plugin: null): Promise<void>
export function selectIconPack(
	plugin: string,
	groupId: string,
	packId: string,
): Promise<void>
export async function selectIconPack(
	plugin: string | null,
	groupId?: string,
	packId?: string,
) {
	let selection: IconsSelection | undefined

	if (plugin !== null) {
		const pack = entryOf(plugin, groupId!, 'iconPacks', packId!)

		const icons: Record<string, string> = {}
		const drawables: Record<string, string> = {}

		for (const [name, path] of Object.entries(pack.icons)) {
			const file = resolvePath(plugin, path)
			icons[name] = file

			for (const asset of Object.values(getAssetsByName(name) ?? {}))
				if (asset && '__packager_asset' in asset)
					drawables[androidResourceIdentifierOf(asset)] = file
		}

		selection = { plugin, group: groupId!, pack: packId!, icons, drawables }
	}

	const previous = themesStore.getState().selected.icons
	if (sameJson(previous, selection)) return

	applyIconOverrides(previous, selection)
	setSelected({ icons: selection })
	try {
		await writeIconsSelection(selection ?? null)
	} finally {
		refreshThemedComponents()
	}
}

export function selectEmojiPack(plugin: null): Promise<void>
export function selectEmojiPack(
	plugin: string,
	groupId: string,
	packId: string,
): Promise<void>
export async function selectEmojiPack(
	plugin: string | null,
	groupId?: string,
	packId?: string,
) {
	let selection: EmojiSelection | undefined

	if (plugin !== null) {
		const pack = entryOf(plugin, groupId!, 'emojiPacks', packId!)
		selection = {
			plugin,
			group: groupId!,
			pack: packId!,
			...emojiSourcesOf(plugin, pack),
		}
	}

	if (sameJson(themesStore.getState().selected.emoji, selection)) return

	setSelected({ emoji: selection })
	await writeEmojiSelection(selection ?? null)
}

/**
 * Resolves semantic colors of a theme, or Discord's when given a `null` plugin, to preview unselected.
 * Calls `getColors()` on the theme each time, so memoize callers where possible.
 *
 * @returns `undefined` before Discord's tokens initialize.
 */
export function previewColorsOf(
	plugin: string | null,
	groupId: string,
	themeId: string,
	theme: ThemeBase,
	names: string[],
	context?: object,
) {
	if (plugin === null)
		return resolvePreviewColors(undefined, theme, names, context)

	const discord = discordColors()
	if (!discord) return

	return resolvePreviewColors(
		entryOf(plugin, groupId, 'themes', themeId).getColors(discord),
		theme,
		names,
		context,
	)
}

/** Font families used for previews, prioritizing body text styles first. */
const PreviewFontFamilies = ['ggsans-Normal', 'ggsans-Medium']

/**
 * Returns a font family to render previews of a pack unselected.
 * Without {@link candidates}, returns the pack's body text family or first family.
 * With {@link candidates}, returns the first family from {@link candidates} available in the pack, such as `['ggsans-Bold']`.
 * Returns `undefined` if no matching family exists.
 */
export function previewFontFamilyOf(
	plugin: string,
	groupId: string,
	packId: string,
	candidates?: string[],
) {
	const families = fontFamiliesOf(
		plugin,
		entryOf(plugin, groupId, 'fontPacks', packId),
	)
	const family = candidates
		? candidates.find(name => name in families)
		: (PreviewFontFamilies.find(name => name in families) ??
			Object.keys(families)[0])
	if (!family) return

	// Commas split into a fallback chain in React Native font styles
	const name = `revenge-themes-preview:${[plugin, groupId, packId, family].map(encodeURIComponent).join('/')}`
	registerPreviewFont(name, families[family]!)
	return name
}

/**
 * Returns image paths of {@link codepoints} (such as `1f600`) in an emoji pack, or Discord's with a `null` plugin.
 * Emoji absent from the pack fall back to Discord's, returning `null` where neither provides one.
 */
export function previewEmojiOf(
	plugin: string | null,
	groupId: string,
	packId: string,
	codepoints: string[],
) {
	return readPreviewEmoji(
		plugin === null
			? null
			: emojiSourcesOf(plugin, entryOf(plugin, groupId, 'emojiPacks', packId)),
		codepoints,
	)
}

/** Returns up to {@link max} icons from an icon pack as asset names and image file paths. */
export function previewIconsOf(
	plugin: string,
	groupId: string,
	packId: string,
	max: number,
) {
	const pack = entryOf(plugin, groupId, 'iconPacks', packId)
	const icons: [name: string, path: string][] = []

	for (const [name, path] of Object.entries(pack.icons)) {
		icons.push([name, resolvePath(plugin, path)])
		if (icons.length === max) break
	}

	return icons
}

function fontFamiliesOf(plugin: string, pack: FontPackDefinition) {
	const families: Record<string, FontSource['variants']> = {}
	for (const [family, variants] of Object.entries(pack.families))
		families[family] =
			variants === 'system-ui'
				? [{ path: 'system-ui', weight: 400, italic: false, axes: {} }]
				: variants.map(variant => ({
						path: resolvePath(plugin, variant.path),
						weight: variant.weight ?? 400,
						italic: variant.italic ?? false,
						axes: variant.axes ?? {},
					}))
	return families
}

function fontSourcesOf(
	plugin: string,
	groupId: string,
	packId: string,
	pack: FontPackDefinition,
) {
	const sources: Record<string, FontSource> = {}
	for (const [family, variants] of Object.entries(fontFamiliesOf(plugin, pack)))
		sources[family] = { plugin, group: groupId, pack: packId, variants }
	return sources
}

function packFontSourcesOf(plugin: string, groupId: string, packId: string) {
	return fontSourcesOf(
		plugin,
		groupId,
		packId,
		entryOf(plugin, groupId, 'fontPacks', packId),
	)
}

function isFromPack(
	source: FontSource,
	plugin: string,
	groupId: string,
	packId: string,
) {
	return (
		source.plugin === plugin &&
		source.group === groupId &&
		source.pack === packId
	)
}

/** Restores Discord font families for those selected from {@link plugin}. */
function clearFontsOf(plugin: string, fonts: FontsSelection) {
	const update: Record<string, null> = {}
	for (const [family, source] of Object.entries(fonts.families))
		if (source.plugin === plugin) update[family] = null
	return updateFonts(update)
}

/** Sets sources for families in {@link update} and persists selections. Pass `null` to restore Discord defaults. */
async function updateFonts(update: Record<string, FontSource | null>) {
	const current = themesStore.getState().selected.fonts
	const families = { ...current?.families }

	for (const [family, source] of Object.entries(update))
		if (source) families[family] = source
		else delete families[family]

	const selection = Object.keys(families).length ? { families } : undefined
	if (sameJson(current, selection)) return

	setSelected({ fonts: selection })
	await writeFontsSelection(selection ?? null)
}

function emojiSourcesOf(plugin: string, pack: EmojiPackDefinition) {
	return {
		images: pack.images && resolvePath(plugin, pack.images),
		font:
			pack.font === 'system' || !pack.font
				? pack.font
				: resolvePath(plugin, pack.font),
	}
}

function isSelected(
	selection:
		| { plugin: string; group: string; theme?: string; pack?: string }
		| undefined,
	plugin: string,
	groupId: string,
	id: string,
) {
	return (
		selection?.plugin === plugin &&
		selection.group === groupId &&
		(selection.theme ?? selection.pack) === id
	)
}

function entryOf<K extends EntryKind>(
	plugin: string,
	groupId: string,
	kind: K,
	id: string,
): RegisteredGroup[K][string] {
	const entry = themesStore.getState().groups[plugin]?.[groupId]?.[kind][id]
	if (!entry)
		throw new Error(`Not registered: ${plugin}/${groupId}/${id} (${kind})`)
	return entry as RegisteredGroup[K][string]
}

function applyIconOverrides(
	previous: IconsSelection | undefined,
	next: IconsSelection | undefined,
) {
	if (previous) for (const name in previous.icons) removeAssetOverride(name)
	if (next)
		for (const [name, file] of Object.entries(next.icons))
			addAssetOverride(name, { uri: `file://${file}` })
}

/** Resolves drawable resource name for a packager asset, matching React Native's `getAndroidResourceIdentifier`. */
function androidResourceIdentifierOf(asset: PackagerAsset) {
	const base = (asset.httpServerLocation ?? '').replace(/^\//, '')
	return `${base}/${asset.name}`
		.toLowerCase()
		.replace(/\//g, '_')
		.replace(/[^a-z0-9_]/g, '')
		.replace(/^(?:assets|assetsunstable_path)_/, '')
}

export interface ActiveBackground {
	uri: string
	opacity?: number
	blur: number
	dimming: number
}

let lastActiveBackground:
	| {
			theme: ThemeBackground | undefined
			settings: BackgroundSettings | undefined
			value: ActiveBackground | undefined
	  }
	| undefined

/** Background configuration provided by the active color theme, if defined. */
export function themeBackgroundOf({ groups, selected }: ThemesStoreState) {
	const colors = selected.colors
	if (colors)
		return groups[colors.plugin]?.[colors.group]?.themes[colors.theme]
			?.background
}

export function activeBackgroundOf(state: ThemesStoreState) {
	const theme = themeBackgroundOf(state)
	const settings = state.selected.background
	if (
		lastActiveBackground &&
		lastActiveBackground.theme === theme &&
		lastActiveBackground.settings === settings
	)
		return lastActiveBackground.value

	const source = settings?.source ?? 'theme'
	// Theme opacity, blur and dimming defaults apply exclusively to theme backgrounds.
	const base = source === 'theme' ? theme : undefined
	const path = source === 'custom' ? settings?.path : base?.path

	const value: ActiveBackground | undefined = path
		? {
				uri: imageUriOf(path, state.selected.colors?.plugin),
				opacity: settings?.opacity ?? base?.opacity,
				blur: settings?.blur ?? base?.blur ?? 0,
				dimming: settings?.dimming ?? base?.dimming ?? 0.7,
			}
		: undefined

	lastActiveBackground = { theme, settings, value }
	return value
}

export async function setBackgroundSettings(
	settings: BackgroundSettings | null,
) {
	if (
		sameJson(themesStore.getState().selected.background, settings ?? undefined)
	)
		return

	setSelected({ background: settings ?? undefined })
	try {
		await writeBackgroundSettings(settings)
	} finally {
		refreshThemedComponents()
	}
}

export { importBackgroundImage } from './native'

function imageUriOf(path: string, plugin: string | undefined) {
	if (/^https?:\/\//i.test(path)) return path
	if (path.startsWith('/')) return `file://${path}`
	return plugin ? `file://${resolvePath(plugin, path)}` : path
}

function resolvePath(plugin: string, path: string) {
	return path.startsWith('/') ? path : `${pluginDistDirFor(plugin)}/${path}`
}

function setSelected(update: Partial<ThemesState>) {
	themesStore.setState(state => ({
		selected: { ...state.selected, ...update },
	}))
}

function registerEntry<K extends EntryKind>(
	plugin: string,
	groupId: string,
	kind: K,
	id: string,
	entry: RegisteredGroup[K][string],
) {
	updateGroup(plugin, groupId, current => ({
		...current,
		[kind]: { ...current[kind], [id]: entry },
	}))
}

function updateGroup(
	plugin: string,
	groupId: string,
	update: (group: RegisteredGroup) => RegisteredGroup,
) {
	themesStore.setState(state => {
		const current = state.groups[plugin]?.[groupId] ?? {
			themes: {},
			fontPacks: {},
			iconPacks: {},
			emojiPacks: {},
		}

		return {
			groups: {
				...state.groups,
				[plugin]: { ...state.groups[plugin], [groupId]: update(current) },
			},
		}
	})
}

function without<T>(map: Record<string, T>, plugin: string) {
	if (!(plugin in map)) return map
	const { [plugin]: _, ...rest } = map
	return rest
}

function sameJson(a: unknown, b: unknown) {
	return JSON.stringify(a) === JSON.stringify(b)
}
