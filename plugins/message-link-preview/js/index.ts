import { getModules } from '@revenge-mod/modules/finders'
import { withName } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { getErrorStack } from '@revenge-mod/utils/error'
import { addLinked, getFailure, getRecord, resetCache } from './cache'
import { ChannelStore, findModules, modulesFound } from './discord'
import { createEmbed } from './embed'
import { enqueue, startFetching, stopFetching } from './fetch'
import { patchMessagesHandlers } from './interaction'
import { findLinks } from './links'
import { resetMembers } from './members'
import {
	clearPreviews,
	putPreviews,
	setInteractive,
	setMaxHeight,
} from './native'
import { resetPreviews } from './previews'
import {
	createGenerator,
	createPreview,
	isGenerator,
	MessageRowType,
	resetRows,
	setChatWidth,
} from './rows'
import SettingsComponent from './settings'
import { DefaultSettings, MaxPreviewsLimit } from './shared'
import { subscribeUpdates } from './updates'
import type { Previews } from './native'
import type { RowManager } from './rows'
import type { Settings } from './shared'
import type { RowMessage } from './types'

const LoadingText = 'Loading message…'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	start({ cleanup, jsonStorage: storage, plugin }) {
		const settings = (): Settings => ({
			...DefaultSettings,
			...(storage.cache as Partial<Settings> | undefined),
		})

		const syncNative = () => {
			const { maxHeight, interactive } = settings()
			setMaxHeight(maxHeight)
			setInteractive(interactive)
		}

		syncNative()
		startFetching()

		cleanup(
			storage.subscribe(syncNative),
			subscribeUpdates(),
			() => {
				stopFetching()
				resetPreviews()
				resetMembers()
				resetRows()
				resetCache()
				clearPreviews()
			},
			...findModules(),
			patchMessagesHandlers(() =>
				plugin.reportError(
					'MessagesHandlers.params is not a getter, previews will not be interactive',
				),
			),
			// modules/messages/native/renderer/RowGenerator.tsx
			getModules(
				withName<{ new (): RowManager; prototype: RowManager }>('RowManager'),
				RowManager => {
					createGenerator(RowManager)

					cleanup(
						instead(
							RowManager.prototype,
							'generate',
							function (args, original) {
								const row = original.apply(this, args)
								if (
									isGenerator(this) ||
									row?.type !== MessageRowType ||
									!row.message?.content ||
									!modulesFound()
								)
									return row

								try {
									addPreviews(row.message, settings().maxPreviews)
								} catch (e) {
									plugin.reportError(
										`Failed to add previews: ${getErrorStack(e)}`,
									)
								}

								return row
							},
						),
					)
				},
			),
		)
	},
	SettingsComponent,
})

function addPreviews(message: RowMessage, maxPreviews: number) {
	const links = findLinks(
		message.content,
		message.id,
		Math.min(maxPreviews, MaxPreviewsLimit),
	)
	if (!links.size) return

	setChatWidth(message.constrainedWidth)

	const previews: Previews = {}
	const embeds: object[] = []

	for (const link of links.values()) {
		// No access to the channel
		if (!ChannelStore().getChannel(link.channelId)) continue

		addLinked(link.messageId, link.channelId)

		let status = ''
		const record = getRecord(link.messageId)

		if (record) previews[link.messageId] = createPreview(record)
		else {
			status = getFailure(link.messageId) ?? LoadingText
			if (status === LoadingText) enqueue(link)
		}

		embeds.push(createEmbed(link, message, status))
	}

	if (!embeds.length) return
	if (Object.keys(previews).length) putPreviews(previews)

	message.embeds = [...embeds, ...(message.embeds ?? [])]
}
