import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import fakeifyExpressions from './patches/expressions/fakeify'
import realifyExpressions from './patches/expressions/realify'
import appIcons from './patches/icons'
import themes from './patches/themes'
import { SettingsComponent } from './settings'
import type {
	PluginApi,
	PluginSettingsComponent,
} from '@revenge-mod/plugins/types'
import type { ComponentProps } from 'react'

export interface ApiOptions {
	jsonStorage: {
		expressions: {
			emojis: {
				transform: boolean
				size: number
			}
			stickers: {
				transform: boolean
				size: number
			}
			checkPermission: boolean
			hyperlink: 'invisible' | 'name' | false
		}
		stream: boolean
		themes: {
			preset: number | false
		}
	}
}

export type FakeNitroSettingsComponentProps = ComponentProps<
	PluginSettingsComponent<ApiOptions>
>

export type FakeNitroPluginContext = PluginApi<ApiOptions>

export let ProductCatalog: ProductCatalog
export let canActuallyUse: OmitThisParameter<ProductCatalog['canUserUse']>

export default plugin<ApiOptions>({
	jsonStorage: {
		load: true,
		default: {
			expressions: {
				emojis: {
					transform: true,
					size: 48,
				},
				stickers: {
					transform: true,
					size: 160,
				},
				checkPermission: true,
				hyperlink: false,
			},
			stream: true,
			themes: {
				preset: false,
			},
		},
	},
	start(api: PluginApi<ApiOptions>) {
		const { cleanup } = api

		cleanup(
			// modules/premium/ProductCatalog.tsx
			getModules(withProps<ProductCatalog>('canUserUse'), Catalog => {
				ProductCatalog = Catalog
				canActuallyUse = Catalog.canUserUse.bind(Catalog)

				cleanup(
					instead(Catalog, 'canUserUse', function (args, orig) {
						switch (args[0]) {
							// case this.EMOJIS_EVERYWHERE:
							// case this.ANIMATED_EMOJIS:
							case this.CLIENT_THEMES:
							case this.STICKERS_EVERYWHERE:
							case this.APP_ICONS:
								return true
							case this.STREAM_MID_QUALITY:
							case this.STREAM_HIGH_QUALITY:
								if (api.jsonStorage.cache?.stream) return true
						}

						return Reflect.apply(orig, this, args)
					}),
				)
			}),
		)

		for (const patches of [
			appIcons,
			themes,
			fakeifyExpressions,
			realifyExpressions,
		])
			try {
				patches(api)
			} catch (e) {
				api.plugin.reportError(
					`Failed to apply patches for ${patches.name}: ${getErrorStack(e)}`,
				)
			}
	},
	SettingsComponent,
})

export interface ProductCatalog {
	canUserUse(this: ProductCatalog, product: any): boolean
	CLIENT_THEMES: any
	APP_ICONS: any
	ANIMATED_EMOJIS: any
	EMOJIS_EVERYWHERE: any
	STICKERS_EVERYWHERE: any
	STREAM_MID_QUALITY: any
	STREAM_HIGH_QUALITY: any
}
