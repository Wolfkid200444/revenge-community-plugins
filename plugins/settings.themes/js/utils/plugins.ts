import manifest from '../../manifest.json' with { type: 'json' }
import type { PluginMatch } from '@revenge-mod/types/plugins/settings.plugins'

const ThemesApiId = 'revenge.api.themes'

/**
 * Matches theme plugins requiring the themes API. Plugins with optional theme support remain with plugins.
 * Claimed while this plugin runs to manage and browse them under Themes.
 */
export const isThemePlugin: PluginMatch = plugin =>
	plugin.id !== manifest.id &&
	(plugin.dependencies[ThemesApiId]?.optional === false ||
		plugin.id === ThemesApiId)
