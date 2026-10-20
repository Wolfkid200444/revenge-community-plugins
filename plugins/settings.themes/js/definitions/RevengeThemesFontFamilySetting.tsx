import { RouteNames, Setting } from '../constants'
import * as RevengeThemesFontFamilySettingScreen from '../screens/RevengeThemesFontFamilySettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Font packs providing a specific font family. Opened from font families page; omitted from main settings list. */
const RevengeThemesFontFamilySetting: SettingsItem = {
	parent: null,
	type: 'route',
	useTitle: () => 'Font Family',
	unsearchable: true,
	screen: {
		route: RouteNames[Setting.RevengeThemesFontFamily],
		getComponent: () => RevengeThemesFontFamilySettingScreen.default,
	},
}

export default RevengeThemesFontFamilySetting
