import { getAssetIdByName } from '@revenge-mod/assets'
import { Design } from '@revenge-mod/discord/design'
import { ReactNavigationNative } from '@revenge-mod/externals/react-navigation'
import { FlatList, StyleSheet } from 'react-native'
import { pluginSettings } from '..'
import { RouteNames, Setting } from '../constants'
import { Kinds } from '../utils/kinds'
import { markReloadNeeded, useReloadNeeded } from '../utils/reload'
import { showErrorToast } from '../utils/toasts'
import PluginInfoButton from './PluginInfoButton'
import PluginSettingsButton from './PluginSettingsButton'
import { subLabelOf } from './Previews'
import ReloadButton from './ReloadButton'
import type { EntryKind } from '@revenge-mod/themes-api/store'
import type { GroupRouteParams } from '../types'
import type { Section } from '../utils/kinds'

const { Button, Stack, TableRadioGroup, TableRadioRow, Text } = Design

const ChevronSmallRightIcon = getAssetIdByName('ChevronSmallRightIcon')!

const styles = StyleSheet.create({
	list: {
		gap: 32,
		paddingBottom: 16,
	},
	flex: {
		flex: 1,
	},
	autoWidth: {
		width: 'auto',
	},
})

export interface OptionListProps {
	kind: EntryKind
	sections: Section[]
	/** Empty state message rendered below the list. */
	empty?: string
}

/** Radio selection groups grouped by section within a page. */
export function OptionList({ kind, sections, empty }: OptionListProps) {
	const reloadNeeded = useReloadNeeded()

	return (
		<FlatList
			contentContainerStyle={styles.list}
			fadingEdgeLength={16}
			data={sections}
			keyExtractor={section => section.key}
			ListHeaderComponent={reloadNeeded ? <ReloadButton /> : null}
			ListFooterComponent={
				empty ? (
					<Text variant="text-sm/medium" color="text-muted">
						{empty}
					</Text>
				) : null
			}
			renderItem={({ item: section }) => (
				<SectionGroup kind={kind} section={section} />
			)}
		/>
	)
}

function SectionGroup({
	kind,
	section,
}: {
	kind: EntryKind
	section: Section
}) {
	const navigation = ReactNavigationNative.useNavigation()
	const { options, total } = section

	return (
		<Stack spacing={12}>
			{Boolean(section.heading) && (
				<Text variant="eyebrow" color="text-muted">
					{section.heading}
				</Text>
			)}
			{(section.title || section.subtitle) && (
				<SectionHeader section={section} />
			)}
			<TableRadioGroup<string | null>
				value={options.find(option => option.selected)?.key ?? null}
				onChange={key => {
					const option = options.find(option => option.key === key)
					// Ignore tapping currently selected option
					if (!option || option.selected) return
					option
						.select()
						.then(
							Kinds[kind].live ? undefined : markReloadNeeded,
							showErrorToast,
						)
				}}
			>
				{options.map(option => (
					<TableRadioRow
						key={option.key}
						value={option.key}
						label={option.name}
						subLabel={subLabelOf(kind, option)}
					/>
				))}
			</TableRadioGroup>
			{total !== undefined && (
				<Button
					size="md"
					variant="secondary"
					icon={ChevronSmallRightIcon}
					iconPosition="end"
					text={`See all ${total} ${Kinds[kind].label}`}
					onPress={() =>
						navigation.navigate(RouteNames[Setting.RevengeThemesGroup], {
							kind,
							plugin: section.plugin!,
							group: section.group!,
							role: section.role,
						} satisfies GroupRouteParams)
					}
				/>
			)}
		</Stack>
	)
}

/** Section header showing group name, description, and provider info button. */
function SectionHeader({ section }: { section: Section }) {
	return (
		<Stack direction="horizontal" spacing={8} align="center">
			<Stack spacing={4} style={styles.flex}>
				{Boolean(section.title) && (
					<Text variant="heading-xl/bold" color="text-strong">
						{section.title}
					</Text>
				)}
				{Boolean(section.subtitle) && (
					<Text variant="text-md/medium" color="text-muted">
						{section.subtitle}
					</Text>
				)}
			</Stack>
			{section.plugin !== undefined && (
				<Stack direction="horizontal" spacing={0} style={styles.autoWidth}>
					{/* The InfoButton already has padding. */}
					{pluginSettings.hasPluginSettings(section.plugin) && (
						<PluginSettingsButton plugin={section.plugin} />
					)}
					<PluginInfoButton plugin={section.plugin} />
				</Stack>
			)}
		</Stack>
	)
}
