import { Stores } from '@revenge-mod/discord/flux'
import type { DiscordModules } from '@revenge-mod/discord/types'

interface StoredMessage {
	content?: string
	/** Forwarded messages. */
	messageSnapshots?: { message?: { content?: string } }[]
}

type MessageStore = DiscordModules.Flux.Store<{
	getMessage(channelId: string, messageId: string): StoredMessage | undefined
}>

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point
const EscapeSequence = /\u001b\[[\d;]*[A-Za-z]/g
const AnsiBlock = /```ansi[^\S\n]*\n([\s\S]*?)```/gi

export function isAnsi(lang: string) {
	return lang.trim().toLowerCase() === 'ansi'
}

/** A raw ANSI block as Discord sends it to native: without escape sequences or trailing whitespace. */
export function stripAnsi(text: string) {
	return text.replace(EscapeSequence, '').trimEnd()
}

/**
 * Discord strips escape sequences from ANSI code blocks before their rows reach native.
 * This finds the raw blocks in the stored message of [row] (and the messages it forwards), keyed by their stripped text.
 */
export function getRawAnsiBlocks(row: unknown) {
	const message = (row as { message?: { id?: string; channelId?: string } })
		?.message
	if (!message?.id || !message.channelId) return

	const stored = (Stores.MessageStore as MessageStore).getMessage(
		message.channelId,
		message.id,
	)
	if (!stored) return

	const blocks = new Map<string, string>()
	const contents = [
		stored.content,
		...(stored.messageSnapshots ?? []).map(
			snapshot => snapshot.message?.content,
		),
	]

	for (const content of contents)
		if (content)
			for (const [, raw] of content.matchAll(AnsiBlock))
				blocks.set(stripAnsi(raw!), raw!.trimEnd())

	return blocks
}
