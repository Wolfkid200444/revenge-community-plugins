import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from '.'
import { getThemes, themesOfType } from './themes'
import type { PluginSettingsComponent } from '@revenge-mod/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from '.'
import type { ThemeName } from './themes'

const { Stack, TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow } =
	Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const Groups = [
	['dark', 'Dark Theme'],
	['light', 'Light Theme'],
] as const

export default function SettingsComponent({ api: { jsonStorage } }: Props) {
	const settings: Partial<Settings> = jsonStorage.use() ?? DefaultSettings

	return (
		<Page>
			<ScrollView>
				<Stack spacing={24}>
					<TableRowGroup>
						<TableSwitchRow
							label="Open on tap"
							subLabel="Tap a code block to view it in full and select its text."
							value={settings.openOnTap ?? DefaultSettings.openOnTap}
							onValueChange={openOnTap => jsonStorage.set({ openOnTap })}
						/>
					</TableRowGroup>
					{Groups.map(([type, title]) => (
						<TableRadioGroup<ThemeName>
							key={type}
							title={title}
							defaultValue={settings[type] ?? DefaultSettings[type]}
							onChange={theme => jsonStorage.set({ [type]: theme })}
						>
							{themesOfType(type).map(name => (
								<TableRadioRow
									key={name}
									label={getThemes()[name]!.label}
									value={name}
								/>
							))}
						</TableRadioGroup>
					))}
				</Stack>
			</ScrollView>
		</Page>
	)
}
