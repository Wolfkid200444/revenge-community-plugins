import { Tokens } from '@revenge-mod/discord/common/tokens'
import { Design } from '@revenge-mod/discord/design'
import { useEffect, useMemo, useState } from 'react'
import { Image, Text as RNText, StyleSheet, View } from 'react-native'
import { themesInternal } from '..'
import type { EntryKind } from '@revenge-mod/themes-api/store'
import type { ThemeBase } from '@revenge-mod/themes-api/types'
import type { ReactNode } from 'react'
import type { OptionEntry } from '../utils/kinds'

const {
	store: {
		fontRoleOf,
		previewColorsOf,
		previewEmojiOf,
		previewFontFamilyOf,
		previewIconsOf,
	},
} = themesInternal

const { Text, Stack, createStyles } = Design

interface ThemeContext {
	theme: string
}

// Untyped in @revenge-mod/types
const { getSemanticColorContextFromThemeContext, useThemeContext } =
	Design as unknown as {
		useThemeContext(): ThemeContext
		getSemanticColorContextFromThemeContext(context: ThemeContext): object
	}

/** Dominant colors distinguishing themes: blurple brand color, chat and card backgrounds, text, and link colors. */
const SwatchColors = [
	'BACKGROUND_BRAND',
	'BACKGROUND_BASE_LOW',
	'BACKGROUND_SURFACE_HIGHEST',
	'TEXT_STRONG',
	'TEXT_LINK',
]

const SwatchSize = 18

/** Bold font families requested by Discord, sorted by preference. */
export const BoldFontFamilies = [
	'ggsans-Bold',
	'ggsans-Semibold',
	'ggsans-ExtraBold',
]

/** Standard test emoji without variation selectors: 😀 😂 👍 🎉 🔥 🥺. */
const SampleEmoji = ['1f600', '1f602', '1f44d', '1f389', '1f525', '1f97a']

/** Vertical spacing between preview elements and preceding labels. */
export const PREVIEW_SPACING = 6

const EmojiSize = 20

const IconSize = 20

/** Maximum icons previewed for an icon pack. */
const PreviewIconCount = 6

const styles = StyleSheet.create({
	italic: {
		fontStyle: 'italic',
	},
	// Rows wrap on narrow viewports
	wrap: {
		flexWrap: 'wrap',
	},
	emojiRow: {
		flexWrap: 'wrap',
		// Preserves layout height during async emoji load
		minHeight: EmojiSize,
	},
	emoji: {
		width: EmojiSize,
		height: EmojiSize,
	},
})

const usePreviewStyles = createStyles({
	// Subtle border ensures light swatches remain visible against light backgrounds
	swatch: {
		width: SwatchSize,
		height: SwatchSize,
		borderRadius: SwatchSize / 2,
		borderWidth: 1,
		borderColor: Tokens.default.colors.BORDER_SUBTLE,
	},
	// Tints icons to match standard Discord icon styling
	icon: {
		width: IconSize,
		height: IconSize,
		tintColor: Tokens.default.colors.ICON_DEFAULT,
	},
})

/** Option description rendered with color swatches, font sample, icon row, or emoji preview below. */
export function subLabelOf(kind: EntryKind, option: OptionEntry): ReactNode {
	const preview =
		kind === 'themes' ? (
			<ColorSwatches
				plugin={option.plugin}
				group={option.group}
				id={option.id}
			/>
		) : kind === 'fontPacks' && option.plugin ? (
			<FontPreview option={option} />
		) : kind === 'iconPacks' && option.plugin ? (
			<IconPreview option={option} />
		) : kind === 'emojiPacks' ? (
			<EmojiPreview
				plugin={option.plugin}
				group={option.group}
				id={option.id}
			/>
		) : null

	if (!preview) return option.description

	return (
		<Stack spacing={PREVIEW_SPACING}>
			{Boolean(option.description) && (
				<Text variant="text-sm/medium" color="text-muted">
					{option.description}
				</Text>
			)}
			{preview}
		</Stack>
	)
}

/**
 * Resolves key colors for a theme (or Discord defaults when plugin is `null`) in the current base theme.
 * Resolves directly rather than using `useToken`, which caches colors and cannot resolve unselected themes.
 */
export function ColorSwatches({
	plugin,
	group,
	id,
}: {
	plugin: string | null
	group: string
	id: string
}) {
	const previewStyles = usePreviewStyles()
	const themeContext = useThemeContext()
	const colors = useMemo(() => {
		try {
			return previewColorsOf(
				plugin,
				group,
				id,
				themeContext.theme as ThemeBase,
				SwatchColors,
				getSemanticColorContextFromThemeContext(themeContext),
			)
		} catch {
			// Theme removed or getColors threw
		}
	}, [plugin, group, id, themeContext])

	if (!colors) return null

	return (
		<Stack direction="horizontal" spacing={4} style={styles.wrap}>
			{colors.map((color, index) => (
				<View
					key={SwatchColors[index]}
					style={[previewStyles.swatch, { backgroundColor: color }]}
				/>
			))}
		</Stack>
	)
}

/** Monospace font families, prioritizing code-editor styles first. */
const MonoFontFamilies = ['ggmono-Normal', 'SourceCodePro-Normal']

/**
 * Text sample in the pack's body font with bold and italic variants matching chat styling.
 * Monospace selections show code; individual fonts render directly in that single font.
 */
function FontPreview({ option }: { option: OptionEntry }) {
	const { plugin, group, id, role, family } = option
	const mono = (family ? fontRoleOf(family) : role) === 'mono'
	const families = useMemo(() => {
		try {
			if (family)
				return { body: previewFontFamilyOf(plugin!, group, id, [family]) }
			if (mono)
				return {
					body: previewFontFamilyOf(plugin!, group, id, MonoFontFamilies),
				}

			return {
				body: previewFontFamilyOf(plugin!, group, id),
				// Fall back to Discord bold if pack omits bold variant
				bold:
					previewFontFamilyOf(plugin!, group, id, BoldFontFamilies) ??
					BoldFontFamilies[0],
			}
		} catch {
			// Pack unavailable or native module inactive
		}
	}, [plugin, group, id, family, mono])

	if (!families?.body) return null

	const style = { fontFamily: families.body }

	if (!families.bold)
		return (
			<Text variant="text-md/normal" style={style}>
				{mono
					? 'const fox = jump(over, lazyDog) // 0O 1lI'
					: 'The quick brown fox jumps over the lazy dog'}
			</Text>
		)

	// Nested spans inherit text styling via React Native Text
	return (
		<Text variant="text-md/normal" style={style}>
			The quick <RNText style={{ fontFamily: families.bold }}>brown fox</RNText>{' '}
			<RNText style={styles.italic}>jumps over</RNText> the lazy dog
		</Text>
	)
}

/** Sample icons from an icon pack. Discord defaults omit previews since packs override assets by name. */
function IconPreview({ option }: { option: OptionEntry }) {
	const { plugin, group, id } = option
	const previewStyles = usePreviewStyles()
	const icons = useMemo(() => {
		try {
			return previewIconsOf(plugin!, group, id, PreviewIconCount)
		} catch {
			// Pack unavailable
		}
	}, [plugin, group, id])

	if (!icons?.length) return null

	return (
		<Stack direction="horizontal" spacing={8} style={styles.wrap}>
			{icons.map(([name, path]) => (
				<Image
					key={name}
					source={{ uri: `file://${path}` }}
					style={previewStyles.icon}
				/>
			))}
		</Stack>
	)
}

/** Preview Discord default emoji or pack emoji with Discord fallbacks. */
export function EmojiPreview({
	plugin,
	group,
	id,
	count = SampleEmoji.length,
}: {
	plugin: string | null
	group: string
	id: string
	/** Maximum sample emoji displayed. */
	count?: number
}) {
	const [paths, setPaths] = useState<(string | null)[]>()

	useEffect(() => {
		let current = true
		previewEmojiOf(plugin, group, id, SampleEmoji.slice(0, count)).then(
			result => current && setPaths(result),
			() => {},
		)
		return () => {
			current = false
		}
	}, [plugin, group, id, count])

	return (
		<Stack direction="horizontal" spacing={4} style={styles.emojiRow}>
			{paths?.map(
				(path, index) =>
					path && (
						<Image
							key={SampleEmoji[index]}
							source={{ uri: `file://${path}` }}
							style={styles.emoji}
						/>
					),
			)}
		</Stack>
	)
}
