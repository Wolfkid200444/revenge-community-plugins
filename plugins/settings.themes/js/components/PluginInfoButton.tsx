import { getAssetIdByName } from '@revenge-mod/assets'
import { Design } from '@revenge-mod/discord/design'
import { pluginSettings } from '..'
import { showErrorToast } from '../utils/toasts'

const { IconButton } = Design

const CircleInformationIcon = getAssetIdByName('CircleInformationIcon')!

/** Opens the options sheet for the plugin providing a group, matching its card on the Plugins page. */
export default function PluginInfoButton({ plugin }: { plugin: string }) {
	if (!pluginSettings) return null

	return (
		<IconButton
			style={{ marginInlineEnd: 8 }}
			size="sm"
			variant="secondary"
			icon={CircleInformationIcon}
			accessibilityLabel="Plugin info"
			onPress={() => {
				try {
					pluginSettings.showPluginOptionsSheet(plugin)
				} catch (e) {
					showErrorToast(e)
				}
			}}
		/>
	)
}
