import type { Plugin } from '@revenge-mod/plugins/types'
import type * as store from './store'

declare module '@revenge-mod/plugins/types' {
	interface PreInitPluginApi<
		O extends PluginApiExtensionsOptions = PluginApiExtensionsOptions,
	> {
		themesInternal: {
			store: typeof store
			plugin: Plugin<any, any>
		}
	}
}
