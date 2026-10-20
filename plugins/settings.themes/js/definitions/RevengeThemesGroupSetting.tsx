import { RouteNames, Setting } from '../constants'
import * as RevengeThemesGroupSettingScreen from '../screens/RevengeThemesGroupSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Complete option list for a single group. Opened from "See all"; omitted from main settings list. */
const RevengeThemesGroupSetting: SettingsItem = {
	parent: null,
	type: 'route',
	useTitle: () => 'Theme Group',
	unsearchable: true,
	screen: {
		route: RouteNames[Setting.RevengeThemesGroup],
		getComponent: () => RevengeThemesGroupSettingScreen.default,
	},
}

export default RevengeThemesGroupSetting
