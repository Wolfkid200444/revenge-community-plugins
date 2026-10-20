import { callNativeMethodSync } from '@revenge-mod/modules/native'
import type { Highlight } from './highlighter'

/** Synchronous so the highlights are stored before the rows reach native. */
export function putHighlights(blocks: Highlight[]) {
	callNativeMethodSync('palmdevs.shiki.put', [JSON.stringify({ blocks })])
}

/** Read by native on every tap, so it applies to blocks already rendered. */
export function setOpenOnTap(enabled: boolean) {
	callNativeMethodSync('palmdevs.shiki.setOpenOnTap', [enabled])
}

export function clearHighlights() {
	callNativeMethodSync('palmdevs.shiki.clear', [])
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'palmdevs.shiki.put': [[json: string], null]
		'palmdevs.shiki.setOpenOnTap': [[enabled: boolean], null]
		'palmdevs.shiki.clear': [[], null]
	}
}
