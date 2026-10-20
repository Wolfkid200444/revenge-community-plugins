// Visual hints for bento tiles, previewing the active option of each kind.

import { getAssetIdByName } from '@revenge-mod/assets'
import { Tokens } from '@revenge-mod/discord/common/tokens'
import { Design } from '@revenge-mod/discord/design'
import { useMemo } from 'react'
import { Image, StyleSheet } from 'react-native'
import { themesInternal } from '..'
import { BoldFontFamilies } from './Previews'
import type { ActiveOption } from '../utils/kinds'

const {
	store: { previewFontFamilyOf, previewIconsOf },
} = themesInternal

const { Stack, createStyles } = Design

/** Discord icons for the default option. Packs show their leading icons instead. */
const DiscordIcons = [
	'HomeIcon',
	'ChatIcon',
	'BellIcon',
	'FriendsIcon',
	'SettingsIcon',
].map(name => getAssetIdByName(name)!)

/** Maximum hints displayed per row on a tile. Fits the narrowest tile layout. */
export const HintCount = 5

const IconSize = 20

const styles = StyleSheet.create({
	// Five hints fit the narrowest tile; excess hints wrap
	row: {
		flexWrap: 'wrap',
	},
})

const useHintStyles = createStyles({
	icon: {
		width: IconSize,
		height: IconSize,
		tintColor: Tokens.default.colors.ICON_DEFAULT,
	},
})

/** Leading icons for a pack, or Discord defaults. */
export function IconHints({ source }: { source?: ActiveOption['source'] }) {
	const hintStyles = useHintStyles()
	const { plugin, group, id } = source ?? {}
	const icons = useMemo(() => {
		if (!plugin) return DiscordIcons

		try {
			return previewIconsOf(plugin, group!, id!, HintCount).map(([, path]) => ({
				uri: `file://${path}`,
			}))
		} catch {
			// Pack unavailable
			return []
		}
	}, [plugin, group, id])

	return (
		<Stack direction="horizontal" spacing={4} style={styles.row}>
			{icons.map((icon, index) => (
				<Image key={index} source={icon} style={hintStyles.icon} />
			))}
		</Stack>
	)
}

/** Font family previewing bold or body styles for label text. Unset for Discord defaults. */
export function useHintFontFamily(source?: ActiveOption['source']) {
	const { plugin, group, id } = source ?? {}

	return useMemo(() => {
		if (!plugin) return

		try {
			return (
				previewFontFamilyOf(plugin, group!, id!, BoldFontFamilies) ??
				previewFontFamilyOf(plugin, group!, id!)
			)
		} catch {
			// Pack unavailable or native module inactive
		}
	}, [plugin, group, id])
}
