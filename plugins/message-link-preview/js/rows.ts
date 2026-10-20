import { AccessibilityStore, ChannelStore, Modules, UserStore } from './discord'
import { requestMembers } from './members'
import type { Preview, PreviewView } from './native'
import type { MessageRecord, MessageRow, RowMessage } from './types'

export interface RowManager {
	setOptions(options: object): void
	generate(args: {
		rowType: number
		changeType: number
		message: MessageRecord
		isFirst: boolean
		canShowImages: boolean
		canAddNewReactions: boolean
		roleStyle: string
	}): MessageRow
}

export const MessageRowType = 1
const NoopChange = 0
// GuildTagBadgeSize.SIZE_12
const GuildTagBadgeSize = 12
// Embed margins and the preview's avatar column, in dp
const PreviewInset = 64

// Rows from this don't get previews, so they don't nest
let generator: RowManager | undefined
let chatWidth = 0

export function createGenerator(RowManager: new () => RowManager) {
	generator = new RowManager()
	generator.setOptions({
		renderCodedLinks: true,
		renderGiftCode: true,
		renderActivityInstanceEmbed: true,
		renderActivityInviteEmbed: true,
		renderEmbeds: true,
		ignoreMentioned: true,
		inlineAttachmentMedia: true,
		inlineEmbedMedia: true,
		renderReactions: true,
		renderReplies: false,
		renderThreadEmbeds: true,
	})
}

export function isGenerator(rowManager: unknown) {
	return !!generator && rowManager === generator
}

export function setChatWidth(width: number | undefined) {
	if (width) chatWidth = width
}

export function createPreview(record: MessageRecord): Preview {
	const guildId = ChannelStore().getChannel(record.channel_id)?.guild_id
	if (guildId) requestMembers(record, guildId)

	return { row: rowJson(record, guildId), view: previewView(record) }
}

// Same as ChatItem
function previewView(record: MessageRecord): PreviewView | undefined {
	const { MessageTypes, MessageTypesSets } = Modules.MessageTypeConstants!
	if (record.type === MessageTypes.AUTO_MODERATION_ACTION) return 'automod'
	if (MessageTypesSets.AUTOMOD_INCIDENT_ACTIONS.has(record.type)) return
	if (!MessageTypesSets.USER_MESSAGE.has(record.type)) return 'system'
}

function rowJson(record: MessageRecord, guildId?: string | null) {
	generator!.setOptions({
		constrainedWidth: Math.max(chatWidth - PreviewInset, 0),
	})

	const row = generator!.generate({
		rowType: MessageRowType,
		changeType: NoopChange,
		message: record,
		isFirst: true,
		canShowImages: true,
		canAddNewReactions: false,
		roleStyle: AccessibilityStore().roleStyle ?? 'username',
	})

	// Swiping is for the message the preview is in
	row.swipeActions = undefined
	if (row.message) addGuildTag(row.message, record, guildId)

	return JSON.stringify({ ...row, index: 0 })
}

// Discord gets guild tags from UserStore, which doesn't have authors that aren't members
function addGuildTag(
	message: RowMessage,
	{ author }: MessageRecord,
	guildId?: string | null,
) {
	const { GuildTagUtils } = Modules
	if (
		message.clanTag ||
		!author.primaryGuild ||
		UserStore().getUser(author.id) ||
		!GuildTagUtils!.shouldDisplayGuildTag(
			author.id,
			guildId,
			author.primaryGuild,
		)
	)
		return

	const {
		guildId: tagGuildId,
		tag,
		badge,
	} = GuildTagUtils!.getUserPrimaryGuild(author.primaryGuild)
	if (!tagGuildId || !tag) return

	message.clanTagGuildId = tagGuildId
	message.clanTag = tag
	message.clanBadgeUrl = GuildTagUtils!.getGuildTagBadgeUrl(
		tagGuildId,
		badge,
		GuildTagBadgeSize,
	)
}

export function resetRows() {
	generator = undefined
	chatWidth = 0
}
