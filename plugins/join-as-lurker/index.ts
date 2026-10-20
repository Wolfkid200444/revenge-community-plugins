import { Stores } from '@revenge-mod/discord/flux'
import { getModules, lookupModule } from '@revenge-mod/modules/finders'
import {
	withDependencies,
	withProps,
} from '@revenge-mod/modules/finders/filters'
import { before, instead } from '@revenge-mod/patcher'
import type { DiscordModules } from '@revenge-mod/discord/types'

interface JoinGuildOptions {
	source?: string
	lurker?: boolean
	[key: string]: unknown
}

interface GuildActionCreators {
	joinGuild(guildId: string, options?: JoinGuildOptions): Promise<unknown>
	transitionToGuildSync(guildId: string): unknown
}

interface InstantInviteActionCreators {
	acceptInvite(options: { inviteKey: string }): Promise<unknown>
	acceptInviteAndTransitionToInviteChannel(options: unknown): Promise<unknown>
}

interface GuildDiscoveryUtils {
	startLurking(
		guildId: string,
		analyticsSource: object,
		options: { shouldNavigate?: boolean; channelId?: string },
	): Promise<unknown>
}

interface Invite {
	guild?: { id: string; features?: string[] }
	channel?: { id: string }
}

let GuildDiscoveryUtils: GuildDiscoveryUtils | undefined

// utils/GuildDiscoveryUtils.tsx
function getGuildDiscoveryUtils() {
	if (!GuildDiscoveryUtils) {
		const { ordered, relative } = withDependencies

		const [, LurkingStoreModuleId] = lookupModule(
			withProps('isLurking', 'lurkingGuildIds'),
		)
		const [, GuildActionCreatorsModuleId] = lookupModule(
			withProps('joinGuild', 'transitionToGuildSync'),
		)

		;[GuildDiscoveryUtils] = lookupModule(
			withProps<GuildDiscoveryUtils>('startLurking').and(
				withDependencies(
					ordered([
						LurkingStoreModuleId!,
						relative(1),
						GuildActionCreatorsModuleId!,
						[relative(1), relative(2)],
					]),
				),
			),
		)
	}

	return GuildDiscoveryUtils
}

// JoinGuildSources used by "Join Server" buttons shown while lurking (server preview header, chat input blocker, etc.)
// Joins from these are actual confirmations, everything else we lurk
const LurkerUpgradeSources = new Set([
	'Chat Input Blocker - Lurker Mode',
	'Guild Profile - Lurker Mode',
	'Channel List Sticky Header - Lurker Mode',
	'Notice - Lurker Mode',
	'Discoverable Guild Invite - Lurker Mode',
	'Leave Prompt - Lurker Mode',
])

export default plugin({
	start({ cleanup }) {
		const InviteStore = Stores.InviteStore as DiscordModules.Flux.Store<{
			getInvite(inviteKey: string): Invite | undefined
		}>

		const GuildStore = Stores.GuildStore as DiscordModules.Flux.Store<{
			getGuild(guildId: string): object | undefined
		}>

		const LurkingStore = Stores.LurkingStore as DiscordModules.Flux.Store<{
			isLurking(guildId: string): boolean
		}>

		cleanup(
			getModules(
				withProps<GuildActionCreators>('joinGuild', 'transitionToGuildSync'),
				GuildActionCreators => {
					cleanup(
						before(GuildActionCreators, 'joinGuild', args => {
							const options = args[1] ?? {}
							if (!LurkerUpgradeSources.has(options.source!))
								args[1] = { ...options, lurker: true }

							return args
						}),
					)
				},
			),
			getModules(
				withProps<InstantInviteActionCreators>(
					'acceptInvite',
					'acceptInviteAndTransitionToInviteChannel',
				),
				InstantInviteActionCreators => {
					// Accepting an invite always joins for real, so lurk instead
					// Only PREVIEW_ENABLED servers can be lurked, the rest go thru the normal invite flow
					cleanup(
						instead(
							InstantInviteActionCreators,
							'acceptInvite',
							function (args, original) {
								const invite = InviteStore.getInvite(args[0].inviteKey)
								const guildId = invite?.guild?.id
								const discoveryUtils = getGuildDiscoveryUtils()

								if (
									discoveryUtils &&
									guildId &&
									invite.guild!.features?.includes('PREVIEW_ENABLED') &&
									(!GuildStore.getGuild(guildId) ||
										LurkingStore.isLurking(guildId))
								)
									return discoveryUtils.startLurking(
										guildId,
										{},
										{ shouldNavigate: true, channelId: invite.channel?.id },
									)

								return Reflect.apply(original, this, args)
							},
						),
					)
				},
			),
		)
	},
})
