import { Stores } from '@revenge-mod/discord/flux'
import { JsonStorageUpdateMode } from '@revenge-mod/json-storage'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { before } from '@revenge-mod/patcher'
import { getRawAnsiBlocks, isAnsi, stripAnsi } from './ansi'
import { createHighlighter } from './highlighter'
import { clearHighlights, putHighlights, setOpenOnTap } from './native'
import SettingsComponent from './settings'
import { getThemes } from './themes'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type { Highlight } from './highlighter'
import type { ThemeName } from './themes'

export interface Settings {
	/** For Discord's dark, darker and midnight themes. */
	dark: ThemeName
	light: ThemeName
	/** Whether tapping a code block opens it in a viewer, where its text can be selected. */
	openOnTap: boolean
}

export const DefaultSettings: Settings = {
	dark: 'github-dark-default',
	light: 'github-light-default',
	openOnTap: true,
}

/** Commands of Discord's native chat list. Rows are serialized to JSON after this. */
interface ChatListCommands {
	updateRows(ref: unknown, data: { rows: unknown[] }): void
	clearRows(ref: unknown): void
	scrollToBottom(ref: unknown): void
}

interface CodeBlockNode {
	type: 'codeBlock'
	lang: string
	content: string
}

type ThemeStore = DiscordModules.Flux.Store<{
	theme: 'light' | 'dark' | 'darker' | 'midnight'
}>

/** How many highlights to keep, so blocks in updated rows aren't tokenized again. */
const MemoCapacity = 256

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	start({ cleanup, jsonStorage, plugin }) {
		// Key to highlight, least recently used first
		const memo = new Map<string, Highlight>()
		const highlight = createHighlighter()
		let reported = false

		const settings = () =>
			(jsonStorage.cache as Partial<Settings> | undefined) ?? DefaultSettings
		const syncOpenOnTap = () =>
			setOpenOnTap(settings().openOnTap ?? DefaultSettings.openOnTap)

		clearHighlights()
		syncOpenOnTap()
		cleanup(clearHighlights)

		cleanup(
			jsonStorage.subscribe((update, mode) => {
				// Checked on every tap, so this applies right away
				syncOpenOnTap()
				// Rows already rendered keep their highlights, and Discord doesn't send them again for this
				if (
					mode !== JsonStorageUpdateMode.Load &&
					('dark' in update || 'light' in update)
				)
					plugin.requireReload()
			}),
		)

		const prepare = (rows: unknown[]) => {
			const type =
				(Stores.ThemeStore as ThemeStore).theme === 'light' ? 'light' : 'dark'
			// Stored themes may be missing, or removed in a later version
			const stored = settings()[type]
			const theme =
				stored && stored in getThemes() ? stored : DefaultSettings[type]

			// Every block in the rows is sent, even if it was before. Native hands them to the nodes made from these rows,
			// so it never has to remember a block for later, and can't disagree with JS on what it has.
			const keys = new Set<string>()
			const blocks: Highlight[] = []
			for (const row of rows) {
				const nodes: CodeBlockNode[] = []
				collectCodeBlocks(row, nodes)
				if (!nodes.length) continue

				const raw = nodes.some(node => isAnsi(node.lang))
					? getRawAnsiBlocks(row)
					: undefined

				for (const { lang, content } of nodes) {
					// ANSI blocks come without escape sequences, so they are highlighted from the stored message
					const source =
						(isAnsi(lang) && raw?.get(stripAnsi(content))) || content

					// Switching between light and dark sends every row again, which then get the other theme
					const key = `${theme}\0${lang.trim()}\0${source}`
					if (keys.has(key)) continue
					keys.add(key)

					let result = memo.get(key)
					if (result === undefined) result = highlight(lang, source, theme)
					else memo.delete(key)

					memo.set(key, result)
					if (memo.size > MemoCapacity) memo.delete(memo.keys().next().value!)
					// Native looks blocks up by the content it gets
					blocks.push(source === content ? result : { ...result, content })
				}
			}

			if (blocks.length) putHighlights(blocks)
		}

		cleanup(
			getModules(
				withProps<ChatListCommands>(
					'updateRows',
					'clearRows',
					'scrollToBottom',
				),
				commands => {
					cleanup(
						before(commands, 'updateRows', args => {
							try {
								const rows = args[1]?.rows
								if (Array.isArray(rows)) prepare(rows)
							} catch (e) {
								// Discord falls back to its own highlighting, so chat keeps working
								if (!reported) plugin.reportError(e)
								reported = true
							}
							return args
						}),
					)
				},
			),
		)
	},
	stop({ plugin }) {
		// Rendered rows keep their highlights
		plugin.requireReload()
	},
	SettingsComponent,
})

function collectCodeBlocks(value: unknown, out: CodeBlockNode[]) {
	if (Array.isArray(value)) {
		for (const item of value) collectCodeBlocks(item, out)
		return
	}

	if (!value || typeof value !== 'object') return

	const node = value as Partial<CodeBlockNode>
	if (
		node.type === 'codeBlock' &&
		typeof node.lang === 'string' &&
		typeof node.content === 'string'
	) {
		out.push(node as CodeBlockNode)
		return
	}

	for (const key in value)
		collectCodeBlocks((value as Record<string, unknown>)[key], out)
}
