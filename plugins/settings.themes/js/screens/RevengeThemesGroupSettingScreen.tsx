import Page from '@revenge-mod/components/Page'
import { useLayoutEffect, useMemo } from 'react'
import { useStore } from 'zustand/react'
import { pluginSettings, themesInternal } from '..'
import { OptionList } from '../components/OptionList'
import PluginInfoButton from '../components/PluginInfoButton'
import { FontRoleLabels, Kinds, useGroupEntries } from '../utils/kinds'
import type { GroupRouteParams } from '../types'

const {
	store: { themesStore },
} = themesInternal

interface Props {
	navigation: { setOptions(options: object): void }
	route: { params: GroupRouteParams }
}

/** Displays all options for a specific theme kind in a group under the provider's icon. */
export default function RevengeThemesGroupSettingScreen({
	navigation,
	route: {
		params: { kind, plugin, group: groupId, role },
	},
}: Props) {
	const provider = useStore(themesStore, s => s.providers[plugin])
	const group = useStore(themesStore, s => s.groups[plugin]?.[groupId])
	const options = useGroupEntries(kind, plugin, groupId, role)
	const sections = useMemo(
		() => [
			{
				key: 'group',
				heading: role && FontRoleLabels[role],
				subtitle: group?.description,
				options,
			},
		],
		[group?.description, options, role],
	)

	const title = group?.name ?? groupId
	const subtitle = provider?.name ?? plugin
	const icon = provider?.icon

	useLayoutEffect(() => {
		const { NavigatorHeaderWithIcon } = pluginSettings!.components
		navigation.setOptions({
			title,
			headerTitle: () => (
				<NavigatorHeaderWithIcon
					title={title}
					subtitle={subtitle}
					icon={icon}
				/>
			),
			headerRight: () => <PluginInfoButton plugin={plugin} />,
		})
	}, [navigation, title, subtitle, icon, plugin])

	return (
		<Page>
			<OptionList
				kind={kind}
				sections={options.length ? sections : []}
				empty={
					options.length
						? undefined
						: `This group has no ${Kinds[kind].label} anymore.`
				}
			/>
		</Page>
	)
}
