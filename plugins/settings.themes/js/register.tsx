import {
	addSettingsItemToSection,
	refreshSettings,
	registerSettingsItems,
} from '@revenge-mod/discord/modules/settings'
import { Setting } from './constants'
import RevengeThemesBackgroundSetting from './definitions/RevengeThemesBackgroundSetting'
import RevengeThemesBrowseSetting from './definitions/RevengeThemesBrowseSetting'
import RevengeThemesFontFamiliesSetting from './definitions/RevengeThemesFontFamiliesSetting'
import RevengeThemesFontFamilySetting from './definitions/RevengeThemesFontFamilySetting'
import RevengeThemesGroupSetting from './definitions/RevengeThemesGroupSetting'
import RevengeThemesKindSetting from './definitions/RevengeThemesKindSetting'
import RevengeThemesPluginsSetting from './definitions/RevengeThemesPluginsSetting'
import RevengeThemesSetting from './definitions/RevengeThemesSetting'

export default function register() {
	const unregisterItems = registerSettingsItems({
		[Setting.RevengeThemes]: RevengeThemesSetting,
		[Setting.RevengeThemesKind]: RevengeThemesKindSetting,
		[Setting.RevengeThemesGroup]: RevengeThemesGroupSetting,
		[Setting.RevengeThemesFontFamilies]: RevengeThemesFontFamiliesSetting,
		[Setting.RevengeThemesFontFamily]: RevengeThemesFontFamilySetting,
		[Setting.RevengeThemesPlugins]: RevengeThemesPluginsSetting,
		[Setting.RevengeThemesBrowse]: RevengeThemesBrowseSetting,
		[Setting.RevengeThemesBackground]: RevengeThemesBackgroundSetting,
	})
	const removeFromSection = addSettingsItemToSection(
		'REVENGE',
		Setting.RevengeThemes,
		2,
	)

	refreshSettings()

	return () => {
		removeFromSection()
		unregisterItems()
		refreshSettings()
	}
}
