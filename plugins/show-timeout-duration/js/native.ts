import { callNativeMethodSync } from '@revenge-mod/modules/native'

/** Message ID to when its author's timeout ends (ms since epoch). */
export type TimeoutEnds = Record<string, number>

/** Synchronous so the ends are stored before the rows that show them reach native. */
export function putTimeoutEnds(ends: TimeoutEnds) {
	callNativeMethodSync('palmdevs.timeout.put', [JSON.stringify(ends)])
}

export function clearTimeoutEnds() {
	callNativeMethodSync('palmdevs.timeout.clear', [])
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'palmdevs.timeout.put': [[json: string], null]
		'palmdevs.timeout.clear': [[], null]
	}
}
