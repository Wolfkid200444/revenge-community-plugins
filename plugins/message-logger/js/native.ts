import { callNativeMethodSync } from '@revenge-mod/modules/native'

// Attachment IDs native greys out
const dimmed = new Set<string>()

// Synchronous, so they're known before the rows showing them reach native
export function setDimmedAttachments(ids: Iterable<string>, dim: boolean) {
	const changed = [...ids].filter(id => dimmed.has(id) !== dim)
	if (!changed.length) return

	for (const id of changed) dim ? dimmed.add(id) : dimmed.delete(id)
	callNativeMethodSync('palmdevs.message-logger.setDimmed', [
		JSON.stringify(changed),
		dim,
	])
}

export function clearDimmedAttachments() {
	dimmed.clear()
	callNativeMethodSync('palmdevs.message-logger.clear', [])
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'palmdevs.message-logger.setDimmed': [[json: string, dim: boolean], null]
		'palmdevs.message-logger.clear': [[], null]
	}
}
