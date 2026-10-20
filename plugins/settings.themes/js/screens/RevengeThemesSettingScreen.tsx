import { getAssetIdByName } from '@revenge-mod/assets'
import { TableRowAssetIcon } from '@revenge-mod/components'
import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ReactNavigationNative } from '@revenge-mod/externals/react-navigation'
import { lookupGeneratedIconComponent } from '@revenge-mod/utils/discord'
import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import { pluginSettings, themesInternal } from '..'
import KindCard from '../components/KindCard'
import ReloadButton from '../components/ReloadButton'
import { RouteNames, Setting } from '../constants'
import { Kinds, resetAll, useAnySelected } from '../utils/kinds'
import { markReloadNeeded } from '../utils/reload'
import { showErrorToast } from '../utils/toasts'
import type { EntryKind } from '@revenge-mod/themes-api/store'
import type { LayoutChangeEvent } from 'react-native'
import type { KindRouteParams } from '../types'

const { Button, TableRow, TableRowGroup, Text, Stack } = Design

const DenyIcon = getAssetIdByName('DenyIcon')!
const PuzzlePieceIcon = getAssetIdByName('PuzzlePieceIcon')!

const GRID_GAP = 12

/** Minimum tile width at standard font scaling. Prevents inline hint truncation. */
const TILE_MIN_WIDTH = 150

const styles = StyleSheet.create({
	content: {
		paddingBottom: 16,
	},
})

const kinds = Object.keys(Kinds) as EntryKind[]

/**
 * Calculates columns per row fitting {@link width}, from 4 on tablets to 1 on compact screens or large font scales.
 * Skips 3 columns to avoid orphan tiles in a 4-item grid. Defaults to 2 before layout measurement.
 */
function columnsFor(width: number, fontScale: number) {
	if (!width) return 2

	const minWidth = TILE_MIN_WIDTH * Math.max(1, fontScale)
	for (const columns of [4, 2])
		if (columns * minWidth + (columns - 1) * GRID_GAP <= width) return columns
	return 1
}

/** Partitions kind items into explicit rows so tiles share equal heights. */
function rowsOf(columns: number) {
	return Array.from({ length: Math.ceil(kinds.length / columns) }, (_, i) =>
		kinds.slice(i * columns, (i + 1) * columns),
	)
}

/** Main themes dashboard displaying active selections for each kind in interactive bento tiles. */
export default function RevengeThemesSettingScreen() {
	const navigation = ReactNavigationNative.useNavigation()
	const anySelected = useAnySelected()
	const { fontScale } = useWindowDimensions()
	const [gridWidth, setGridWidth] = useState(0)
	const columns = columnsFor(gridWidth, fontScale)
	const rows = useMemo(() => rowsOf(columns), [columns])

	return (
		<ScrollView contentContainerStyle={styles.content}>
			<Page spacing={16}>
				<ReloadButton />
				<Stack
					spacing={GRID_GAP}
					onLayout={(e: LayoutChangeEvent) =>
						setGridWidth(e.nativeEvent.layout.width)
					}
				>
					{rows.map(row => (
						<Stack key={row.join()} direction="horizontal" spacing={GRID_GAP}>
							{row.map(kind => (
								<KindCard
									key={kind}
									kind={kind}
									onPress={() =>
										navigation.navigate(RouteNames[Setting.RevengeThemesKind], {
											kind,
										} satisfies KindRouteParams)
									}
								/>
							))}
						</Stack>
					))}
				</Stack>
				<Text variant="text-sm/medium" color="text-muted">
					Theme plugins provide colors, fonts, icons and emojis. Fonts and
					emojis apply after a reload.
				</Text>
				<Stack spacing={8}>
					{Boolean(pluginSettings.PluginsPage) && (
						<Button
							variant="secondary"
							size="lg"
							icon={PuzzlePieceIcon}
							text="Manage theme plugins"
							onPress={() =>
								navigation.navigate(RouteNames[Setting.RevengeThemesPlugins])
							}
						/>
					)}
					<Button
						variant="secondary"
						size="lg"
						icon={DenyIcon}
						text="Reset"
						disabled={!anySelected}
						onPress={() => resetAll().then(markReloadNeeded, showErrorToast)}
					/>
				</Stack>
				<TableRowGroup>
					<TableRow
						variant="danger"
						icon={
							<TableRowAssetIcon
								variant="danger"
								IconComponent={
									lookupGeneratedIconComponent('HandRequestDenyIcon')!
								}
							/>
						}
						label="Disable all theming features"
						subLabel="You can re-enable theming later from the Plugins page"
						onPress={() => themesInternal.plugin.disable()}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
