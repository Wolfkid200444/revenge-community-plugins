// Individual font family selections for granular font management pages.

import { useMemo } from 'react'
import { useStore } from 'zustand/react'
import { themesInternal } from '..'
import type { FontRole } from '@revenge-mod/themes-api/types'
import type { OptionEntry, Section } from './kinds'

const {
	store: { themesStore, fontRoleOf, selectFontFamily },
} = themesInternal

interface FontFamilyEntry {
	family: string
	/** Name of providing pack; undefined for Discord defaults. */
	packName?: string
	/** Registered source coordinates; undefined for Discord defaults. */
	source?: { plugin: string; group: string; id: string }
}

/** Resolves font families supplied by registered packs, grouped by role. Only provided families can be picked. */
export function useFontFamilies() {
	const groups = useStore(themesStore, s => s.groups)
	const families = useStore(themesStore, s => s.selected.fonts?.families)

	return useMemo(() => {
		const names = new Set<string>()
		for (const pluginGroups of Object.values(groups))
			for (const group of Object.values(pluginGroups))
				for (const pack of Object.values(group.fontPacks))
					for (const family in pack.families) names.add(family)

		const byRole = new Map<FontRole | undefined, FontFamilyEntry[]>()
		for (const family of [...names].sort()) {
			const role = fontRoleOf(family)
			const source = families?.[family]
			const entry: FontFamilyEntry = { family }

			if (source) {
				entry.source = {
					plugin: source.plugin,
					group: source.group,
					id: source.pack,
				}
				entry.packName =
					groups[source.plugin]?.[source.group]?.fontPacks[source.pack]?.name ??
					source.pack
			}

			byRole.set(role, [...(byRole.get(role) ?? []), entry])
		}

		return byRole
	}, [groups, families])
}

/** Builds option sections for {@link family}, starting with Discord defaults followed by provider packs. */
export function useFontFamilySections(family: string) {
	const providers = useStore(themesStore, s => s.providers)
	const groups = useStore(themesStore, s => s.groups)
	const source = useStore(themesStore, s => s.selected.fonts?.families[family])

	return useMemo(() => {
		const list: Section[] = [
			{
				key: 'discord',
				options: [
					{
						key: 'discord',
						name: 'Discord',
						description: `Default Discord ${family}.`,
						plugin: null,
						group: '',
						id: 'discord',
						family,
						selected: !source,
						select: () => selectFontFamily(family, null),
					},
				],
			},
		]

		for (const [plugin, pluginGroups] of Object.entries(groups)) {
			const provider = providers[plugin]

			for (const [groupId, group] of Object.entries(pluginGroups)) {
				const options: OptionEntry[] = Object.entries(group.fontPacks)
					.filter(([, pack]) => family in pack.families)
					.map(([id, pack]) => ({
						key: JSON.stringify([plugin, groupId, id]),
						name: pack.name,
						description: pack.description,
						plugin,
						group: groupId,
						id,
						family,
						selected:
							source?.plugin === plugin &&
							source.group === groupId &&
							source.pack === id,
						select: () => selectFontFamily(family, plugin, groupId, id),
					}))
				if (!options.length) continue

				list.push({
					key: JSON.stringify([plugin, groupId]),
					title: group.name ?? groupId,
					subtitle: group.description ?? provider?.name ?? plugin,
					plugin,
					group: groupId,
					options,
				})
			}
		}

		return list
	}, [groups, providers, family, source])
}
