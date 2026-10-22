import { getModules } from '@revenge-mod/modules/finders'
import { withName } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import { patchChannelActionSheet, patchMessageActionSheet } from './actionsheet'
import { interceptMessages, resetLogs } from './logger'
import { clearDimmedAttachments } from './native'
import { styleRow } from './rows'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { GenerateArgs, RowManager } from './rows'
import type { Settings } from './shared'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	start({ cleanup, jsonStorage: storage, plugin }) {
		const settings = (): Settings => ({
			...DefaultSettings,
			...(storage.cache as Partial<Settings> | undefined),
		})

		cleanup(
			...interceptMessages(settings),
			() => {
				resetLogs()
				clearDimmedAttachments()
			},
			patchMessageActionSheet(e =>
				plugin.reportError(
					`Failed to add message actions: ${getErrorStack(e)}`,
				),
			),
			patchChannelActionSheet(e =>
				plugin.reportError(
					`Failed to add channel actions: ${getErrorStack(e)}`,
				),
			),
			// modules/messages/native/renderer/RowGenerator.tsx
			getModules(
				withName<{ prototype: RowManager }>('RowManager'),
				({ prototype }) => {
					cleanup(
						instead(prototype, 'generate', function (args, original) {
							const row = original.apply(this, args)

							try {
								styleRow(row, args[0], (args: GenerateArgs) =>
									original.call(this, args),
								)
							} catch (e) {
								plugin.reportError(
									`Failed to style logged message: ${getErrorStack(e)}`,
								)
							}

							return row
						}),
					)
				},
			),
		)
	},
	SettingsComponent,
})
