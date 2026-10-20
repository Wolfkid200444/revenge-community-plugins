import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withName, withProps } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type { FakeNitroPluginContext } from '../..'
import type { BasicEmoji, BasicSticker } from './types'

/** Builds the rows of the chat list, search results and other message previews */
interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

interface AvatarUtils {
	getEmojiURL(options: { id: string; animated: boolean; size: number }): string
}

interface StickersUtils {
	getStickerAssetUrl(
		sticker: Pick<BasicSticker, 'id' | 'format_type'>,
	): string | null
}

interface ContentNode {
	type?: string
	content?: unknown
	target?: unknown
	jumboable?: boolean
}

interface RowSticker {
	id: string
	name: string
	format_type: number
	asset: string
	url: string
	width: number
	height: number
	renderMode: number
	accessibilityLabel: string
	accessibilityHint: string
}

interface MessageRow {
	type?: number
	message?: RowMessage
}

interface RowMessage {
	content?: ContentNode[]
	embeds?: { type?: string; url?: string }[]
	stickers?: RowSticker[]
	attachments?: unknown[]
	useAttachmentGridLayout?: boolean
	useAttachmentUploadPreview?: boolean
	/** Preview of the message this one replies to */
	referencedMessage?: { message?: RowMessage }
}

interface ExpressionLink {
	kind: 'emojis' | 'stickers'
	id: string
	extension: string
	name?: string
	animated: boolean
}

const MessageRowType = 1
// EmojiConstants.MAX_EMOJI_TO_BE_JUMBO
const MaxJumboEmojis = 30
// NativeLottieView.NativeLottieRenderMode.LOOP
const StickerRenderModeLoop = 0
// Discord renders every sticker in chat at this size
const StickerSize = 160

const ExpressionUrlRegex =
	/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(emojis|stickers)\/(\d+)\.(\w+)/

export default function realifyExpressions({
	plugin,
	cleanup,
	jsonStorage: storage,
}: FakeNitroPluginContext) {
	const EmojiStore = Stores.EmojiStore as DiscordModules.Flux.Store<{
		getCustomEmojiById(id: string): BasicEmoji | undefined
	}>

	const StickersStore = Stores.StickersStore as DiscordModules.Flux.Store<{
		getStickerById(id: string): BasicSticker | undefined
	}>

	let AvatarUtils: AvatarUtils | undefined
	let StickersUtils: StickersUtils | undefined

	function createEmojiNode({ id, name, animated }: ExpressionLink) {
		const emoji = EmojiStore.getCustomEmojiById(id)
		animated ||= emoji?.animated ?? false

		// Same as Discord's own emoji nodes
		return {
			type: 'customEmoji',
			id,
			alt: emoji?.name ?? name ?? 'emoji',
			src: AvatarUtils!.getEmojiURL({ id, animated, size: 48 }),
			frozenSrc: AvatarUtils!.getEmojiURL({ id, animated: false, size: 48 }),
		}
	}

	function createSticker({ id, name, extension }: ExpressionLink): RowSticker {
		const known = StickersStore.getStickerById(id)
		const sticker = {
			id,
			name: known?.name ?? name ?? 'Sticker',
			// PNG works for both static and APNG stickers
			format_type: known?.format_type ?? (extension === 'gif' ? 4 : 2),
		}

		// Same as Discord's transformStickers
		return {
			...sticker,
			asset: id,
			url: StickersUtils!.getStickerAssetUrl(sticker) ?? '',
			width: StickerSize,
			height: StickerSize,
			renderMode: StickerRenderModeLoop,
			accessibilityLabel: sticker.name,
			accessibilityHint: '',
		}
	}

	function realify(
		message: RowMessage,
		isReplyPreview = false,
	): RowMessage | undefined {
		const settings = storage.cache?.expressions
		const emojis = settings?.emojis.transform
		// Reply previews only show text, so sticker links stay as links there
		const stickers = !isReplyPreview && settings?.stickers.transform
		if (!emojis && !stickers) return

		const emojiIds = new Set<string>()
		const newStickers = new Map<string, RowSticker>()

		const parse = (url: unknown) => {
			const link = parseExpressionUrl(url)
			if (link?.kind === 'emojis' ? emojis : stickers) return link
		}

		// Nodes may be cached by Discord, so they're copied instead of changed
		const convertNodes = (nodes: ContentNode[]) => {
			let changed = false
			const result: ContentNode[] = []

			for (const node of nodes) {
				const converted = convertNode(node)
				if (converted !== node) changed = true
				if (converted) result.push(converted)
			}

			return changed ? result : nodes
		}

		const convertNode = (node: ContentNode): ContentNode | null => {
			if (node?.type === 'link') {
				const link = parse(node.target)
				if (!link) return node

				if (link.kind === 'emojis') {
					emojiIds.add(link.id)
					return createEmojiNode(link)
				}

				if (!newStickers.has(link.id))
					newStickers.set(link.id, createSticker(link))
				return null
			}

			if (Array.isArray(node?.content)) {
				const content = convertNodes(node.content)
				if (content !== node.content) return { ...node, content }
			}

			return node
		}

		const original = message.content ?? []
		let content = convertNodes(original)

		// A message that is only one link has its content hidden behind the embed
		let removedEmbeds = false
		const embeds = message.embeds?.filter(embed => {
			if (embed?.type !== 'image' && embed?.type !== 'gifv') return true

			const link = parse(embed.url)
			if (!link) return true

			if (link.kind === 'stickers') {
				if (!newStickers.has(link.id))
					newStickers.set(link.id, createSticker(link))
			} else if (!emojiIds.has(link.id)) {
				if (original.length) return true

				if (content.length)
					content = [...content, { type: 'text', content: ' ' }]
				content = [...content, createEmojiNode(link)]
				emojiIds.add(link.id)
			}

			removedEmbeds = true
			return false
		})

		if (content === original && !removedEmbeds && !newStickers.size) return

		content = trimWhitespace(content)
		if (!isReplyPreview && isJumboable(content))
			content = content.map(node => ({ ...node, jumboable: true }))

		const result: RowMessage = { ...message, content, embeds }

		if (newStickers.size)
			result.stickers = [...(message.stickers ?? []), ...newStickers.values()]

		if (removedEmbeds && !embeds?.length && !message.attachments?.length) {
			result.useAttachmentGridLayout = false
			result.useAttachmentUploadPreview = false
		}

		return result
	}

	cleanup(
		// utils/AvatarUtils.tsx
		getModules(withProps<AvatarUtils>('getEmojiURL'), exports => {
			AvatarUtils = exports
		}),
		// modules/stickers/StickersUtils.tsx
		getModules(withProps<StickersUtils>('getStickerAssetUrl'), exports => {
			StickersUtils = exports
		}),
		// modules/messages/native/renderer/RowGenerator.tsx
		getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
			cleanup(
				after(prototype, 'generate', row => {
					if (
						row?.type !== MessageRowType ||
						!row.message ||
						!AvatarUtils ||
						!StickersUtils
					)
						return row

					try {
						const message = realify(row.message)
						if (message) row.message = message

						const reply = row.message.referencedMessage
						const replyMessage = reply?.message && realify(reply.message, true)
						if (replyMessage)
							row.message = {
								...row.message,
								referencedMessage: { ...reply, message: replyMessage },
							}
					} catch (e) {
						plugin.reportError(`Failed to realify message: ${getErrorStack(e)}`)
					}

					return row
				}),
			)
		}),
	)
}

function parseExpressionUrl(url: unknown): ExpressionLink | undefined {
	if (typeof url !== 'string') return

	const match = ExpressionUrlRegex.exec(url)
	if (!match) return

	const extension = match[3]!.toLowerCase()
	const name = /[?&]name=([^&#]*)/.exec(url)?.[1]

	return {
		kind: match[1] as ExpressionLink['kind'],
		id: match[2]!,
		extension,
		name: name ? safeDecodeURIComponent(name) : undefined,
		animated: extension === 'gif' || /[?&]animated=true(?:[&#]|$)/.test(url),
	}
}

function safeDecodeURIComponent(value: string) {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

function isWhitespace(node: ContentNode) {
	return (
		node?.type === 'text' &&
		typeof node.content === 'string' &&
		!node.content.trim()
	)
}

/** Removes whitespace left at the edges by removed sticker links */
function trimWhitespace(nodes: ContentNode[]) {
	let start = 0
	let end = nodes.length
	while (start < end && isWhitespace(nodes[start]!)) start++
	while (end > start && isWhitespace(nodes[end - 1]!)) end--

	return start === 0 && end === nodes.length ? nodes : nodes.slice(start, end)
}

/** Same rule Discord uses for messages with only emojis */
function isJumboable(nodes: ContentNode[]) {
	let count = 0

	for (const node of nodes) {
		if (node?.type === 'emoji' || node?.type === 'customEmoji') count++
		else if (!isWhitespace(node)) return false
	}

	return count > 0 && count <= MaxJumboEmojis
}
