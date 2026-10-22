import { getAssetIdByName } from '@revenge-mod/assets'
import { Constants } from '@revenge-mod/discord/common/constants'
import { Stores } from '@revenge-mod/discord/flux'
import { lookupModule } from '@revenge-mod/modules/finders'
import {
	withDependencies,
	withProps,
} from '@revenge-mod/modules/finders/filters'
import { Image } from 'react-native'
import type { DiscordModules } from '@revenge-mod/discord/types'
import type {
	Channel,
	ChannelIconUtils,
	EmojiUtils,
	ImageSource,
	RoleIconUtils,
	User,
} from './types'

export interface ContentNode {
	type?: string
	content?: unknown
	inContent?: ContentNode[] | null
	items?: ContentNode[][]
	userId?: string
	roleId?: string
	guildId?: string | null
	channelId?: string
	channelType?: number
	icon?: string
}

// Glyphs are tinted with the text's color
type Shape = 'circle' | 'square' | 'glyph'

// Read and stripped by native
const ShapeMarker = '#palmdevs.mention-avatars:'
const IconSize = 20

const iconed = new WeakSet<ContentNode>()

// Discord caches parsed nodes, so they're copied
export function withIcons(nodes: ContentNode[]): ContentNode[] {
	let changed = false

	const result = nodes.map(node => {
		const updated = withIcon(node)
		if (updated !== node) changed = true
		return updated
	})

	return changed ? result : nodes
}

function withIcon(node: ContentNode): ContentNode {
	// Replies can share nodes with their rows
	if (iconed.has(node)) return node

	if (node.type === 'mention') {
		if (!Array.isArray(node.content)) return node

		const icon = node.userId
			? userIcon(node.userId, node.guildId)
			: node.roleId && node.guildId
				? roleIcon(node.guildId, node.roleId)
				: undefined

		return icon ? done({ ...node, content: [...icon, ...node.content] }) : node
	}

	if (node.type === 'channelMention') {
		const inContent = dmName(node)
		return inContent ? done({ ...node, inContent }) : node
	}

	// Formatting nodes can hold mentions too
	if (Array.isArray(node.content)) {
		const content = withIcons(node.content)
		if (content !== node.content) return { ...node, content }
	}

	if (node.type === 'list' && node.items) {
		const items = node.items.map(withIcons)
		if (items.some((item, i) => item !== node.items![i]))
			return { ...node, items }
	}

	return node
}

function done(node: ContentNode) {
	iconed.add(node)
	return node
}

function userIcon(userId: string, guildId?: string | null) {
	const UserStore = Stores.UserStore as DiscordModules.Flux.Store<{
		getUser(id: string): User | undefined
	}>

	const uri = imageUri(
		UserStore.getUser(userId)?.getAvatarURL(guildId, IconSize),
	)
	if (uri) return [iconNode(uri, 'circle')]
}

function roleIcon(guildId: string, roleId: string): ContentNode[] | undefined {
	const { atMost, ordered, relative } = withDependencies

	const [, GuildRoleStoreModuleId] = lookupModule(
		withProps('getRole', 'getManyRoles'),
	)
	const [, GuildStoreModuleId] = lookupModule(
		withProps('getGuild', 'getGuilds'),
	)
	const [, IntlModuleId] = lookupModule(withProps('intl', 't'))

	// modules/messages/native/renderer/getRoleIcon.tsx
	const [RoleIconUtils] = lookupModule(
		withProps<RoleIconUtils>('getRoleIcon').and(
			withDependencies(
				atMost(
					3,
					ordered([
						// modules/roles/useRoleIconProps.tsx
						ordered([
							GuildRoleStoreModuleId!,
							GuildStoreModuleId!,
							relative(1),
						]),
						IntlModuleId!,
					]),
				),
			),
		),
	)

	const icon = RoleIconUtils?.getRoleIcon({ guildId, roleId, size: IconSize })

	if (icon?.source) return [iconNode(icon.source, 'square')]

	// Emoji nodes can wrap away from the name, so draw it as an icon
	if (icon?.unicodeEmoji) {
		const [EmojiUtils] = lookupModule(
			withProps<EmojiUtils>('getURL', 'applyPlatformToThemedEmojiColorPalette'),
		)

		const uri = EmojiUtils?.getURL(icon.unicodeEmoji)
		if (uri) return [iconNode(uri, 'square')]
	}

	const uri = imageUri(getAssetIdByName('ShieldUserIcon'))
	if (uri) return [iconNode(uri, 'glyph')]
}

// Discord gives DM links a text channel icon
function dmName(node: ContentNode): ContentNode[] | undefined {
	const Constants_ = Constants as any
	const DMChannelTypes = [
		Constants_.ChannelTypes.DM,
		Constants_.ChannelTypes.GROUP_DM,
	]

	const name = node.inContent?.length === 1 ? node.inContent[0] : undefined
	if (name?.type !== 'channel' || !DMChannelTypes.includes(name.channelType!))
		return

	const ChannelStore = Stores.ChannelStore as DiscordModules.Flux.Store<{
		getChannel(id: string): Channel | undefined
	}>

	const channel = node.channelId && ChannelStore.getChannel(node.channelId)
	if (!channel) return

	const { atMost, ordered } = withDependencies

	const [, UserStoreModuleId] = lookupModule(
		withProps('getCurrentUser', 'getUser'),
	)
	const [, AvatarUtilsModuleId] = lookupModule(
		withProps('getChannelIconURL', 'getUserAvatarURL'),
	)

	// modules/channel/getChannelIcon.tsx
	const [ChannelIconUtils] = lookupModule(
		withProps<ChannelIconUtils>(
			'getChannelIconURL',
			'getChannelIconSource',
		).and(
			withDependencies(
				atMost(6, ordered([UserStoreModuleId!, AvatarUtilsModuleId!])),
			),
		),
	)

	const uri = imageUri(ChannelIconUtils?.getChannelIconURL(channel, IconSize))
	if (!uri) return

	return [
		{
			type: 'guild',
			content: textOf(name.content),
			icon: withShape(uri, 'circle'),
		},
	]
}

function iconNode(uri: string, shape: Shape): ContentNode {
	return { type: 'guild', content: '', icon: withShape(uri, shape) }
}

function withShape(uri: string, shape: Shape) {
	return `${uri}${ShapeMarker}${shape}`
}

// Default avatars and group DM icons are bundled assets
function imageUri(source: ImageSource) {
	if (typeof source === 'number') return Image.resolveAssetSource(source)?.uri
	return source || undefined
}

function textOf(content: unknown): string {
	if (typeof content === 'string') return content
	if (Array.isArray(content))
		return content.map(node => textOf((node as ContentNode).content)).join('')
	return ''
}
