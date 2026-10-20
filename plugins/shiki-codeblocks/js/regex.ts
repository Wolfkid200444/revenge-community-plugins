import { EmulatedRegExp, toRegExpDetails } from 'oniguruma-to-es'
import type { ToRegExpOptions } from 'oniguruma-to-es'

/**
 * A grammar pattern converted from Oniguruma to a JS RegExp, or `null` if it can't be.
 *
 * Converting is what makes the first block in a language slow, so `scripts/generate.ts` does it ahead of time.
 */
export type PrecompiledRegex =
	| [pattern: string, flags: string, options?: Record<string, unknown>]
	| null

/** As Shiki's `defaultJavaScriptRegexConstructor`, for what Hermes supports (no RegExp `v` flag). */
const Options: ToRegExpOptions = {
	global: true,
	hasIndices: true,
	lazyCompileLength: 3e3,
	target: 'ES2018',
	rules: {
		allowOrphanBackrefs: true,
		asciiWordBoundaries: true,
		captureGroup: true,
		recursionLimit: 5,
		singleline: true,
	},
}

export function precompile(source: string): PrecompiledRegex {
	try {
		const { pattern, flags, options } = toRegExpDetails(source, Options)
		return options ? [pattern, flags, options] : [pattern, flags]
	} catch {
		return null
	}
}

export function construct([
	pattern,
	flags,
	options,
]: NonNullable<PrecompiledRegex>) {
	return options
		? new EmulatedRegExp(pattern, flags, options)
		: new RegExp(pattern, flags)
}
