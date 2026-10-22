export interface Settings {
	logDeletes: boolean
	logEdits: boolean
	ignoreSelf: boolean
	ignoreBots: boolean
}

export const DefaultSettings: Settings = {
	logDeletes: true,
	logEdits: true,
	ignoreSelf: false,
	ignoreBots: false,
}
