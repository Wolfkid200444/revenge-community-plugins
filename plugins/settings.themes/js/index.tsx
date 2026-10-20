/// <reference types="@revenge-mod/themes-api/hidden" />
/// <reference types="@revenge-mod/types/plugins/settings.plugins" />

import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { onSettingsModulesLoaded } from '@revenge-mod/discord/modules/settings'
import { ReactNavigationNative } from '@revenge-mod/externals/react-navigation'
import { lookupGeneratedIconComponent } from '@revenge-mod/utils/discord'
import { RouteNames, Setting } from './constants'
import { isThemePlugin } from './utils/plugins'
import type { PluginApi, PreInitPluginApi } from '@revenge-mod/plugins/types'

export let themesInternal: PreInitPluginApi['themesInternal']
export let pluginSettings: PluginApi['pluginSettings']

interface Settings {
	guideShownAt?: number
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
	},
	preInit({ themesInternal: internal }) {
		themesInternal = internal
	},
	start({ cleanup, pluginSettings: settings, plugin }) {
		pluginSettings = settings
		// Manage theme plugins under Themes instead of standard plugins settings
		settings.claimPlugins(isThemePlugin)
		cleanup(
			onSettingsModulesLoaded(() => {
				import('./register').then(({ default: register }) =>
					cleanup(register()),
				)
			}),
		)

		if (plugin.startedLate) {
			ToastActionCreators.open('REVENGE_THEMES_GUIDE', {
				icon: lookupGeneratedIconComponent('LightbulbIcon'),
				text: (
					<Design.Text variant="text-md/normal" color="text-strong">
						You can now access:{' \n'}
						<Design.Text variant="text-md/bold">
							Settings &gt; Revenge &gt; Themes
						</Design.Text>
					</Design.Text>
				),
				duration: 10000,
			})
		}
	},
	SettingsComponent: () => {
		const navigation = ReactNavigationNative.useNavigation()
		navigation.replace(RouteNames[Setting.RevengeThemes])

		return (
			<Design.Text>This page isn't supposed to exist. :clueless:</Design.Text>
		)
	},
})
