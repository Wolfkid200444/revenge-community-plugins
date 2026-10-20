import { patchBackgrounds } from './background'
import { patchColorTokens, patchThemeContext } from './colors'
import * as store from './store'

const {
	clearSelectionsOf,
	loadSelections,
	registerEmojiPack,
	registerFontPack,
	registerGroup,
	registerIconPack,
	registerProvider,
	registerTheme,
	unloadSelections,
	unregisterAll,
} = store

const SettingsPluginId = 'revenge.settings.themes'

export default plugin({
	preInit({ cleanup, decorate, plugin: self }) {
		if (self.startedLate) {
			self.requireReload()
			// Cascade stop to all dependencies
			self.stop()
			return
		}

		patchColorTokens(cleanup)
		patchThemeContext(cleanup)
		patchBackgrounds(cleanup, self.startedLate)
		loadSelections()

		decorate(plugin => {
			const { manifest } = plugin
			const { id } = manifest

			registerProvider(id, manifest)

			plugin.api.themes = {
				registerGroup: (groupId, group) => registerGroup(id, groupId, group),
				registerTheme: (groupId, themeId, theme) =>
					registerTheme(id, groupId, themeId, theme),
				registerFontPack: (groupId, packId, pack) =>
					registerFontPack(id, groupId, packId, pack),
				registerIconPack: (groupId, packId, pack) =>
					registerIconPack(id, groupId, packId, pack),
				registerEmojiPack: (groupId, packId, pack) =>
					registerEmojiPack(id, groupId, packId, pack),
			}

			if (id === SettingsPluginId)
				plugin.api.themesInternal = { store, plugin: self }

			return () => {
				unregisterAll(id)
				clearSelectionsOf(id).catch(e => self.reportError(e))
			}
		})

		cleanup(unloadSelections)
	},
})
