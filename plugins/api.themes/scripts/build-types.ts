import { execFileSync } from 'node:child_process'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'build/types-package')
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))

await rm(out, { recursive: true, force: true })

execFileSync(
	'tsc',
	[
		join(root, 'js/types.ts'),
		'--ignoreConfig',
		'--declaration',
		'--emitDeclarationOnly',
		'--skipLibCheck',
		'--outDir',
		out,
	],
	{ stdio: 'inherit' },
)

await cp(join(root, 'types-package'), out, { recursive: true })
await cp(join(root, 'js/api.d.ts'), join(out, 'api.d.ts'))
await cp(join(root, '../../LICENSE'), join(out, 'LICENSE'))

await writeFile(
	join(out, 'package.json'),
	`${JSON.stringify(
		{
			name: '@revenge-mod/themes-api',
			version: manifest.version,
			description: manifest.description,
			license: 'GPL-3.0',
			types: './api.d.ts',
			exports: {
				'.': { types: './api.d.ts' },
				'./types': { types: './types.d.ts' },
			},
			peerDependencies: {
				'@revenge-mod/types':
					'git+https://github.com/revenge-mod/revenge-types.git',
			},
		},
		null,
		'\t',
	)}\n`,
)
