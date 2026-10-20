import { callNativeMethodSync } from '@revenge-mod/modules/native'

// Must match Kind in native, normal messages have none
export type PreviewView = 'system' | 'automod'

export interface Preview {
	row?: string
	view?: PreviewView
	error?: string
}

export type Previews = Record<string, Preview>

// Synchronous, so previews are there before the rows showing them
export function putPreviews(previews: Previews) {
	callNativeMethodSync('palmdevs.message-link-preview.put', [
		JSON.stringify(previews),
	])
}

export function clearPreviews() {
	callNativeMethodSync('palmdevs.message-link-preview.clear', [])
}

export function setMaxHeight(dp: number) {
	callNativeMethodSync('palmdevs.message-link-preview.setMaxHeight', [dp])
}

export function setInteractive(enabled: boolean) {
	callNativeMethodSync('palmdevs.message-link-preview.setInteractive', [
		enabled,
	])
}

declare module '@revenge-mod/modules/native' {
	interface NativeMethods {
		'palmdevs.message-link-preview.put': [[json: string], null]
		'palmdevs.message-link-preview.clear': [[], null]
		'palmdevs.message-link-preview.setMaxHeight': [[dp: number], null]
		'palmdevs.message-link-preview.setInteractive': [[enabled: boolean], null]
	}
}
