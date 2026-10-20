import { readFileSync } from '@revenge-mod/modules/native/fs'
import { pluginDistDirFor } from '@revenge-mod/plugins/constants'
import type { ShikiIndex } from './types'

const PluginId = 'palmdevs.shiki-codeblocks'

export function readAsset<T>(path: string): T {
	return JSON.parse(
		readFileSync(`${pluginDistDirFor(PluginId)}/assets/shiki/${path}.json`),
	)
}

let index: ShikiIndex | undefined

export function getIndex() {
	index ??= readAsset<ShikiIndex>('index')
	return index
}
