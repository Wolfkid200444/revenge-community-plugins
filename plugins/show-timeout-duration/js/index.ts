import { Tokens } from '@revenge-mod/discord/common/tokens'
import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withName } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import { processColor } from 'react-native'
import { clearTimeoutEnds, putTimeoutEnds, setTimeoutColors } from './native'
import type { DiscordModules } from '@revenge-mod/discord/types'

interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

interface MessageRow {
	type?: number
	message?: {
		id: string
		guildId?: string | null
		authorId?: string
	}
}

const MessageRowType = 1

type ThemeStore = DiscordModules.Flux.Store<{ theme: string }>

function sendColors() {
	const theme = (Stores.ThemeStore as ThemeStore).theme
	const { colors, internal } = Tokens.default
	const argb = (token: unknown) =>
		processColor(internal.resolveSemanticColor(theme, token)) as number

	setTimeoutColors(
		argb(colors.TEXT_FEEDBACK_CRITICAL),
		argb(colors.ICON_FEEDBACK_CRITICAL),
	)
}

export default plugin({
	start({ cleanup, plugin }) {
		sendColors()
		Stores.ThemeStore.addChangeListener(sendColors)
		cleanup(() => Stores.ThemeStore.removeChangeListener(sendColors))

		const GuildMemberStore =
			Stores.GuildMemberStore as DiscordModules.Flux.Store<{
				getMember(
					guildId: string,
					userId: string,
				): { communicationDisabledUntil?: string | null } | null
			}>

		// Messages native was told have a timeout, so it's told when it's gone
		const timedOut = new Set<string>()

		cleanup(
			() => clearTimeoutEnds(),
			// modules/messages/native/renderer/RowGenerator.tsx
			getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
				cleanup(
					after(prototype, 'generate', row => {
						const message = row?.type === MessageRowType ? row.message : null
						if (!message?.guildId || !message.authorId) return row

						try {
							const until = Date.parse(
								GuildMemberStore.getMember(message.guildId, message.authorId)
									?.communicationDisabledUntil ?? '',
							)

							if (until > Date.now()) {
								timedOut.add(message.id)
								putTimeoutEnds({ [message.id]: until })
							} else if (timedOut.delete(message.id)) {
								putTimeoutEnds({ [message.id]: 0 })
							}
						} catch (e) {
							plugin.reportError(
								`Failed to get timeout of ${message.authorId}: ${getErrorStack(e)}`,
							)
						}

						return row
					}),
				)
			}),
		)
	},
})
