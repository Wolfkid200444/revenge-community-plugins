import { getAssetIdByName } from '@revenge-mod/assets'
import Page from '@revenge-mod/components/Page'
import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { importLegacyFontPack, importLegacyTheme, removeLegacyImport } from '.'
import type { PluginSettingsComponent } from '@revenge-mod/plugins/types'
import type { ComponentProps } from 'react'
import type { Storage } from '.'

const { Button, IconButton, Stack, TableRow, TableRowGroup, TextInput } = Design

const TrashIcon = getAssetIdByName('TrashIcon')!

function showErrorToast(e: unknown) {
	ToastActionCreators.open('REVENGE_LEGACY_THEMES_ERROR', {
		text: e instanceof Error ? e.message : String(e),
		variant: 'critical',
	})
}

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Storage }>>

export default function LegacyThemesSettings({
	api: { jsonStorage: storage },
}: Props) {
	const data = storage.use()
	const themes = Object.entries(data?.themes ?? {})
	const fonts = Object.entries(data?.fonts ?? {})
	const [url, setUrl] = useState('')
	const [busy, setBusy] = useState(false)

	const run = (task: (url: string) => Promise<void>) => {
		setBusy(true)
		task(url.trim())
			.then(() => setUrl(''), showErrorToast)
			.finally(() => setBusy(false))
	}

	return (
		<ScrollView>
			<Page>
				<TextInput
					label="Theme or font pack URL"
					onChange={setUrl}
					placeholder="https://example.com/theme.json"
					size="md"
					value={url}
				/>
				<Stack direction="horizontal" spacing={8}>
					<Button
						grow
						disabled={busy || !url.trim()}
						onPress={() => run(importLegacyTheme)}
						text="Import theme"
						variant="primary"
					/>
					<Button
						grow
						disabled={busy || !url.trim()}
						onPress={() => run(importLegacyFontPack)}
						text="Import fonts"
						variant="secondary"
					/>
				</Stack>
				<TableRowGroup title="Themes">
					{!themes.length && (
						<TableRow
							label="No themes imported"
							subLabel="Import a Vendetta or Bunny theme by its URL above."
							disabled
						/>
					)}
					{themes.map(([source, theme]) => (
						<TableRow
							key={source}
							label={theme.name}
							subLabel={source}
							trailing={
								<IconButton
									icon={TrashIcon}
									onPress={() =>
										removeLegacyImport('themes', source).catch(showErrorToast)
									}
									size="sm"
									variant="destructive"
								/>
							}
						/>
					))}
				</TableRowGroup>
				<TableRowGroup title="Font packs">
					{!fonts.length && (
						<TableRow
							label="No font packs imported"
							subLabel="Import a Vendetta or Bunny font pack by its URL above."
							disabled
						/>
					)}
					{fonts.map(([source, { pack }]) => (
						<TableRow
							key={source}
							label={pack.name}
							subLabel={source}
							trailing={
								<IconButton
									icon={TrashIcon}
									onPress={() =>
										removeLegacyImport('fonts', source).catch(showErrorToast)
									}
									size="sm"
									variant="destructive"
								/>
							}
						/>
					))}
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
