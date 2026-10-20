import { useMemo } from 'react'
import { useStore } from 'zustand/react'
import { themesInternal } from '..'
import type {
	EntryKind,
	RegisteredGroup,
	ThemesStoreState,
} from '@revenge-mod/themes-api/store'
import type { FontRole, ThemesState } from '@revenge-mod/themes-api/types'

const {
	store: {
		themesStore,
		fontRoleOf,
		fontRoleSelectionOf,
		selectEmojiPack,
		selectFontPack,
		selectFontRole,
		selectIconPack,
		selectTheme,
	},
} = themesInternal

/** Options shown by a group before "See all". */
const GROUP_PREVIEW_SIZE = 3

export interface Kind {
	tab: string
	/** Plural noun identifying kind assets, such as "colors". */
	label: string
	selection: Exclude<keyof ThemesState, 'format'>
	empty: string
	/** Applies without a reload. */
	live?: boolean
	reset: () => Promise<void>
	select: (plugin: string, groupId: string, id: string) => Promise<void>
}

export const Kinds: Record<EntryKind, Kind> = {
	themes: {
		tab: 'Colors',
		label: 'colors',
		selection: 'colors',
		empty: 'Install a theme plugin to get color themes.',
		live: true,
		reset: () => selectTheme(null),
		select: selectTheme,
	},
	fontPacks: {
		tab: 'Fonts',
		label: 'fonts',
		selection: 'fonts',
		empty:
			'Install a theme plugin to get font packs. Fonts apply after a reload.',
		reset: () => selectFontPack(null),
		select: selectFontPack,
	},
	iconPacks: {
		tab: 'Icons',
		label: 'icons',
		selection: 'icons',
		empty: 'Install a theme plugin to get icon packs.',
		live: true,
		reset: () => selectIconPack(null),
		select: selectIconPack,
	},
	emojiPacks: {
		tab: 'Emojis',
		label: 'emojis',
		selection: 'emoji',
		empty:
			'Install a theme plugin to get emoji packs. Emoji apply after a reload.',
		reset: () => selectEmojiPack(null),
		select: selectEmojiPack,
	},
}

/** Font roles in page display order. */
export const FontRoles: FontRole[] = ['sans', 'mono']

export const FontRoleLabels: Record<FontRole, string> = {
	sans: 'Sans serif',
	mono: 'Monospace',
}

export interface OptionEntry {
	key: string
	name: string
	description?: string
	/** Plugin providing the option, or `null` for Discord defaults. */
	plugin: string | null
	group: string
	id: string
	/** Target font role when picking font packs. */
	role?: FontRole
	/** Specific font family when picking granular font families. */
	family?: string
	selected: boolean
	select: () => Promise<void>
}

/** Group section or Discord default section when untitled. */
export interface Section {
	key: string
	/** Section eyebrow label indicating page division, such as font role. */
	heading?: string
	title?: string
	subtitle?: string
	plugin?: string
	group?: string
	/** Target font role for scoped section options. */
	role?: FontRole
	/** Total option count in group when partial previews are displayed. */
	total?: number
	options: OptionEntry[]
}

/** Registered option location coordinates. */
interface OptionSource {
	plugin: string
	group: string
	id: string
}

/**
 * Active selection state: a registered option, Discord defaults (`null`), or `'custom'` when picked font-by-font.
 * Fonts are scoped per role and require passing {@link role}.
 */
type Picked = OptionSource | 'custom' | null

interface Selection {
	plugin: string
	group: string
	theme?: string
	pack?: string
}

function pickedOf(
	kind: EntryKind,
	selected: ThemesState,
	role?: FontRole,
): Picked {
	if (kind === 'fontPacks') {
		const picked = fontRoleSelectionOf(selected.fonts, role)
		if (!picked || picked === 'custom') return picked
		return { plugin: picked.plugin, group: picked.group, id: picked.pack }
	}

	const selection = selected[Kinds[kind].selection] as Selection | undefined
	if (!selection) return null
	return {
		plugin: selection.plugin,
		group: selection.group,
		id: (selection.theme ?? selection.pack)!,
	}
}

function isPicked(picked: Picked, plugin: string, groupId: string, id: string) {
	return (
		typeof picked === 'object' &&
		picked?.plugin === plugin &&
		picked.group === groupId &&
		picked.id === id
	)
}

function useSelected() {
	return useStore(themesStore, s => s.selected)
}

export interface ActiveOption {
	name: string
	/** Asset name or `data:` URL of the providing plugin. */
	icon?: string
	/** Group name containing the option; undefined for Discord defaults. */
	groupName?: string
	/** Subtitle summary of remaining selections, such as independent monospace picks. */
	detail?: string
	/** Registered option location; undefined for Discord defaults. */
	source?: OptionSource
}

/**
 * Resolves active option name and provider icon, or Discord defaults when unregistered.
 * Font-by-font selections display the sans-serif choice, with the monospace choice in {@link ActiveOption.detail}.
 */
export function useActiveOption(kind: EntryKind): ActiveOption {
	const selected = useSelected()
	const providers = useStore(themesStore, s => s.providers)
	const groups = useStore(themesStore, s => s.groups)

	return useMemo(() => {
		let picked = pickedOf(kind, selected)
		const nameOf = (picked: Picked) => pickedNameOf(kind, picked, groups)

		let detail: string | undefined
		if (kind === 'fontPacks' && picked === 'custom') {
			detail = `${FontRoleLabels.mono}: ${nameOf(pickedOf(kind, selected, 'mono'))}`
			picked = pickedOf(kind, selected, 'sans')
		}

		if (picked === 'custom')
			return { name: nameOf(picked), icon: 'TextIcon', detail }

		const group = picked && groups[picked.plugin]?.[picked.group]
		if (!picked || !group?.[kind][picked.id])
			return { name: 'Discord', icon: 'ClydeIcon', detail }

		return {
			name: nameOf(picked),
			icon: providers[picked.plugin]?.icon,
			groupName: group.name ?? picked.group,
			detail,
			source: picked,
		}
	}, [kind, selected, providers, groups])
}

function pickedNameOf(
	kind: EntryKind,
	picked: Picked,
	groups: ThemesStoreState['groups'],
) {
	if (picked === 'custom') return 'Custom'
	if (!picked) return 'Discord'
	return (
		groups[picked.plugin]?.[picked.group]?.[kind][picked.id]?.name ?? picked.id
	)
}

/** Resolves display names of active sources for each font role: pack name, "Discord", or "Custom". */
export function useFontRolePickNames() {
	const selected = useSelected()
	const groups = useStore(themesStore, s => s.groups)

	return useMemo(
		() =>
			Object.fromEntries(
				FontRoles.map(role => [
					role,
					pickedNameOf(
						'fontPacks',
						pickedOf('fontPacks', selected, role),
						groups,
					),
				]),
			) as Record<FontRole, string>,
		[selected, groups],
	)
}

/** Checks whether any theme kind uses a non-default selection. */
export function useAnySelected() {
	return useStore(themesStore, s =>
		Object.values(Kinds).some(({ selection }) => s.selected[selection]),
	)
}

/** Resets all theme kinds to Discord defaults. */
export function resetAll() {
	return Promise.all(Object.values(Kinds).map(({ reset }) => reset()))
}

/**
 * Builds option sections for a theme kind: Discord defaults followed by group sections capped at {@link GROUP_PREVIEW_SIZE}.
 * When {@link role} is specified, filters to font packs providing that role.
 */
export function useKindSections(kind: EntryKind, role?: FontRole) {
	const selected = useSelected()
	const providers = useStore(themesStore, s => s.providers)
	const groups = useStore(themesStore, s => s.groups)

	return useMemo(() => {
		const picked = pickedOf(kind, selected, role)
		const list: Section[] = [
			{
				key: 'discord',
				subtitle:
					picked === 'custom'
						? 'Picked font by font. Pick one here to use it for all of them.'
						: undefined,
				role,
				options: [discordOptionOf(kind, picked, role)],
			},
		]

		for (const [plugin, pluginGroups] of Object.entries(groups)) {
			const provider = providers[plugin]

			for (const [groupId, group] of Object.entries(pluginGroups)) {
				const options = optionsOf(kind, plugin, groupId, group, picked, role)
				if (!options.length) continue

				const preview = previewOf(options)
				list.push({
					key: JSON.stringify([plugin, groupId]),
					title: group.name ?? groupId,
					subtitle: group.description ?? provider?.name ?? plugin,
					plugin,
					group: groupId,
					role,
					total: preview.length < options.length ? options.length : undefined,
					options: preview,
				})
			}
		}

		return list
	}, [groups, providers, kind, selected, role])
}

/** Returns all options within a group, filtered by {@link role} when provided for font packs. */
export function useGroupEntries(
	kind: EntryKind,
	plugin: string,
	groupId: string,
	role?: FontRole,
) {
	const selected = useSelected()
	const group = useStore(themesStore, s => s.groups[plugin]?.[groupId])

	return useMemo(
		() =>
			group
				? optionsOf(
						kind,
						plugin,
						groupId,
						group,
						pickedOf(kind, selected, role),
						role,
					)
				: [],
		[group, kind, plugin, groupId, selected, role],
	)
}

function discordOptionOf(
	kind: EntryKind,
	picked: Picked,
	role?: FontRole,
): OptionEntry {
	const { label } = Kinds[kind]

	return {
		key: 'discord',
		name: 'Discord',
		description: `Default Discord ${role ? `${FontRoleLabels[role].toLowerCase()} ${label}` : label}.`,
		plugin: null,
		group: '',
		id: 'discord',
		role,
		selected: picked === null,
		select: role ? () => selectFontRole(role, null) : Kinds[kind].reset,
	}
}

function optionsOf(
	kind: EntryKind,
	plugin: string,
	groupId: string,
	group: RegisteredGroup,
	picked: Picked,
	role?: FontRole,
): OptionEntry[] {
	const { select } = Kinds[kind]
	let entries = Object.entries(group[kind])

	// Filter to packs providing families matching the requested role
	if (role)
		entries = entries.filter(([, pack]) =>
			Object.keys((pack as RegisteredGroup['fontPacks'][string]).families).some(
				family => fontRoleOf(family) === role,
			),
		)

	return entries.map(([id, option]) => ({
		key: JSON.stringify([plugin, groupId, id]),
		name: option.name,
		description: option.description,
		plugin,
		group: groupId,
		id,
		role,
		selected: isPicked(picked, plugin, groupId, id),
		select: role
			? () => selectFontRole(role, plugin, groupId, id)
			: () => select(plugin, groupId, id),
	}))
}

/**
 * Returns leading options for a group preview, always including the selected option.
 * A selected option positioned beyond preview limit leads the list to prevent reordering on selection.
 */
function previewOf(options: OptionEntry[]) {
	const index = options.findIndex(option => option.selected)
	if (index < GROUP_PREVIEW_SIZE) return options.slice(0, GROUP_PREVIEW_SIZE)
	return [options[index]!, ...options.slice(0, GROUP_PREVIEW_SIZE - 1)]
}
