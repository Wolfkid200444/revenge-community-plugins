import { TableRowAssetIcon } from '@revenge-mod/components'
import { RouteNames, Setting } from '../constants'
import * as RevengeThemesBrowseSettingScreen from '../screens/RevengeThemesBrowseSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

/** Repository theme plugins page. Opened from Themes screen; omitted from main settings list. */
const RevengeThemesBrowseSetting: SettingsItem = {
	parent: null,
	type: 'route',
	IconComponent: () => <TableRowAssetIcon name="PlusMediumIcon" />,
	useTitle: () => 'Browse Themes',
	screen: {
		route: RouteNames[Setting.RevengeThemesBrowse],
		getComponent: () => RevengeThemesBrowseSettingScreen.default,
	},
}

export default RevengeThemesBrowseSetting
