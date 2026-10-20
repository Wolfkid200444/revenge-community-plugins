import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type {
	Channel,
	ContentNode,
	MessageRecord,
	PrimaryGuild,
	RawMessage,
} from './types'

interface HTTP {
	get(options: {
		url: string
		query?: Record<string, unknown>
		oldFormErrors?: boolean
	}): Promise<{ body: RawMessage[] }>
}

interface Endpoints {
	MESSAGES(channelId: string): string
}

interface MessageRecordUtils {
	createMessageRecord(message: RawMessage): MessageRecord
	updateMessageRecord(record: MessageRecord, update: object): MessageRecord
}

interface MessageTypeConstants {
	MessageTypes: { AUTO_MODERATION_ACTION: number }
	MessageTypesSets: {
		USER_MESSAGE: Set<number>
		AUTOMOD_INCIDENT_ACTIONS: Set<number>
	}
}

interface MarkupParsers {
	parseEmbedTitleMarkup(raw: string, channelId: string): ContentNode[]
}

interface GuildTagUtils {
	shouldDisplayGuildTag(
		userId: string,
		guildId: string | null | undefined,
		primaryGuild?: PrimaryGuild | null,
	): boolean
	getUserPrimaryGuild(primaryGuild: PrimaryGuild): {
		guildId: string | null
		tag: string | null
		badge: string | null
	}
	getGuildTagBadgeUrl(
		guildId: string,
		badge: string | null,
		size: number,
	): string | undefined
}

const store =
	<T>(name: string) =>
	() =>
		(Stores as Record<string, unknown>)[name] as DiscordModules.Flux.Store<T>

export const MessageStore = store<{
	getMessage(channelId: string, messageId: string): MessageRecord | undefined
}>('MessageStore')

export const ChannelStore = store<{
	getChannel(channelId: string): Channel | undefined
}>('ChannelStore')

export const AuthenticationStore = store<{ getId(): string }>(
	'AuthenticationStore',
)

export const AccessibilityStore = store<{ roleStyle?: string }>(
	'AccessibilityStore',
)

export const GuildMemberStore = store<{
	getMember(guildId: string, userId: string): object | null | undefined
}>('GuildMemberStore')

export const UserStore = store<{ getUser(userId: string): object | undefined }>(
	'UserStore',
)

export const GuildMemberRequesterStore = store<{
	requestMember(guildId: string, userId: string): void
}>('GuildMemberRequesterStore')

export const Modules: {
	HTTP?: HTTP
	Endpoints?: Endpoints
	MessageRecordUtils?: MessageRecordUtils
	MessageTypeConstants?: MessageTypeConstants
	MarkupParsers?: MarkupParsers
	GuildTagUtils?: GuildTagUtils
} = {}

export function findModules() {
	return [
		// utils/HTTPUtils.tsx
		getModules(withProps<{ HTTP: HTTP }>('HTTP'), exports => {
			Modules.HTTP = exports.HTTP
		}),
		// Constants.tsx
		getModules(withProps<{ Endpoints: Endpoints }>('Endpoints'), exports => {
			Modules.Endpoints = exports.Endpoints
		}),
		// discord_common/js/shared/shared-constants/MessageTypes.tsx
		getModules(withProps<MessageTypeConstants>('MessageTypesSets'), exports => {
			Modules.MessageTypeConstants = exports
		}),
		// modules/messages/native/renderer/MarkupParsers.tsx
		getModules(withProps<MarkupParsers>('parseEmbedTitleMarkup'), exports => {
			Modules.MarkupParsers = exports
		}),
		// modules/guild_tag/GuildTagUtils.tsx
		getModules(withProps<GuildTagUtils>('shouldDisplayGuildTag'), exports => {
			Modules.GuildTagUtils = exports
		}),
		// modules/messages/MessageRecordUtils.tsx
		getModules(
			withProps<MessageRecordUtils>('createMessageRecord'),
			exports => {
				Modules.MessageRecordUtils = exports
			},
		),
	]
}

export function modulesFound() {
	const {
		HTTP,
		Endpoints,
		MessageRecordUtils,
		MessageTypeConstants,
		MarkupParsers,
		GuildTagUtils,
	} = Modules

	return !!(
		HTTP &&
		Endpoints &&
		MessageRecordUtils &&
		MessageTypeConstants &&
		MarkupParsers &&
		GuildTagUtils
	)
}
