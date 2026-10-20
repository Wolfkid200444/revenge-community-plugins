import { getAssetIdByName } from '@revenge-mod/assets'
import { Tokens } from '@revenge-mod/discord/common/tokens'
import { Design } from '@revenge-mod/discord/design'
import { Image, Pressable } from 'react-native'
import { pluginSettings } from '..'
import { Kinds, useActiveOption } from '../utils/kinds'
import { HintCount, IconHints, useHintFontFamily } from './KindHints'
import { ColorSwatches, EmojiPreview, PREVIEW_SPACING } from './Previews'
import type { EntryKind } from '@revenge-mod/themes-api/store'

const { Card, Stack, Text, createStyles } = Design

const ChevronSmallRightIcon = getAssetIdByName('ChevronSmallRightIcon')!

const CardRipple = { borderless: false }

const IconSize = 32

/**
 * Bento tile displaying the active option of a kind with provider icon and visual preview,
 * matching its row in the list. Navigates to the kind list.
 */
export default function KindCard({
	kind,
	onPress,
}: {
	kind: EntryKind
	onPress: () => void
}) {
	const styles = useKindCardStyles()
	const { PluginIcon } = pluginSettings!.components
	const { name, icon, groupName, detail, source } = useActiveOption(kind)
	const { tab } = Kinds[kind]
	// Call unconditionally; unset for Discord defaults
	const fontFamily = useHintFontFamily(
		kind === 'fontPacks' ? source : undefined,
	)

	return (
		<Card style={styles.card}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${tab}: ${name}`}
				android_ripple={CardRipple}
				style={styles.content}
				onPress={onPress}
			>
				<Stack
					direction="horizontal"
					justify="space-between"
					align="flex-start"
				>
					<PluginIcon icon={icon} size={IconSize} />
					<Image source={ChevronSmallRightIcon} style={styles.chevron} />
				</Stack>
				<Stack spacing={PREVIEW_SPACING}>
					<Stack spacing={0}>
						<Text variant="text-sm/semibold" color="text-muted">
							{tab}
						</Text>
						<Text
							variant="heading-lg/bold"
							color="text-strong"
							numberOfLines={2}
							style={fontFamily ? { fontFamily } : undefined}
						>
							{name}
						</Text>
					</Stack>
					{kind === 'themes' && (
						<ColorSwatches
							plugin={source?.plugin ?? null}
							group={source?.group ?? ''}
							id={source?.id ?? ''}
						/>
					)}
					{kind === 'iconPacks' && <IconHints source={source} />}
					{kind === 'emojiPacks' && (
						<EmojiPreview
							plugin={source?.plugin ?? null}
							group={source?.group ?? ''}
							id={source?.id ?? ''}
							count={HintCount}
						/>
					)}
					{Boolean(groupName || detail) && (
						<Stack spacing={0}>
							{Boolean(groupName) && (
								<Text
									variant="text-xs/medium"
									color="text-muted"
									numberOfLines={1}
								>
									{groupName}
								</Text>
							)}
							{Boolean(detail) && (
								<Text
									variant="text-xs/medium"
									color="text-muted"
									numberOfLines={1}
								>
									{detail}
								</Text>
							)}
						</Stack>
					)}
				</Stack>
			</Pressable>
		</Card>
	)
}

const useKindCardStyles = createStyles({
	card: {
		flex: 1,
		padding: 0,
		// Clips the ripple
		overflow: 'hidden',
	},
	// A Pressable, so the ripple covers the whole tile
	content: {
		flex: 1,
		minHeight: 128,
		padding: 16,
		gap: 16,
		justifyContent: 'space-between',
	},
	chevron: {
		width: 20,
		height: 20,
		tintColor: Tokens.default.colors.TEXT_MUTED,
	},
})
