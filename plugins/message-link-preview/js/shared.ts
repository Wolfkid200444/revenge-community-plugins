export interface Settings {
	maxPreviews: number
	maxHeight: number
	interactive: boolean
}

export const MaxPreviewsLimit = 20

export const MaxHeightRange = { min: 128, max: 1536, step: 32 } as const

export const DefaultSettings: Settings = {
	maxPreviews: 5,
	maxHeight: 256,
	interactive: true,
}
