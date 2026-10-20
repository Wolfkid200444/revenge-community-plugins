import { AssetsRegistry } from '@revenge-mod/assets'
import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withName, withProps } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import { clearAvatars, getShownReactionKeys, putAvatars } from './native'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type { Avatars } from './native'
import type { Settings } from './shared'

interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

interface MessageRow {
	type?: number
	message?: {
		id: string
		channelId: string
		reactions?: RowReaction[]
	}
}

interface RowReaction {
	count: number
	burst_count: number
	emoji: ReactionEmoji
}

interface ReactionEmoji {
	id: string | null
	name: string
}

interface ApiUser {
	id: string
	avatar: string | null
}

interface HTTP {
	get(options: {
		url: string
		query?: Record<string, unknown>
		oldFormErrors?: boolean
		/** Rejects with `code: 'ABORTED'` when aborted */
		signal?: AbortSignal
	}): Promise<{ body: ApiUser[] }>
}

interface AvatarUtils {
	getUserAvatarURL(user: ApiUser, canAnimate: boolean, size: number): unknown
}

interface Constants {
	Endpoints: {
		REACTIONS(channelId: string, messageId: string, emoji: string): string
	}
}

/** Reactions of one type (normal or burst) with one emoji on one message */
interface Reaction {
	key: string
	channelId: string
	messageId: string
	emoji: ReactionEmoji
	type: ReactionType
	count: number
}

interface Reactors {
	/** Count of the reaction when these were fetched */
	count: number
	avatars: string[]
}

enum ReactionType {
	Normal = 0,
	Burst = 1,
}

const MessageRowType = 1
/** Most avatars a reaction shows, must match `MAX_AVATARS` in native */
const MaxAvatars = 5
// in dp
const AvatarSize = 18

const RequestInterval = 250
/** How often pills on screen are checked while none of them wait to be fetched */
const IdleInterval = 500
/** Reactions waiting to be fetched. Oldest messages are dropped. */
const MaxPending = 1000
const MaxCached = 2000

/** Must match `RESOURCE_PREFIX` in native */
const ResourcePrefix = 'res:'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, plugin }) {
		const MessageReactionsStore =
			Stores.MessageReactionsStore as DiscordModules.Flux.Store<{
				getReactions(
					channelId: string,
					messageId: string,
					emoji: ReactionEmoji,
					limit: number,
					type: ReactionType,
				): Map<string, ApiUser> | undefined
			}>

		let HTTP: HTTP | undefined
		let AvatarUtils: AvatarUtils | undefined
		let Endpoints: Constants['Endpoints'] | undefined

		// Least recently fetched first
		const reactors = new Map<string, Reactors>()
		// Fetched once their pills are on screen
		const pending = new Map<string, Reaction>()
		let inFlight: AbortController | undefined
		let running = false
		let stopped = false

		/**
		 * An avatar's URL, or for default avatars, the bundled asset's Android resource name
		 * (`default_avatar_N_small` and such) after {@link ResourcePrefix}.
		 */
		function avatarUrl(user: ApiUser) {
			const source = AvatarUtils!.getUserAvatarURL(user, false, AvatarSize)
			if (typeof source === 'string') return source
			if (typeof source === 'number')
				return (
					ResourcePrefix +
					androidResourceName(AssetsRegistry.getAssetByID(source))
				)

			throw new Error(
				`Unknown avatar source for ${user.id}: ${JSON.stringify(source)}`,
			)
		}

		function needsFetch({ key, count }: Reaction) {
			const known = reactors.get(key)
			if (!known) return true
			if (known.count === count) return false

			// Someone removed theirs, or there's room for whoever added one
			if (count < known.count || known.avatars.length < MaxAvatars) return true

			known.count = count
			return false
		}

		function enqueue(reaction: Reaction) {
			// Keeps the latest count
			pending.set(reaction.key, reaction)
			if (pending.size > MaxPending)
				pending.delete(newest(pending.values(), compareSnowflakes)!.key)

			if (!running) void processQueue()
		}

		/** A reaction whose pill is on screen, the newest message's first. */
		function nextReaction() {
			return newest(
				getShownReactionKeys()
					.map(key => pending.get(key))
					.filter(reaction => reaction !== undefined),
			)
		}

		async function processQueue() {
			running = true

			while (pending.size && !stopped) {
				const reaction = nextReaction()
				if (!reaction) {
					// Native can't tell when pills are scrolled into view, so it's asked again
					await sleep(IdleInterval)
					continue
				}

				pending.delete(reaction.key)
				// It may have been fetched while waiting
				if (!needsFetch(reaction)) continue

				// Cancelled once its pill is off screen
				const controller = (inFlight = new AbortController())
				const watcher = setInterval(() => {
					if (!getShownReactionKeys().includes(reaction.key)) controller.abort()
				}, IdleInterval)

				try {
					await fetchReactors(reaction, controller.signal)
				} catch (e) {
					// Rate limits are waited out by Discord's HTTPUtils
					if ((e as { code?: string })?.code === 'ABORTED') {
						// Waits to be on screen again, unless it was queued again meanwhile
						if (!stopped && !pending.has(reaction.key))
							pending.set(reaction.key, reaction)
						continue
					}

					// Missing permissions or deleted, not fetched again until the count changes
					store(reaction.key, { count: reaction.count, avatars: [] })
				} finally {
					clearInterval(watcher)
					inFlight = undefined
				}

				await sleep(RequestInterval)
			}

			running = false
		}

		async function fetchReactors(reaction: Reaction, signal: AbortSignal) {
			const { channelId, messageId, emoji, type, key, count } = reaction
			const { body } = await HTTP!.get({
				url: Endpoints!.REACTIONS(
					channelId,
					messageId,
					emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name,
				),
				query: { limit: MaxAvatars, type },
				oldFormErrors: true,
				signal,
			})

			if (stopped) return

			const avatars = body.slice(0, MaxAvatars).map(avatarUrl)
			store(key, { count, avatars })
			putAvatars({ [key]: avatars })
		}

		/** Reactors Discord already fetched, like when the reactions sheet was opened. */
		function useDiscordReactors(reaction: Reaction) {
			const known = reactors.get(reaction.key)
			if (known?.count === reaction.count) return

			const users = MessageReactionsStore.getReactions(
				reaction.channelId,
				reaction.messageId,
				reaction.emoji,
				MaxAvatars,
				reaction.type,
			)
			if (!users || users.size < Math.min(reaction.count, MaxAvatars)) return

			const avatars = [...users.values()].slice(0, MaxAvatars).map(avatarUrl)
			store(reaction.key, { count: reaction.count, avatars })
		}

		function store(key: string, value: Reactors) {
			reactors.delete(key)
			reactors.set(key, value)
			if (reactors.size > MaxCached)
				reactors.delete(reactors.keys().next().value!)
		}

		function handleRow(message: NonNullable<MessageRow['message']>) {
			const avatars: Avatars = {}

			for (const reaction of message.reactions!) {
				// Discord shows a reaction with both types as two pills
				const counts = [
					[ReactionType.Normal, reaction.count],
					[ReactionType.Burst, reaction.burst_count],
				] as const

				for (const [type, count] of counts) {
					if (!count) continue

					const target: Reaction = {
						key: reactionKey(message.id, reaction.emoji, type),
						channelId: message.channelId,
						messageId: message.id,
						emoji: { id: reaction.emoji.id, name: reaction.emoji.name },
						type,
						count,
					}

					useDiscordReactors(target)
					if (needsFetch(target)) enqueue(target)

					const known = reactors.get(target.key)
					if (known) avatars[target.key] = known.avatars
				}
			}

			if (Object.keys(avatars).length) putAvatars(avatars)
		}

		cleanup(
			() => {
				stopped = true
				inFlight?.abort()
				pending.clear()
				clearAvatars()
			},
			// utils/HTTPUtils.tsx
			getModules(withProps<{ HTTP: HTTP }>('HTTP'), exports => {
				HTTP = exports.HTTP
			}),
			// utils/AvatarUtils.tsx
			getModules(withProps<AvatarUtils>('getUserAvatarURL'), exports => {
				AvatarUtils = exports
			}),
			// Constants.tsx
			getModules(withProps<Constants>('Endpoints'), exports => {
				Endpoints = exports.Endpoints
			}),
			// modules/messages/native/renderer/RowGenerator.tsx
			getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
				cleanup(
					after(prototype, 'generate', row => {
						const maxReactions =
							(jsonStorage.cache as Settings | undefined)?.maxReactions ??
							DefaultSettings.maxReactions

						if (
							row?.type !== MessageRowType ||
							!row.message?.reactions?.length ||
							row.message.reactions.length > maxReactions ||
							!HTTP ||
							!AvatarUtils ||
							!Endpoints
						)
							return row

						try {
							handleRow(row.message)
						} catch (e) {
							plugin.reportError(`Failed to add reactors: ${getErrorStack(e)}`)
						}

						return row
					}),
				)
			}),
		)
	},
	SettingsComponent,
})

/** Must match `reactionKey` in native */
function reactionKey(
	messageId: string,
	emoji: ReactionEmoji,
	type: ReactionType,
) {
	return `${messageId}:${emoji.id ?? emoji.name}:${type}`
}

/** See `getAndroidResourceIdentifier` in `@react-native/assets-registry/path-support`. */
function androidResourceName({
	httpServerLocation = '',
	name,
}: {
	httpServerLocation?: string
	name: string
}) {
	return `${httpServerLocation.replace(/^\//, '')}/${name}`
		.toLowerCase()
		.replace(/\//g, '_')
		.replace(/[^a-z0-9_]/g, '')
		.replace(/^(?:assets|assetsunstable_path)_/, '')
}

/** The reaction of the newest message, or the oldest with `compare` reversed. */
function newest(
	reactions: Iterable<Reaction>,
	compare = (a: string, b: string) => compareSnowflakes(b, a),
) {
	let result: Reaction | undefined
	for (const reaction of reactions)
		if (!result || compare(reaction.messageId, result.messageId) < 0)
			result = reaction
	return result
}

/** Snowflakes grow over time, so a newer one is longer or sorts after at the same length */
function compareSnowflakes(a: string, b: string) {
	return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

function sleep(ms: number) {
	return new Promise<void>(resolve => setTimeout(resolve, ms))
}
