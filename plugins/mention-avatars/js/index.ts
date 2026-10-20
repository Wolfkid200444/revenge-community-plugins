import { getModules } from '@revenge-mod/modules/finders'
import { withName } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import { withIcons } from './mentions'
import type { ContentNode } from './mentions'

interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

interface MessageRow {
	type?: number
	message?: RowMessage
}

interface RowMessage {
	content?: ContentNode[]
	referencedMessage?: { message?: RowMessage }
}

const MessageRowType = 1

export default plugin({
	start({ cleanup, plugin }) {
		const addIcons = (message: RowMessage) => {
			if (message.content) message.content = withIcons(message.content)
		}

		cleanup(
			// modules/messages/native/renderer/RowGenerator.tsx
			getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
				cleanup(
					after(prototype, 'generate', row => {
						const message = row?.type === MessageRowType ? row.message : null
						if (!message) return row

						try {
							addIcons(message)

							const reply = message.referencedMessage?.message
							if (reply) addIcons(reply)
						} catch (e) {
							plugin.reportError(
								`Failed to add mention icons: ${getErrorStack(e)}`,
							)
						}

						return row
					}),
				)
			}),
		)
	},
})
