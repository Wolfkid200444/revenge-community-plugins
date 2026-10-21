import type { ThemeRegistration } from 'shiki/core'

export const DiscordThemeName = 'discord'

/**
 * Discord syntax roles matching `Providers` in DiscordPalette.kt.
 * Uses placeholder hex (`#0000XX01`, where `XX` is the role index) so native can swap in actual colors when rendering.
 */
const Roles = [
	'background',
	'text',
	'keyword',
	'string',
	'comment',
	'builtin',
	'type',
	'title',
	'property',
	'addition',
	'deletion',
] as const

const role = (name: (typeof Roles)[number]) =>
	`#0000${Roles.indexOf(name).toString(16).padStart(2, '0')}01`

const Scopes: [scope: string[], color: string][] = [
	[['comment', 'punctuation.definition.comment'], role('comment')],
	[
		[
			'string',
			'string.regexp',
			'constant.character',
			'constant.other.symbol',
			'punctuation.definition.string',
		],
		role('string'),
	],
	[
		[
			'keyword',
			'storage',
			'keyword.operator.new',
			'keyword.operator.expression',
			'keyword.operator.word',
			'entity.name.tag',
		],
		role('keyword'),
	],
	// Discord styles operators and punctuation using base text color.
	[['keyword.operator', 'punctuation'], role('text')],
	[
		[
			'constant.numeric',
			'constant.language',
			'constant.other',
			'support.constant',
			'support.function',
			'variable.language',
		],
		role('builtin'),
	],
	[
		[
			'entity.name.type',
			'entity.name.class',
			'entity.name.namespace',
			'entity.other.inherited-class',
			'storage.type.primitive',
			'support.type',
			'support.class',
		],
		role('type'),
	],
	[
		['entity.name.function', 'entity.name.section', 'markup.heading'],
		role('title'),
	],
	[
		[
			'variable.other.property',
			'variable.other.object.property',
			'support.type.property-name',
			'support.variable.property',
			'entity.other.attribute-name',
			'meta.object-literal.key',
		],
		role('property'),
	],
	[['markup.inserted', 'punctuation.definition.inserted'], role('addition')],
	[['markup.deleted', 'punctuation.definition.deleted'], role('deletion')],
]

/** Discord desktop ANSI palette. Maps white to `text` to stay visible in light themes. */
const Ansi = {
	Black: '#4f545c',
	Red: '#dc322f',
	Green: '#859900',
	Yellow: '#b58900',
	Blue: '#268bd2',
	Magenta: '#d33682',
	Cyan: '#2aa198',
	White: role('text'),
}

/** Shiki theme that matches Discord's code styling and tracks the active client theme. */
export const DiscordTheme: ThemeRegistration = {
	name: DiscordThemeName,
	type: 'dark',
	fg: role('text'),
	bg: role('background'),
	colors: Object.fromEntries(
		Object.entries(Ansi).flatMap(([name, color]) => [
			[`terminal.ansi${name}`, color],
			[`terminal.ansiBright${name}`, color],
		]),
	),
	settings: [
		{ settings: { foreground: role('text'), background: role('background') } },
		...Scopes.map(([scope, foreground]) => ({
			scope,
			settings: { foreground },
		})),
		{ scope: 'markup.bold', settings: { fontStyle: 'bold' } },
		{ scope: 'markup.italic', settings: { fontStyle: 'italic' } },
		{ scope: 'markup.underline', settings: { fontStyle: 'underline' } },
		{ scope: 'markup.strikethrough', settings: { fontStyle: 'strikethrough' } },
	],
}
