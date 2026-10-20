import { RouteNames, Setting } from '../constants'
import * as RevengeThemesBackgroundSettingScreen from '../screens/RevengeThemesBackgroundSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Background overrides. Opened from the Colors page; omitted from main settings list. */
const RevengeThemesBackgroundSetting: SettingsItem = {
	parent: null,
	type: 'route',
	useTitle: () => 'Background',
	unsearchable: true,
	screen: {
		route: RouteNames[Setting.RevengeThemesBackground],
		getComponent: () => RevengeThemesBackgroundSettingScreen.default,
	},
}

export default RevengeThemesBackgroundSetting
