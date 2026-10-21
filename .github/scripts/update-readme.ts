/**
 * Splices a table of published plugins into the README for every plugins directory.
 *
 *   bun .github/scripts/update-readme.ts --index index.json [--readme README.md] [--plugins-dir plugins]...
 *
 * Each directory fills the space between `<!-- <DIR>_TABLE_BEGIN -->` and `<!-- <DIR>_TABLE_END -->`,
 * e.g. `PLUGINS_TABLE_BEGIN` for `plugins`. Only plugins with a source in that directory are listed.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

interface IndexPlugin {
	name: string
	description: string
	author: string
	contributors?: string[]
	channels: Record<string, string>
}

const { values } = parseArgs({
	options: {
		index: { type: 'string' },
		readme: { type: 'string', default: 'README.md' },
		'plugins-dir': { type: 'string', multiple: true, default: ['plugins'] },
	},
})
if (!values.index) throw new Error('Pass --index <index.json>')

const { plugins } = JSON.parse(readFileSync(values.index, 'utf8')) as {
	plugins: Record<string, IndexPlugin>
}

// Keeps a cell on one line and stops it from ending the column.
const cell = (text: string) =>
	text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')

function table(pluginsDir: string): string {
	const rows = readdirSync(pluginsDir)
		.filter(name => existsSync(`${pluginsDir}/${name}/manifest.json`))
		.flatMap(name => {
			const { id } = JSON.parse(
				readFileSync(`${pluginsDir}/${name}/manifest.json`, 'utf8'),
			) as { id: string }
			const plugin = plugins[id]
			return plugin ? [{ name, plugin }] : []
		})
		.sort((a, b) => a.plugin.name.localeCompare(b.plugin.name))

	if (!rows.length) return '_Nothing published yet._'

	return [
		'| Name | Description | Authors | Version |',
		'| --- | --- | --- | --- |',
		...rows.map(({ name, plugin }) => {
			const authors = [plugin.author, ...(plugin.contributors ?? [])].filter(
				Boolean,
			)
			const version = plugin.channels.latest ?? plugin.channels.beta ?? ''
			return `| [${cell(plugin.name)}](${pluginsDir}/${name}) | ${cell(plugin.description)} | ${cell(authors.join(', '))} | ${version} |`
		}),
	].join('\n')
}

let readme = readFileSync(values.readme, 'utf8')

for (const pluginsDir of values['plugins-dir']) {
	const marker = pluginsDir.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
	const begin = `<!-- ${marker}_TABLE_BEGIN -->`
	const end = `<!-- ${marker}_TABLE_END -->`

	const start = readme.indexOf(begin)
	const stop = readme.indexOf(end, start)
	if (start === -1 || stop === -1)
		throw new Error(`${values.readme}: missing ${begin} and ${end} markers`)

	readme = `${readme.slice(0, start + begin.length)}\n\n${table(pluginsDir)}\n\n${readme.slice(stop)}`
}

writeFileSync(values.readme, readme)
console.log(`✓ Updated ${values.readme}`)
