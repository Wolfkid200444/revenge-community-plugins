import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { before, instead } from '@revenge-mod/patcher'
import { useSyncExternalStore } from 'react'
import type { PreInitPluginApi } from '@revenge-mod/plugins/types'
import type { FC } from 'react'
import type { DiscordColors, ThemeBase, ThemeColors } from './types'

type PluginCleanupApi = PreInitPluginApi['cleanup']

interface SemanticColorContext {
	isProfileTheme?: boolean
	gradient?: { customThemeSettings?: object } | null
}

/** Custom theme settings for backgrounds where gradients keep theme colors. */
export const ownGradientSettings = new WeakSet<object>()

// ../discord_common/js/packages/tokens/native.tsx
interface TokensModule {
	RawColor: Record<string, string>
	SemanticColor: Record<string, unknown>
	default: {
		/** Opaque tokens by semantic name, what `resolveSemanticColor` takes. `SemanticColor` holds their definitions. */
		colors: Record<string, object>
		internal: {
			getSemanticColorName(color: object): string
			resolveSemanticColor(
				theme: ThemeBase,
				color: object,
				context?: SemanticColorContext,
			): string
		}
	}
}

let colors: ThemeColors | undefined
let rawColors: Record<string, string> | undefined
let tokensModule: TokensModule | undefined
/** Original raw colors replaced by {@link colors}. */
const rawOriginals: Record<string, string> = {}

/**
 * Patches Discord color tokens, immediately or once module initializes. Clean up with {@link cleanup}.
 * Raw colors restore with other selections in `unloadSelections`.
 */
export function patchColorTokens(cleanup: PluginCleanupApi) {
	cleanup(
		getModules(
			withProps<TokensModule>('RawColor', 'SemanticColor'),
			tokens => {
				tokensModule = tokens
				// Shared object resolveSemanticColor reads raw colors from
				rawColors = tokens.RawColor
				applyRawColors()

				const { internal } = tokens.default
				cleanup(
					instead(internal, 'resolveSemanticColor', (args, original) => {
						const [theme, color, context] = args
						const gradient = context?.gradient
						// User-picked colors for profile themes, and Discord's gradient themes
						if (
							colors?.semantic &&
							!context?.isProfileTheme &&
							(!gradient ||
								(gradient.customThemeSettings !== undefined &&
									ownGradientSettings.has(gradient.customThemeSettings)))
						) {
							const name = internal.getSemanticColorName(color)
							const value = colors.semantic[theme]?.[name]
							if (value) return value
						}

						return Reflect.apply(original, internal, args)
					}),
				)
			},
			{ cached: true },
		),
	)
}

/**
 * Resolves semantic colors as {@link preview} would, without applying them. Pass `undefined` to preview Discord's colors.
 *
 * @param names Semantic color names, such as `BACKGROUND_BRAND`.
 * @param context Discord's semantic color context, such as contrast and saturation settings.
 * @returns `undefined` before Discord's tokens initialize.
 */
export function resolvePreviewColors(
	preview: ThemeColors | undefined,
	theme: ThemeBase,
	names: string[],
	context?: SemanticColorContext,
) {
	if (!tokensModule) return

	const { colors: tokens, internal } = tokensModule.default
	const current = colors
	setThemeColors(preview)
	try {
		return names.map(name =>
			internal.resolveSemanticColor(theme, tokens[name]!, context),
		)
	} finally {
		setThemeColors(current)
	}
}

/** Resolves an active semantic color, or `undefined` before Discord's tokens initialize. */
export function resolveSemanticColor(theme: ThemeBase, name: string) {
	if (!tokensModule) return

	const { colors: tokens, internal } = tokensModule.default
	const token = tokens[name]
	if (token) return internal.resolveSemanticColor(theme, token)
}

/** Discord's colors without overrides, or `undefined` if Discord's module hasn't initialized. */
export function discordColors(): DiscordColors | undefined {
	if (rawColors) return { raw: { ...rawColors, ...rawOriginals } }
}

interface RootThemeContextProviderProps {
	enabledExperiments?: string[]
}

interface RootThemeContextModule {
	RootThemeContextProvider: FC<RootThemeContextProviderProps>
	DisableCustomTheme: unknown
}

/** Increments when colors or icons change at runtime. Invalidates theme context cache. */
let colorsVersion = 0
const versionListeners = new Set<() => void>()
const noExperiments: string[] = []
const versionedExperiments = new WeakMap<
	string[],
	{ version: number; value: string[] }
>()

/**
 * Wraps Discord root theme context provider so {@link refreshThemedComponents} supplies a new key.
 * Injects key into `enabledExperiments`, which nested theme providers inherit from root.
 */
export function patchThemeContext(cleanup: PluginCleanupApi) {
	cleanup(
		getModules(
			withProps<RootThemeContextModule>(
				'RootThemeContextProvider',
				'DisableCustomTheme',
			),
			module => {
				cleanup(
					before(module, 'RootThemeContextProvider', args => {
						const version = useSyncExternalStore(
							subscribeColorsVersion,
							getColorsVersion,
						)

						const [props] = args

						props.enabledExperiments = experimentsWithVersion(
							props.enabledExperiments ?? noExperiments,
							version,
						)

						return args
					}),
				)
			},
			{ cached: true },
		),
	)
}

/** Re-renders themed components with active colors and icons. */
export function refreshThemedComponents() {
	colorsVersion++
	for (const listener of versionListeners) listener()
}

function subscribeColorsVersion(listener: () => void) {
	versionListeners.add(listener)
	return () => {
		versionListeners.delete(listener)
	}
}

function getColorsVersion() {
	return colorsVersion
}

const KeyPrefix = 'revenge-themes-colors:'

// Same array for same input, so context only changes when version increments.
function experimentsWithVersion(experiments: string[], version: number) {
	const cached = versionedExperiments.get(experiments)
	if (cached?.version === version) return cached.value

	const value = [
		...experiments.filter(name => !name.startsWith(KeyPrefix)),
		`${KeyPrefix}${version}`,
	]

	versionedExperiments.set(experiments, { version, value })
	return value
}

/** Updates active colors for future resolutions. Rendered components keep existing colors until {@link refreshThemedComponents}. */
export function setThemeColors(next: ThemeColors | undefined) {
	restoreRawColors()
	colors = next
	applyRawColors()
}

function applyRawColors() {
	if (!rawColors || !colors?.raw) return

	for (const [name, value] of Object.entries(colors.raw)) {
		if (!(name in rawColors)) continue
		rawOriginals[name] ??= rawColors[name]!
		rawColors[name] = value
	}
}

function restoreRawColors() {
	if (!rawColors) return

	for (const name in rawOriginals) {
		rawColors[name] = rawOriginals[name]!
		delete rawOriginals[name]
	}
}
