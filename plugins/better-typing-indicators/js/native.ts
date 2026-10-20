import { callNativeMethodSync } from '@revenge-mod/modules/native'

/** Adds space after the last message, below the typing indicator view `tag`. */
export function setChatListExtraSpacing(tag: number, extraDp: number) {
	try {
		callNativeMethodSync('palmdevs.typing.setExtraSpacing', [tag, extraDp])
	} catch {
		// Ignore errors, since this is a best-effort feature.
	}
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'palmdevs.typing.setExtraSpacing': [[tag: number, extraDp: number], null]
	}
}
