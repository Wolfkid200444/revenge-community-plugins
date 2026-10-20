import { GuildMemberRequesterStore, GuildMemberStore } from './discord'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type { MessageRecord } from './types'

// `guildId:userId` to the messages waiting for the member
const awaited = new Map<string, Set<string>>()

// Discord only has members of authors of messages it loaded itself
export function requestMembers(record: MessageRecord, guildId: string) {
	const userIds = record.mentions.map(user =>
		typeof user === 'string' ? user : user.id,
	)

	if (!record.webhookId) userIds.push(record.author.id)

	for (const userId of userIds) {
		if (GuildMemberStore().getMember(guildId, userId)) continue

		const key = `${guildId}:${userId}`
		let messageIds = awaited.get(key)
		if (!messageIds) awaited.set(key, (messageIds = new Set()))
		messageIds.add(record.id)

		GuildMemberRequesterStore().requestMember(guildId, userId)
	}
}

export function takeArrived({ chunks }: DiscordModules.Flux.DispatcherPayload) {
	const messageIds = new Set<string>()

	for (const { guildId, members, notFound } of chunks ?? []) {
		for (const member of members ?? []) {
			const key = `${guildId}:${member.user.id}`
			for (const messageId of awaited.get(key) ?? []) messageIds.add(messageId)
			awaited.delete(key)
		}

		for (const userId of notFound ?? []) awaited.delete(`${guildId}:${userId}`)
	}

	return messageIds
}

export function resetMembers() {
	awaited.clear()
}
