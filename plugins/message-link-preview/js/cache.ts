import { MessageStore } from './discord'
import type { MessageRecord } from './types'

const MaxRecords = 200

// Message ID to channel ID
const linked = new Map<string, string>()
// Messages MessageStore doesn't have, oldest first
const records = new Map<string, MessageRecord>()
const failures = new Map<string, string>()

export function addLinked(messageId: string, channelId: string) {
	linked.set(messageId, channelId)
}

export function isLinked(messageId: string | undefined) {
	return !!messageId && linked.has(messageId)
}

export function getRecord(messageId: string) {
	const channelId = linked.get(messageId)

	return (
		(channelId && MessageStore().getMessage(channelId, messageId)) ||
		records.get(messageId)
	)
}

export function getFetchedRecord(messageId: string) {
	return records.get(messageId)
}

export function storeRecord(record: MessageRecord) {
	records.delete(record.id)
	records.set(record.id, record)

	if (records.size > MaxRecords) records.delete(records.keys().next().value!)
}

export function deleteRecord(messageId: string) {
	records.delete(messageId)
}

export function getFailure(messageId: string) {
	return failures.get(messageId)
}

export function setFailure(messageId: string, reason: string) {
	failures.set(messageId, reason)
}

export function resetCache() {
	linked.clear()
	records.clear()
	failures.clear()
}
