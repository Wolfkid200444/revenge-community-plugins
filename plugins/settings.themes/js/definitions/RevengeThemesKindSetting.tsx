import { RouteNames, Setting } from '../constants'
import * as RevengeThemesKindSettingScreen from '../screens/RevengeThemesKindSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Groups offering a specific theme kind. Opened from dashboard tile; omitted from main settings list. */
const RevengeThemesKindSetting: SettingsItem = {
	parent: null,
	type: 'route',
	useTitle: () => 'Theme Items',
	unsearchable: true,
	screen: {
		route: RouteNames[Setting.RevengeThemesKind],
		getComponent: () => RevengeThemesKindSettingScreen.default,
	},
}

export default RevengeThemesKindSetting
