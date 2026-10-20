export type ImageSource = string | number | null | undefined

export interface User {
	getAvatarURL(guildId: string | null | undefined, size: number): ImageSource
}

export interface Channel {
	id: string
	type: number
}

export interface RoleIconUtils {
	getRoleIcon(options: {
		guildId: string
		roleId: string
		size: number
	}): { source?: string; unicodeEmoji?: string } | undefined
}

export interface EmojiUtils {
	getURL(surrogate: string): string | undefined
	applyPlatformToThemedEmojiColorPalette: unknown
}

export interface ChannelIconUtils {
	getChannelIconURL(channel: Channel, size?: number): ImageSource
	getChannelIconSource(channel: Channel): unknown
}
