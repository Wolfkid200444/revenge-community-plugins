import { callNativeMethodSync } from '@revenge-mod/modules/native'

/** Reaction key to avatar URLs, see `reactionKey` */
export type Avatars = Record<string, string[]>

/** Synchronous so the avatars are stored before the rows that show them reach native. */
export function putAvatars(avatars: Avatars) {
	callNativeMethodSync('palmdevs.who-reacted.put', [JSON.stringify(avatars)])
}

/** Keys of the reactions whose pills are on screen */
export function getShownReactionKeys(): string[] {
	return JSON.parse(callNativeMethodSync('palmdevs.who-reacted.shown', []))
}

export function clearAvatars() {
	callNativeMethodSync('palmdevs.who-reacted.clear', [])
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'palmdevs.who-reacted.put': [[json: string], null]
		'palmdevs.who-reacted.shown': [[], string]
		'palmdevs.who-reacted.clear': [[], null]
	}
}
