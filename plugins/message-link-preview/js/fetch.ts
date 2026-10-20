import { getFailure, getRecord, storeRecord } from './cache'
import { Modules } from './discord'
import { fail, refresh } from './previews'
import { compareSnowflakes, sleep } from './utils'
import type { Link } from './types'

const RequestInterval = 250

const NotFoundText = "This message was deleted or can't be found."
const FailedText = "Couldn't load this message."

const pending = new Map<string, Link>()
let running = false
let stopped = false

export function enqueue(link: Link) {
	pending.set(link.messageId, link)
	if (!running) void processQueue()
}

async function processQueue() {
	running = true

	while (pending.size && !stopped) {
		const newest = [...pending.values()].reduce((a, b) =>
			compareSnowflakes(a.messageId, b.messageId) > 0 ? a : b,
		)

		pending.delete(newest.messageId)
		if (getRecord(newest.messageId) || getFailure(newest.messageId)) continue

		try {
			await fetchMessage(newest)
		} catch {
			// HTTPUtils waits out rate limits itself
			if (!stopped) fail(newest.messageId, FailedText)
		}

		await sleep(RequestInterval)
	}

	running = false
}

async function fetchMessage({ channelId, messageId }: Link) {
	const { HTTP, Endpoints, MessageRecordUtils } = Modules
	const { body } = await HTTP!.get({
		url: Endpoints!.MESSAGES(channelId),
		query: { limit: 1, around: messageId },
		oldFormErrors: true,
	})

	if (stopped) return

	const message = body.find(message => message.id === messageId)
	if (!message) return fail(messageId, NotFoundText)

	storeRecord(MessageRecordUtils!.createMessageRecord(message))
	refresh(messageId)
}

export function startFetching() {
	stopped = false
}

export function stopFetching() {
	stopped = true
	pending.clear()
}
