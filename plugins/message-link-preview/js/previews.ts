import { getFailure, getRecord, setFailure } from './cache'
import { putPreviews } from './native'
import { createPreview } from './rows'
import type { Previews } from './native'

const DeletedText = 'This message was deleted.'

const changed = new Set<string>()
let timeout: ReturnType<typeof setTimeout> | undefined

// Batched until the current dispatch is done, so the stores are up to date
export function refresh(messageId: string) {
	changed.add(messageId)
	timeout ??= setTimeout(sendChanged)
}

function sendChanged() {
	timeout = undefined

	const previews: Previews = {}

	for (const id of changed) {
		const record = getRecord(id)

		if (record) previews[id] = createPreview(record)
		else if (!getFailure(id)) {
			setFailure(id, DeletedText)
			previews[id] = { error: DeletedText }
		}
	}

	changed.clear()
	if (Object.keys(previews).length) putPreviews(previews)
}

export function fail(messageId: string, reason: string) {
	setFailure(messageId, reason)
	putPreviews({ [messageId]: { error: reason } })
}

export function resetPreviews() {
	clearTimeout(timeout)
	timeout = undefined
	changed.clear()
}
