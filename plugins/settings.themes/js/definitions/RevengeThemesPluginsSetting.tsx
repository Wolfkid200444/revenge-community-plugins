import { RouteNames, Setting } from '../constants'
import * as RevengeThemesPluginsSettingScreen from '../screens/RevengeThemesPluginsSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Management screen for installed theme plugins. Opened from Themes screen; omitted from main settings list. */
const RevengeThemesPluginsSetting: SettingsItem = {
	parent: null,
	type: 'route',
	useTitle: () => 'Theme Plugins',
	screen: {
		route: RouteNames[Setting.RevengeThemesPlugins],
		getComponent: () => RevengeThemesPluginsSettingScreen.default,
	},
}

export default RevengeThemesPluginsSetting
