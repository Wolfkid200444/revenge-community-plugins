import { getAssetIdByName } from '@revenge-mod/assets'
import { Design } from '@revenge-mod/discord/design'
import { pluginSettings } from '..'
import { showErrorToast } from '../utils/toasts'

const { IconButton } = Design

const SettingsIcon = getAssetIdByName('SettingsIcon')!

/** Opens the settings page for the plugin providing a group, matching its card on the Plugins page. */
export default function PluginSettingsButton({ plugin }: { plugin: string }) {
	if (!pluginSettings) return null

	return (
		<IconButton
			style={{ marginInlineEnd: 8 }}
			size="sm"
			variant="secondary"
			icon={SettingsIcon}
			accessibilityLabel="Plugin settings"
			onPress={() => {
				try {
					pluginSettings.openPluginSettings(plugin)
				} catch (e) {
					showErrorToast(e)
				}
			}}
		/>
	)
}
