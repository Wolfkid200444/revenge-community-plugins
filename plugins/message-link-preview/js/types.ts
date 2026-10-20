export interface MessageRecord {
	id: string
	type: number
	channel_id: string
	webhookId?: string | null
	author: { id: string; primaryGuild?: PrimaryGuild | null }
	mentions: (string | { id: string })[]
	addReaction(
		emoji: unknown,
		me: boolean,
		options: { colors?: unknown; reactionType?: number; isDMChannel: boolean },
	): MessageRecord
	removeReaction(
		emoji: unknown,
		me: boolean,
		reactionType?: number,
	): MessageRecord
	removeReactionsForEmoji(emoji: unknown): MessageRecord
	set(key: string, value: unknown): MessageRecord
}

export interface RawMessage {
	id: string
}

export interface PrimaryGuild {
	identityGuildId?: string | null
	identityEnabled?: boolean
	tag?: string | null
	badge?: string | null
}

export interface Channel {
	id: string
	name: string
	guild_id?: string | null
	type: number
}

export interface MessageRow {
	type?: number
	message?: RowMessage
	swipeActions?: unknown
}

export interface RowMessage {
	id: string
	channelId: string
	clanTagGuildId?: string
	clanTag?: string
	clanBadgeUrl?: string
	content?: unknown[]
	embeds?: object[]
	textColor?: number
	timestampColor?: number
	constrainedWidth?: number
}

export interface ContentNode {
	type: string
	messageId?: string
	originalLink?: string
	iconType?: string
	inContent?: ContentNode[] | null
	content?: ContentNode[] | string
}

export interface Link {
	guildId: string
	channelId: string
	messageId: string
	url: string
}
