// Newer snowflakes are longer, or sort after at the same length
export function compareSnowflakes(a: string, b: string) {
	return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

export function sleep(ms: number) {
	return new Promise<void>(resolve => setTimeout(resolve, ms))
}
