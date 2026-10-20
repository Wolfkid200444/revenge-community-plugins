/// <reference types="node" />

// Writes the grammars and themes in `shiki.config.ts` and index to `assets/shiki`,
// with the grammars' patterns converted to JS RegExps (`regexes/`), which is slow on Hermes.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bundledLanguages } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'
import { precompile } from '../js/regex'
import { Languages, Themes } from '../shiki.config'
import type { PrecompiledRegex } from '../js/regex'
import type { ShikiIndex } from '../js/types'

const root = join(import.meta.dirname, '..')
const assets = join(root, 'assets/shiki')

await rm(assets, { recursive: true, force: true })
await mkdir(join(assets, 'langs'), { recursive: true })
await mkdir(join(assets, 'themes'), { recursive: true })
await mkdir(join(assets, 'regexes'), { recursive: true })

const index: ShikiIndex = { languages: {}, themes: {} }

for (const id of Languages) {
	// The language comes last, after the languages it embeds
	const { default: grammars } = await bundledLanguages[id]()
	for (const grammar of grammars) {
		await writeFile(
			join(assets, 'langs', `${grammar.name}.json`),
			JSON.stringify(grammar),
		)
		await writeFile(
			join(assets, 'regexes', `${grammar.name}.json`),
			JSON.stringify(precompileGrammar(grammar)),
		)
		for (const alias of [grammar.name, ...(grammar.aliases ?? [])])
			index.languages[alias] = grammar.name
	}
}

for (const [id, label] of Object.entries(Themes)) {
	const { default: theme } = await bundledThemes[id as keyof typeof Themes]!()
	await writeFile(join(assets, 'themes', `${id}.json`), JSON.stringify(theme))
	index.themes[id] = {
		label: label!,
		type: theme.type === 'light' ? 'light' : 'dark',
	}
}

await writeFile(join(assets, 'index.json'), JSON.stringify(index))

/** The grammar's patterns, keyed by the source the engine gets for them. */
function precompileGrammar(grammar: object) {
	const regexes: Record<string, PrecompiledRegex> = {}
	const visit = (value: unknown) => {
		if (Array.isArray(value)) return value.forEach(visit)
		if (!value || typeof value !== 'object') return

		const rule = value as Record<string, unknown>
		for (const key of ['match', 'begin', 'end', 'while']) {
			const source = rule[key]
			if (typeof source !== 'string') continue
			// Back-references in `end` and `while` are replaced by what `begin` matched, so they are only known at runtime
			if ((key === 'end' || key === 'while') && /\\\d/.test(source)) continue
			for (const variant of engineSources(source))
				regexes[variant] ??= precompile(variant)
		}

		for (const child of Object.values(rule)) visit(child)
	}

	visit(grammar)
	return regexes
}

/**
 * What the engine gets for a pattern, as vscode-textmate's `RegExpSource` makes it:
 * `\z` is rewritten, and patterns with `\A` or `\G` come in four variants, with each anchor allowed or not (`\uFFFF`).
 */
function engineSources(source: string) {
	let rewritten = ''
	let hasAnchor = false
	for (let i = 0; i < source.length; i++) {
		const char = source[i]!
		if (char !== '\\' || i + 1 >= source.length) {
			rewritten += char
			continue
		}

		const next = source[++i]!
		if (next === 'z') rewritten += '$(?!\\n)(?<!\\n)'
		else {
			if (next === 'A' || next === 'G') hasAnchor = true
			rewritten += char + next
		}
	}

	if (!hasAnchor) return [rewritten]

	const variant = (allowA: boolean, allowG: boolean) =>
		rewritten.replace(/\\([\s\S])/g, (sequence, next: string) => {
			if (next === 'A') return allowA ? sequence : '\\\uFFFF'
			if (next === 'G') return allowG ? sequence : '\\\uFFFF'
			return sequence
		})

	return [
		variant(false, false),
		variant(false, true),
		variant(true, false),
		variant(true, true),
	]
}

console.log(
	`Wrote ${new Set(Object.values(index.languages)).size} grammars and ${Object.keys(index.themes).length} themes`,
)
