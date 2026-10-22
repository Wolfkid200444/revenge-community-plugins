import { Dispatcher } from '@revenge-mod/discord/common/flux'
import { onFluxEventDispatched, Stores } from '@revenge-mod/discord/flux'
import { setDimmedAttachments } from './native'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type { Settings } from './shared'

export interface Attachment {
	id: string
}

export interface MessageRecord {
	id: string
	channel_id: string
	content: string
	state: string
	flags: number
	author: { id: string; bot?: boolean }
	attachments: Attachment[]
}

export interface Log {
	channelId: string
	deleted: boolean
	/** Whether deleted text and attachments are styled */
	highlighted: boolean
	/** Previous versions, oldest first */
	edits: MessageRecord[]
	removedAttachments: Set<string>
}

interface DeletePayload {
	id: string
	channelId: string
	guildId?: string
}

interface BulkDeletePayload {
	ids: string[]
	channelId: string
	guildId?: string
}

interface UpdatePayload {
	message?: {
		id: string
		channel_id: string
		content?: string
		attachments?: Attachment[]
	}
}

const EphemeralFlag = 1 << 6

const MessageStore = () =>
	Stores.MessageStore as DiscordModules.Flux.Store<{
		getMessage(channelId: string, messageId: string): MessageRecord | undefined
	}>

const AuthenticationStore = () =>
	Stores.AuthenticationStore as DiscordModules.Flux.Store<{ getId(): string }>

const logs = new Map<string, Log>()

// Messages changed without a change Discord would notice in the record
const changed = new Set<string>()

// Messages whose events the logger lets through, for removing logs
const bypassed = new Set<string>()

export const getLog = (id: string) => logs.get(id)

export const takeChanged = (id: string) => changed.delete(id)

function logOf({ id, channel_id }: MessageRecord) {
	let log = logs.get(id)
	if (!log) {
		log = {
			channelId: channel_id,
			deleted: false,
			highlighted: true,
			edits: [],
			removedAttachments: new Set(),
		}
		logs.set(id, log)
	}

	return log
}

function shouldLog(record: MessageRecord, settings: Settings) {
	if (settings.ignoreBots && record.author.bot) return false
	return (
		!settings.ignoreSelf || record.author.id !== AuthenticationStore().getId()
	)
}

function keepDeleted(channelId: string, id: string, settings: Settings) {
	const record = MessageStore().getMessage(channelId, id)
	if (!record || bypassed.has(id)) return false
	// Self deletes are dispatched again once the gateway confirms them
	if (logs.get(id)?.deleted) return true
	// Unsent and ephemeral messages are dismissed, not deleted
	if (record.state !== 'SENT' || record.flags & EphemeralFlag) return false
	if (!shouldLog(record, settings)) return false

	logOf(record).deleted = true
	changed.add(id)
	return true
}

// Regenerates the row, which only reaches native if the message is marked changed
const rerender = (channelId: string, id: string, guildId?: string) => ({
	type: 'MESSAGE_UPDATE',
	guildId,
	message: { id, channel_id: channelId },
})

// Removed attachments stay in the record, so Discord can still open them
function keepRemovedAttachments(
	record: MessageRecord,
	update: NonNullable<UpdatePayload['message']>,
) {
	const ids = new Set(update.attachments!.map(attachment => attachment.id))
	const removed = record.attachments.filter(({ id }) => !ids.has(id))
	if (!removed.length) return

	const log = logOf(record)
	for (const { id } of removed) log.removedAttachments.add(id)
	changed.add(record.id)
	update.attachments = [...update.attachments!, ...removed]
}

export function toggleHighlight(record: MessageRecord, guildId?: string) {
	const log = logs.get(record.id)
	if (!log) return

	log.highlighted = !log.highlighted
	changed.add(record.id)
	Dispatcher.dispatch(rerender(record.channel_id, record.id, guildId))
}

/** Forgets the message's log, really deleting it if it was deleted. */
export function removeLog(record: MessageRecord, guildId?: string) {
	const log = logs.get(record.id)
	if (!log) return

	logs.delete(record.id)
	changed.add(record.id)
	bypassed.add(record.id)
	setDimmedAttachments(
		record.attachments.map(({ id }) => id),
		false,
	)

	try {
		if (log.deleted)
			Dispatcher.dispatch({
				type: 'MESSAGE_DELETE',
				id: record.id,
				channelId: record.channel_id,
				guildId,
			})
		else
			Dispatcher.dispatch({
				type: 'MESSAGE_UPDATE',
				guildId,
				message: {
					id: record.id,
					channel_id: record.channel_id,
					attachments: record.attachments.filter(
						({ id }) => !log.removedAttachments.has(id),
					),
				},
			})
	} finally {
		bypassed.delete(record.id)
	}
}

export function hasChannelLogs(channelId: string) {
	for (const log of logs.values()) if (log.channelId === channelId) return true
	return false
}

export function clearChannelLogs(channelId: string, guildId?: string) {
	for (const [id, log] of logs) {
		if (log.channelId !== channelId) continue

		const record = MessageStore().getMessage(channelId, id)
		if (record) removeLog(record, guildId)
		else logs.delete(id)
	}
}

export function interceptMessages(settings: () => Settings) {
	return [
		onFluxEventDispatched<DeletePayload>('MESSAGE_DELETE', payload => {
			const { id, channelId, guildId } = payload
			if (!settings().logDeletes || !keepDeleted(channelId, id, settings()))
				return payload

			return rerender(channelId, id, guildId) as unknown as typeof payload
		}),
		onFluxEventDispatched<BulkDeletePayload>('MESSAGE_DELETE_BULK', payload => {
			const { ids, channelId, guildId } = payload
			if (!settings().logDeletes) return payload

			const kept = new Set(
				ids.filter(id => keepDeleted(channelId, id, settings())),
			)
			if (!kept.size) return payload

			// Can't dispatch in the middle of a dispatch
			Promise.resolve().then(() => {
				for (const id of kept)
					Dispatcher.dispatch(rerender(channelId, id, guildId))
			})

			const rest = ids.filter(id => !kept.has(id))
			if (rest.length) return { ...payload, ids: rest }
		}),
		onFluxEventDispatched<UpdatePayload>('MESSAGE_UPDATE', payload => {
			const update = payload.message
			const record =
				update?.id && MessageStore().getMessage(update.channel_id, update.id)
			if (
				!update ||
				!record ||
				bypassed.has(record.id) ||
				!shouldLog(record, settings())
			)
				return payload

			const { logEdits, logDeletes } = settings()

			if (
				logEdits &&
				record.content &&
				update.content !== undefined &&
				update.content !== record.content
			)
				logOf(record).edits.push(record)

			if (logDeletes && update.attachments)
				keepRemovedAttachments(record, update)

			return payload
		}),
	]
}

export function resetLogs() {
	logs.clear()
	changed.clear()
}
