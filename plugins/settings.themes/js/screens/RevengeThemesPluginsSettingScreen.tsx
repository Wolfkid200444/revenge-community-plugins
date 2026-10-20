import { pluginSettings } from '..'
import { RouteNames, Setting } from '../constants'
import { isThemePlugin } from '../utils/plugins'

interface Props {
	navigation: { navigate(route: string): void }
}

/** Renders the Plugins management view filtered to theme plugins. The add button opens Browse Themes. */
export default function RevengeThemesPluginsSettingScreen({
	navigation,
}: Props) {
	const PluginsPage = pluginSettings.PluginsPage
	if (!PluginsPage) return null

	return (
		<PluginsPage
			match={isThemePlugin}
			onBrowse={() =>
				navigation.navigate(RouteNames[Setting.RevengeThemesBrowse])
			}
		/>
	)
}
