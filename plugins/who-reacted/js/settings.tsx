import Page from '@revenge-mod/components/Page'
import TableRowAssetIcon from '@revenge-mod/components/TableRowAssetIcon'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings, MaxReactionsLimit } from './shared'
import type { PluginSettingsComponent } from '@revenge-mod/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { Slider, Stack, TableRow, TableRowGroup, Text } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const maxReactions =
		storage.use(x => 'maxReactions' in x)?.maxReactions ??
		DefaultSettings.maxReactions

	return (
		<Page>
			<ScrollView>
				<Stack spacing={24}>
					<TableRowGroup title="Fetching">
						<TableRow
							icon={<TableRowAssetIcon name="ReactionIcon" />}
							label="Maximum reactions"
							trailing={
								<Text variant="text-sm/medium" color="text-muted">
									{maxReactions === MaxReactionsLimit ? 'All' : maxReactions}
								</Text>
							}
							subLabel={
								<Stack spacing={8}>
									<Text variant="text-xs/medium" color="text-muted">
										Messages with more different reactions than this won't be
										fetched.
									</Text>
									<Slider
										step={1}
										minimumValue={1}
										maximumValue={MaxReactionsLimit}
										value={maxReactions}
										onValueChange={maxReactions =>
											storage.set({ maxReactions })
										}
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
