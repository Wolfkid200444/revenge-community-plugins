import Page from '@revenge-mod/components/Page'
import TableRowAssetIcon from '@revenge-mod/components/TableRowAssetIcon'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@revenge-mod/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { Stack, TableRowGroup, TableSwitchRow } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const setting = <K extends keyof Settings>(key: K): Settings[K] =>
		storage.use(x => key in x)?.[key] ?? DefaultSettings[key]

	const logDeletes = setting('logDeletes')
	const logEdits = setting('logEdits')
	const ignoreSelf = setting('ignoreSelf')
	const ignoreBots = setting('ignoreBots')

	return (
		<Page>
			<ScrollView>
				<Stack spacing={24}>
					<TableRowGroup title="Log">
						<TableSwitchRow
							icon={<TableRowAssetIcon name="TrashIcon" />}
							label="Deleted messages"
							subLabel="Keep deleted messages and attachments in chat, and removed attachments of edited messages."
							value={logDeletes}
							onValueChange={logDeletes => storage.set({ logDeletes })}
						/>
						<TableSwitchRow
							icon={<TableRowAssetIcon name="PencilIcon" />}
							label="Edits"
							subLabel="Show previous versions of edited messages."
							value={logEdits}
							onValueChange={logEdits => storage.set({ logEdits })}
						/>
					</TableRowGroup>
					<TableRowGroup title="Ignore">
						<TableSwitchRow
							icon={<TableRowAssetIcon name="UserIcon" />}
							label="Your messages"
							value={ignoreSelf}
							onValueChange={ignoreSelf => storage.set({ ignoreSelf })}
						/>
						<TableSwitchRow
							icon={<TableRowAssetIcon name="RobotIcon" />}
							label="Bots"
							value={ignoreBots}
							onValueChange={ignoreBots => storage.set({ ignoreBots })}
						/>
					</TableRowGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
