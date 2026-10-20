export interface Settings {
	/** Messages with more different reactions are ignored */
	maxReactions: number
}

/** Discord allows up to 20 different reactions on a message */
export const MaxReactionsLimit = 20

export const DefaultSettings: Settings = {
	maxReactions: 10,
}
