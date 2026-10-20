import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { deleteRecord, getFetchedRecord, isLinked, storeRecord } from './cache'
import { AuthenticationStore, ChannelStore, Modules } from './discord'
import { takeArrived } from './members'
import { refresh } from './previews'
import type { DiscordModules } from '@revenge-mod/discord/types'

type Payload = DiscordModules.Flux.DispatcherPayload

interface ReactionAction {
	type: string
	channelId: string
	messageId: string
	userId: string
	emoji: unknown
	colors?: unknown
	reactionType?: number
	optimistic?: boolean
}

const DMChannelType = 1

// MessageStore only updates messages from channels it has loaded, so fetched ones are updated here the same way
const handlers: Record<string, (payload: Payload) => void> = {
	MESSAGE_UPDATE({ message }) {
		if (!isLinked(message?.id)) return

		const record = getFetchedRecord(message.id)
		if (record)
			storeRecord(
				Modules.MessageRecordUtils!.updateMessageRecord(record, message),
			)

		refresh(message.id)
	},
	MESSAGE_DELETE({ id }) {
		if (!isLinked(id)) return

		deleteRecord(id)
		refresh(id)
	},
	MESSAGE_REACTION_ADD: handleReaction,
	MESSAGE_REACTION_REMOVE: handleReaction,
	MESSAGE_REACTION_REMOVE_ALL: handleReaction,
	MESSAGE_REACTION_REMOVE_EMOJI: handleReaction,
	GUILD_MEMBERS_CHUNK_BATCH(payload) {
		for (const messageId of takeArrived(payload)) refresh(messageId)
	},
}

function handleReaction(payload: Payload) {
	const action = payload as unknown as ReactionAction
	if (!isLinked(action.messageId)) return

	const record = getFetchedRecord(action.messageId)

	if (record) {
		const me = action.userId === AuthenticationStore().getId()

		switch (action.type) {
			case 'MESSAGE_REACTION_ADD':
			case 'MESSAGE_REACTION_REMOVE':
				// Same as ReactionUtils.shouldApplyReaction
				if (action.optimistic && !me) return

				storeRecord(
					action.type === 'MESSAGE_REACTION_ADD'
						? record.addReaction(action.emoji, me, {
								colors: action.colors,
								reactionType: action.reactionType,
								isDMChannel:
									ChannelStore().getChannel(action.channelId)?.type ===
									DMChannelType,
							})
						: record.removeReaction(action.emoji, me, action.reactionType),
				)
				break
			case 'MESSAGE_REACTION_REMOVE_ALL':
				storeRecord(record.set('reactions', []))
				break
			case 'MESSAGE_REACTION_REMOVE_EMOJI':
				storeRecord(record.removeReactionsForEmoji(action.emoji))
				break
		}
	}

	refresh(action.messageId)
}

export function subscribeUpdates() {
	for (const [type, handler] of Object.entries(handlers))
		Dispatcher.subscribe(type, handler)

	return () => {
		for (const [type, handler] of Object.entries(handlers))
			Dispatcher.unsubscribe(type, handler)
	}
}
