import TableRowAssetIcon from '@revenge-mod/components/TableRowAssetIcon'
import { RouteNames, Setting } from '../constants'
import * as RevengeThemesSettingScreen from '../screens/RevengeThemesSettingScreen'
import type { SettingsItem } from '@revenge-mod/discord/modules/settings'

const RevengeThemesSetting: SettingsItem = {
	parent: null,
	type: 'route',
	IconComponent: () => <TableRowAssetIcon name="PaintPaletteIcon" />,
	useTitle: () => 'Themes',
	screen: {
		route: RouteNames[Setting.RevengeThemes],
		getComponent: () => RevengeThemesSettingScreen.default,
	},
}

export default RevengeThemesSetting
