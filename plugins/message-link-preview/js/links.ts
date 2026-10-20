import type { Link } from './types'

// Message links are parsed into channel mentions with a message ID
export function findLinks(
	nodes: unknown,
	messageId: string,
	max: number,
	links = new Map<string, Link>(),
) {
	if (!Array.isArray(nodes)) return links

	for (const node of nodes) {
		if (links.size >= max) break
		if (!node || typeof node !== 'object') continue

		if (node.type === 'channelMention') {
			if (node.messageId && node.channelId && node.messageId !== messageId)
				links.set(node.messageId, {
					guildId: node.guildId,
					channelId: node.channelId,
					messageId: node.messageId,
					url: node.originalLink,
				})

			continue
		}

		for (const value of Object.values(node))
			findLinks(value, messageId, max, links)
	}

	return links
}
