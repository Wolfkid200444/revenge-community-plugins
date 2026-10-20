/** Index of grammars and themes (`assets/shiki/index.json`). See `scripts/generate.ts`. */
export interface ShikiIndex {
	/** Language name or alias to its grammar file name. */
	languages: Record<string, string>
	themes: Record<string, { label: string; type: 'dark' | 'light' }>
}
