import { pluginSettings } from '..'
import { isThemePlugin } from '../utils/plugins'

/** Renders the Browse Plugins view filtered strictly to theme plugins. */
export default function RevengeThemesBrowseSettingScreen() {
	const BrowsePage = pluginSettings.BrowsePage
	if (!BrowsePage) return null

	return (
		<BrowsePage
			match={isThemePlugin}
			empty={
				'No themes available.\nYou probably reached the end of the list, somehow!'
			}
		/>
	)
}
