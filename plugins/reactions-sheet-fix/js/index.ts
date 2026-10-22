import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import type { DiscordModules } from '@revenge-mod/discord/types'

interface Emoji {
	id?: string | null
	name: string
}

interface GetReactorsOptions {
	channelId: string
	messageId: string
	emoji: Emoji
	limit: number
	after?: string | null
	type?: number
}

interface ReactionActionCreators {
	getReactors(options: GetReactorsOptions): Promise<unknown>
	addReaction: unknown
}

interface ReactionAction {
	type: string
	messageId: string
	emoji?: Emoji
	reactionType?: number
	userId?: string
	users?: { id: string }[]
}

interface Page {
	limit: number
	size?: number
	last?: string
}

/** One emoji and type of reactions on a message, as MessageReactionsStore keeps it */
interface ReactorList {
	channelId: string
	messageId: string
	emoji: Emoji
	type: number
	/** MessageReactionsStore's own map */
	users?: Map<string, unknown>
	limit: number
	/** Last user fetched in order from the start, so the next page comes after it */
	cursor?: string
	/** Every page was fetched */
	complete: boolean
	/** Missing people the next page wouldn't bring in */
	stale: boolean
	pages: Page[]
}

// MessageReactionsContent.tsx
const PageSize = 100

export default plugin({
	start({ cleanup }) {
		const MessageReactionsStore =
			Stores.MessageReactionsStore as DiscordModules.Flux.Store<{
				getReactions(
					channelId: string,
					messageId: string,
					emoji: Emoji,
					limit: number,
					type?: number,
				): Map<string, unknown> | undefined
			}>

		let ReactionActionCreators: ReactionActionCreators | undefined
		const lists = new Map<string, ReactorList>()

		function listFor({
			channelId,
			messageId,
			emoji,
			type = 0,
		}: Pick<ReactorList, 'channelId' | 'messageId' | 'emoji'> & {
			type?: number
		}) {
			const key = reactionKey(messageId, emoji, type)
			let list = lists.get(key)
			if (!list) {
				list = {
					channelId,
					messageId,
					emoji,
					type,
					limit: 0,
					complete: false,
					stale: false,
					pages: [],
				}
				lists.set(key, list)
			}
			return list
		}

		function* listsOf(messageId: string, emoji?: Emoji) {
			for (const list of lists.values())
				if (
					list.messageId === messageId &&
					(!emoji || emojiKey(list.emoji) === emojiKey(emoji))
				)
					yield list
		}

		function fetchPage(list: ReactorList, after?: string) {
			return ReactionActionCreators!.getReactors({
				channelId: list.channelId,
				messageId: list.messageId,
				emoji: list.emoji,
				limit: list.limit,
				after,
				type: list.type,
			}) as Promise<Page | undefined>
		}

		// Fetches again from the start, keeping who's already shown
		async function resync(list: ReactorList) {
			const { cursor, complete } = list
			let after: string | undefined

			do {
				const page = await fetchPage(list, after)
				if (!page?.last || page.size! < page.limit) return
				after = page.last
			} while (complete || (cursor && compareSnowflakes(after, cursor) < 0))
		}

		function sync(list: ReactorList) {
			if (list.pages.length || !list.users) return

			if (list.stale) {
				list.stale = false
				void resync(list)
			}
			// Lists too short to scroll never load more, like ones fetched with a smaller limit
			else if (!list.complete && list.users.size < list.limit)
				void fetchPage(list, list.cursor)
		}

		const handlers: Record<string, (action: ReactionAction) => void> = {
			CONNECTION_OPEN() {
				lists.clear()
			},
			MESSAGE_REACTION_ADD({ messageId, emoji, reactionType = 0, userId }) {
				const list = lists.get(reactionKey(messageId, emoji!, reactionType))
				// Only added when UserStore has them
				if (
					list?.users &&
					!list.users.has(userId!) &&
					(list.complete ||
						(list.cursor && compareSnowflakes(userId!, list.cursor) < 0))
				)
					list.stale = true
			},
			MESSAGE_REACTION_ADD_MANY({ messageId }) {
				for (const list of listsOf(messageId)) list.stale = true
			},
			MESSAGE_REACTION_REMOVE_ALL({ messageId }) {
				for (const list of listsOf(messageId)) clear(list)
			},
			MESSAGE_REACTION_REMOVE_EMOJI({ messageId, emoji }) {
				for (const list of listsOf(messageId, emoji)) clear(list)
			},
			MESSAGE_REACTION_ADD_USERS({ messageId, emoji, reactionType, users }) {
				const list = lists.get(reactionKey(messageId, emoji!, reactionType))
				if (!list) return

				let last: string | undefined
				for (const { id } of users!)
					if (!last || compareSnowflakes(id, last) > 0) last = id

				const page = list.pages.find(page => page.size === undefined)
				if (page) {
					page.size = users!.length
					page.last = last
					if (page.size < page.limit) list.complete = true
				}

				if (last && (!list.cursor || compareSnowflakes(last, list.cursor) > 0))
					list.cursor = last
			},
		}

		for (const [type, handler] of Object.entries(handlers))
			Dispatcher.subscribe(type, handler as never)

		cleanup(
			() => {
				for (const [type, handler] of Object.entries(handlers))
					Dispatcher.unsubscribe(type, handler as never)
			},
			instead(MessageReactionsStore, 'getReactions', function (args, original) {
				const users = Reflect.apply(original, this, args)
				if (!users || !ReactionActionCreators) return users

				const [channelId, messageId, emoji, limit, type] = args
				const list = listFor({ channelId, messageId, emoji, type })

				// Fetched before the plugin started, or reset by CONNECTION_OPEN
				if (list.users !== users) {
					list.users = users
					for (const id of users.keys())
						if (!list.cursor || compareSnowflakes(id, list.cursor) > 0)
							list.cursor = id
				}

				list.limit = Math.max(list.limit, limit ?? PageSize)
				sync(list)

				return users
			}),
			// modules/reactions/ReactionActionCreators.tsx
			getModules(
				withProps<ReactionActionCreators>('getReactors', 'addReaction'),
				exports => {
					ReactionActionCreators = exports

					cleanup(
						instead(exports, 'getReactors', function (args, original) {
							let [options] = args
							const list = listFor(options)

							// The sheet pages after its last row, which can be someone added live
							if (
								options.after &&
								list.cursor &&
								compareSnowflakes(options.after, list.cursor) > 0
							)
								options = { ...options, after: list.cursor }

							const page: Page = { limit: options.limit }
							list.pages.push(page)

							return (
								Reflect.apply(original, this, [options]) as Promise<unknown>
							)
								.then(
									() => page,
									() => {
										list.stale = true
									},
								)
								.finally(() => {
									list.pages.splice(list.pages.indexOf(page), 1)
								})
						}),
					)
				},
				{ max: 1 },
			),
		)

		function clear(list: ReactorList) {
			list.users?.clear()
			list.cursor = undefined
			list.complete = true
			list.stale = false
		}
	},
})

function emojiKey(emoji: Emoji) {
	return emoji.id ?? emoji.name
}

function reactionKey(messageId: string, emoji: Emoji, type = 0) {
	return `${messageId}:${emojiKey(emoji)}:${type}`
}

/** Snowflakes grow over time, so a newer one is longer or sorts after at the same length */
function compareSnowflakes(a: string, b: string) {
	return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}
