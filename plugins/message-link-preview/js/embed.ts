import { Modules } from './discord'
import type { Link, RowMessage } from './types'

// Must match EMBED_ID_PREFIX in native
const EmbedIdPrefix = 'palmdevs.message-link-preview:'

export function createEmbed(link: Link, message: RowMessage, status: string) {
	const channelLink = `https://discord.com/channels/${link.guildId}/${link.channelId}`

	return {
		id: EmbedIdPrefix + link.messageId,
		type: 'rich',
		spoiler: '',
		obscure: '',
		obscureAwaitingScan: '',
		verifyAge: false,
		obscureHideControls: false,
		obscureIsOpaque: false,
		// Titles render icons at a fixed size, descriptions scale them with the text
		rawDescription: channelLink,
		description: channelHeader(link, channelLink, message.channelId),
		footer: status ? { content: status } : undefined,
		fields: [],
		headerTextColor: message.textColor,
		bodyTextColor: message.textColor,
	}
}

function channelHeader(link: Link, channelLink: string, chatChannelId: string) {
	// Nodes are cached by Discord, so they're copied instead of changed
	return Modules.MarkupParsers!.parseEmbedTitleMarkup(
		channelLink,
		chatChannelId,
	).map(node => {
		if (node.type !== 'channelMention') return node

		const mention = {
			...node,
			messageId: link.messageId,
			originalLink: link.url,
		}

		// DM links end with a message icon
		const last = Array.isArray(node.content) ? node.content[0] : undefined
		if (
			node.inContent &&
			last?.type === 'channel' &&
			last.iconType === 'message'
		) {
			mention.inContent = null
			mention.content = node.inContent
		}

		return mention
	})
}
