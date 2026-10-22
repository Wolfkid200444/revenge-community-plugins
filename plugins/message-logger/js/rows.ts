import { Tokens } from '@revenge-mod/discord/common/tokens'
import { Stores } from '@revenge-mod/discord/flux'
import { processColor } from 'react-native'
import { getLog, takeChanged } from './logger'
import { setDimmedAttachments } from './native'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type { MessageRecord } from './logger'

export interface GenerateArgs {
	message: MessageRecord
}

export interface MessageRow {
	type?: number
	changeType?: number
	message?: RowMessage
}

interface RowMessage {
	id: string
	content?: object[]
	edited?: string
	editedColor?: number | null
	textColor?: number
}

export interface RowManager {
	generate(args: GenerateArgs): MessageRow
}

const MessageRowType = 1
const UpdateChangeType = 2

// Must match the markers in native
const HistoryStart = ''
const HistoryEnd = ''
const EditedStart = ''
const EditedSeparator = ''
const EditedEnd = ''

type ThemeStore = DiscordModules.Flux.Store<{ theme: string }>

export function styleRow(
	row: MessageRow,
	args: GenerateArgs,
	generate: (args: GenerateArgs) => MessageRow,
) {
	const message = row?.type === MessageRowType ? row.message : undefined
	if (!message) return

	// Discord only sees the same record, so native wouldn't bind it again
	if (takeChanged(message.id)) row.changeType = UpdateChangeType

	const log = getLog(message.id)
	const attachments = args.message.attachments.map(({ id }) => id)

	const deletedAttachments = new Set(
		!log?.highlighted ? [] : log.deleted ? attachments : log.removedAttachments,
	)
	setDimmedAttachments(deletedAttachments, true)
	setDimmedAttachments(
		attachments.filter(id => !deletedAttachments.has(id)),
		false,
	)

	if (!log) return

	if (log.edits.length)
		message.content = [
			...history(log.edits, message, args, generate),
			...(message.content ?? []),
		]

	if (log.deleted && log.highlighted) message.textColor = criticalColor()
}

function history(
	edits: MessageRecord[],
	message: RowMessage,
	args: GenerateArgs,
	generate: (args: GenerateArgs) => MessageRow,
) {
	const label = `${EditedStart}${message.editedColor ?? ''}${EditedSeparator} (${message.edited || 'edited'})${EditedEnd}\n`

	return edits.flatMap(record => [
		text(HistoryStart),
		...(generate({ ...args, message: record }).message?.content ?? []),
		text(HistoryEnd),
		text(label),
	])
}

const text = (content: string) => ({ type: 'text', content })

function criticalColor() {
	const theme = (Stores.ThemeStore as ThemeStore).theme
	const { colors, internal } = Tokens.default

	return processColor(
		internal.resolveSemanticColor(theme, colors.TEXT_FEEDBACK_CRITICAL),
	) as number
}
