import { RouteNames, Setting } from '../constants'
import * as RevengeThemesFontFamiliesSettingScreen from '../screens/RevengeThemesFontFamiliesSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Displays all font families supplied by registered packs. Opened from Fonts page; omitted from main settings list. */
const RevengeThemesFontFamiliesSetting: SettingsItem = {
	parent: null,
	type: 'route',
	useTitle: () => 'Font Families',
	unsearchable: true,
	screen: {
		route: RouteNames[Setting.RevengeThemesFontFamilies],
		getComponent: () => RevengeThemesFontFamiliesSettingScreen.default,
	},
}

export default RevengeThemesFontFamiliesSetting
