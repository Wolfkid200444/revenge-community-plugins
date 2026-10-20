/// <reference types="@revenge-mod/themes-api" />

import { FileModule } from '@revenge-mod/discord/native'
import { rm } from '@revenge-mod/modules/native/fs'
import { pluginStorageDirFor } from '@revenge-mod/plugins/constants'
import {
	fontFileExtensionOf,
	legacyFontFamilies,
	legacyThemeBackground,
	legacyThemeColors,
	parseLegacyFontPack,
	parseLegacyTheme,
} from './parsers'
import * as Settings from './settings'
import type { JsonStorage } from '@revenge-mod/json-storage'
import type { PluginManifest } from '@revenge-mod/plugins/types'
import type { ThemesApi } from '@revenge-mod/themes-api/types'
import type { LegacyFontPack, LegacyTheme } from './parsers'

const GroupId = 'legacy'

export interface Storage {
	/** Imported themes keyed by source URL. */
	themes: Record<string, LegacyTheme>
	/** Imported font packs and local font files keyed by source URL. */
	fonts: Record<string, { pack: LegacyFontPack; files: Record<string, string> }>
}

let storage: JsonStorage<Storage>
let manifest: PluginManifest
let themes: ThemesApi

export default plugin<{ jsonStorage: Storage }>({
	jsonStorage: {
		load: true,
		default: { themes: {}, fonts: {} },
	},
	async start(api) {
		storage = api.jsonStorage
		manifest = api.plugin.manifest
		themes = api.themes

		themes.registerGroup(GroupId, {
			name: 'Imported',
			description: 'Vendetta and Bunny themes and font packs',
		})

		const { themes: savedThemes, fonts } = await storage.get()
		for (const [url, theme] of Object.entries(savedThemes))
			registerLegacyTheme(url, theme)
		for (const [url, { pack, files }] of Object.entries(fonts))
			registerLegacyFontPack(url, pack, files)
	},
	SettingsComponent: ({ api }) => <Settings.default api={api} />,
})

function registerLegacyTheme(url: string, theme: LegacyTheme) {
	themes.registerTheme(GroupId, url, {
		name: theme.name,
		description:
			theme.description ?? theme.authors?.map(author => author.name).join(', '),
		getColors: () => legacyThemeColors(theme),
		background: legacyThemeBackground(theme),
	})
}

function registerLegacyFontPack(
	url: string,
	pack: LegacyFontPack,
	files: Record<string, string>,
) {
	themes.registerFontPack(GroupId, url, {
		name: pack.name,
		description: pack.description,
		families: legacyFontFamilies(files),
	})
}

async function fetchJson(url: string) {
	const res = await fetch(url, { cache: 'no-store' })
	if (!res.ok) throw new Error(`Request failed with ${res.status}: ${url}`)
	return res.json()
}

export async function importLegacyTheme(url: string) {
	const theme = parseLegacyTheme(await fetchJson(url))
	await storage.set({ themes: { [url]: theme } })
	registerLegacyTheme(url, theme)
}

export async function importLegacyFontPack(url: string) {
	const pack = parseLegacyFontPack(await fetchJson(url))
	const dir = fontPackDirOf(url)
	const files: Record<string, string> = {}

	await Promise.all(
		Object.entries(pack.main).map(async ([name, fileUrl]) => {
			const path = `${dir}/${name}${fontFileExtensionOf(fileUrl)}`
			const res = await fetch(fileUrl)
			if (!res.ok)
				throw new Error(`Request failed with ${res.status}: ${fileUrl}`)
			await writeBinaryFile(path, await res.arrayBuffer())
			files[name] = path
		}),
	)

	await storage.set({ fonts: { [url]: { pack, files } } })
	registerLegacyFontPack(url, pack, files)
}

/** Removes an imported theme or font pack. Takes effect on next app start. */
export async function removeLegacyImport(
	kind: 'themes' | 'fonts',
	url: string,
) {
	if (!storage) throw new Error(`${manifest.name} is not running`)

	const current = await storage.get()
	const { [url]: _, ...rest } = current[kind]
	await storage.set({ ...current, [kind]: rest }, true)

	if (kind === 'fonts') await rm(fontPackDirOf(url))
}

async function writeBinaryFile(path: string, data: ArrayBuffer) {
	const { DocumentsDirPath } = FileModule.getConstants()
	if (!path.startsWith(`${DocumentsDirPath}/`))
		throw new Error(`Path outside documents directory: ${path}`)

	await FileModule.writeFile(
		'documents',
		path.slice(DocumentsDirPath.length + 1),
		toBase64(data),
		'base64',
	)
}

function toBase64(data: ArrayBuffer) {
	const bytes = new Uint8Array(data)
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(binary)
}

/** Resolves storage directory path for a font pack using a hash of its source URL. */
function fontPackDirOf(url: string) {
	let hash = 0
	for (let i = 0; i < url.length; i++)
		hash = (Math.imul(hash, 31) + url.charCodeAt(i)) | 0

	return `${pluginStorageDirFor(manifest.id)}/fonts/${(hash >>> 0).toString(16)}`
}
