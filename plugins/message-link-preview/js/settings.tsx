import Page from '@revenge-mod/components/Page'
import TableRowAssetIcon from '@revenge-mod/components/TableRowAssetIcon'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings, MaxHeightRange, MaxPreviewsLimit } from './shared'
import type { PluginSettingsComponent } from '@revenge-mod/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { Slider, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const maxPreviews =
		storage.use(x => 'maxPreviews' in x)?.maxPreviews ??
		DefaultSettings.maxPreviews
	const maxHeight =
		storage.use(x => 'maxHeight' in x)?.maxHeight ?? DefaultSettings.maxHeight
	const interactive =
		storage.use(x => 'interactive' in x)?.interactive ??
		DefaultSettings.interactive

	return (
		<Page>
			<ScrollView>
				<Stack spacing={24}>
					<TableRowGroup>
						<TableSwitchRow
							icon={<TableRowAssetIcon name="HandRequestSpeakIcon" />}
							label="Interactive previews"
							subLabel="Tap, hold, and react to linked messages like any other message."
							value={interactive}
							onValueChange={interactive => storage.set({ interactive })}
						/>
					</TableRowGroup>
					<TableRowGroup title="Previews">
						<TableRow
							icon={<TableRowAssetIcon name="ChatIcon" />}
							label="Previews per message"
							trailing={
								<Text variant="text-sm/medium" color="text-muted">
									{maxPreviews}
								</Text>
							}
							subLabel={
								<Stack spacing={8}>
									<Text variant="text-xs/medium" color="text-muted">
										Only the first links in a message get a preview.
									</Text>
									<Slider
										step={1}
										minimumValue={1}
										maximumValue={MaxPreviewsLimit}
										value={maxPreviews}
										onValueChange={maxPreviews => storage.set({ maxPreviews })}
									/>
								</Stack>
							}
						/>
						<TableRow
							icon={<TableRowAssetIcon name="ArrowsUpDownIcon" />}
							label="Maximum height"
							trailing={
								<Text variant="text-sm/medium" color="text-muted">
									{maxHeight}dp
								</Text>
							}
							subLabel={
								<Stack spacing={8}>
									<Text variant="text-xs/medium" color="text-muted">
										Taller messages fade out at the bottom.
									</Text>
									<Slider
										step={MaxHeightRange.step}
										minimumValue={MaxHeightRange.min}
										maximumValue={MaxHeightRange.max}
										value={maxHeight}
										onValueChange={maxHeight => storage.set({ maxHeight })}
									/>
								</Stack>
							}
						/>
					</TableRowGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
