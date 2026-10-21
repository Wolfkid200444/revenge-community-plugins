import { Stores } from '@revenge-mod/discord/flux'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import { noop } from '@revenge-mod/utils/callback'
import { useSyncExternalStore } from 'react'
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native'
import {
	ownGradientSettings,
	ownGradients,
	resolveSemanticColor,
	SurfaceColor,
} from './colors'
import { activeBackgroundOf, themesStore } from './store'
import type { PreInitPluginApi } from '@revenge-mod/plugins/types'
import type { FunctionComponent } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import type { ActiveBackground } from './store'
import type { ThemeBase } from './types'

type PluginCleanupApi = PreInitPluginApi['cleanup']

interface CustomThemeSettings {
	colors: string[]
	gradientColorStops: number[]
	gradientAngle: number
	baseMix: number
}

interface CustomThemeDisplaySettings {
	baseTheme: ThemeBase
	customTheme: CustomThemeSettings
}

// ../discord_app/modules/client_themes/native/ClientThemesUtils.tsx
interface GradientMetadataModule {
	getGradientThemeMetadata(
		theme: ThemeBase,
		gradient?: { customThemeSettings?: object } | null,
	): object | null
}

// ../discord_app/modules/client_themes/native/useCustomThemeDisplaySettings.tsx
interface CustomThemeDisplaySettingsModule {
	useCustomThemeDisplaySettings(
		...args: unknown[]
	): CustomThemeDisplaySettings | undefined
}

// ../discord_app/modules/client_themes/native/useActiveTheme.tsx
interface ActiveThemeModule {
	useIsClientThemeOrCustomThemeActive(): boolean
	useActiveThemeType: unknown
}

interface ThemedGradientProps {
	absolute?: boolean
	/** Window width, past the container. Screen-aligned layers shift the container to line up with the screen. */
	wide?: boolean
	/** Window height, past the container. */
	tall?: boolean
	/** Matches the gradient under a dimmed surface, for layers drawn above one (channel list, home drawer mask). */
	mix?: boolean
	style?: StyleProp<ViewStyle>
	/** Specific gradient to draw, such as a theme picker swatch. */
	gradientOverride?: unknown
}

interface ThemeStore {
	theme: ThemeBase
	addChangeListener(listener: () => void): void
	removeChangeListener(listener: () => void): void
}

// ../discord_app/modules/client_themes/native/ThemedGradient.tsx
interface ThemedGradientModule {
	default: FunctionComponent<ThemedGradientProps>
	CustomThemedGradient: unknown
	validateColors: unknown
}

/** How much the gradient tints Discord's surfaces, from 0 to 100. */
const BaseMix = 100

// ../discord_app/modules/client_themes/native/ClientThemesUtils.tsx: surfaces mix the gradient at
// 0.12 + 0.2 * baseMix (0.3 in light) over black (white in light)
const GradientWeight = {
	dark: 0.12 + 0.2 * (BaseMix / 100),
	light: 0.3 + 0.2 * (BaseMix / 100),
}

let displaySettings:
	| {
			background: ActiveBackground
			baseTheme: ThemeBase
			surface: string
			value: CustomThemeDisplaySettings
	  }
	| undefined

/**
 * Renders active theme background through Discord's custom gradient theme pipeline.
 * Surfaces turn translucent and gradient layers draw the image.
 * Discord custom themes, previews, and server themes take precedence.
 */
export function patchBackgrounds(
	cleanup: PluginCleanupApi,
	startedLate: boolean,
) {
	const useBackgroundUpdates = startedLate
		? // Avoids late patching that alters hook count or call order after initial render
			noop
		: () => useSyncExternalStore(themesStore.subscribe, activeBackground)

	cleanup(
		getModules(
			withProps<GradientMetadataModule>('getGradientThemeMetadata'),
			module => {
				// Semantic color contexts get the metadata, without customThemeSettings
				cleanup(
					instead(
						module,
						'getGradientThemeMetadata',
						function (args, original) {
							const result = Reflect.apply(original, this, args)
							const settings = args[1]?.customThemeSettings
							const dimming = settings && ownGradientSettings.get(settings)
							if (result && dimming !== undefined)
								ownGradients.set(result, dimming)
							return result
						},
					),
				)
			},
			{ cached: true },
		),
		getModules(
			withProps<CustomThemeDisplaySettingsModule>(
				'useCustomThemeDisplaySettings',
			),
			module => {
				cleanup(
					instead(module, 'useCustomThemeDisplaySettings', (args, orig) => {
						useBackgroundUpdates()
						const value = orig(...args)
						return value ?? backgroundDisplaySettings()
					}),
				)
			},
			{ cached: true },
		),
		getModules(
			withProps<ThemedGradientModule>('CustomThemedGradient', 'validateColors'),
			module => {
				cleanup(
					instead(module, 'default', (args, Original) => {
						const [props] = args

						const background = useSyncExternalStore(
							themesStore.subscribe,
							activeBackground,
						)
						const theme = useSyncExternalStore(
							subscribeThemeStore,
							currentTheme,
						)
						const { width, height } = useWindowDimensions()

						if (!background || props.gradientOverride != null)
							return <Original {...props} />

						// Mixed layers look like the image under a dimmed surface, which is the surface color at dimming over the image
						const light = theme === 'light'
						const weight = props.mix ? 1 - background.dimming : 1

						return (
							<View
								pointerEvents="none"
								style={[
									props.absolute ? StyleSheet.absoluteFill : props.style,
									props.wide && { width },
									props.tall && { height },
									{
										backgroundColor:
											resolveSemanticColor(theme, SurfaceColor) ??
											(light ? '#ffffff' : '#000000'),
										overflow: 'hidden',
									},
								]}
							>
								{/* Matches window dimensions so multi-layer crops align */}
								<Image
									source={{ uri: background.uri }}
									blurRadius={background.blur}
									resizeMode="cover"
									style={{
										position: 'absolute',
										top: 0,
										left: 0,
										width,
										height,
										opacity: weight * (background.opacity ?? 1),
									}}
								/>
							</View>
						)
					}),
				)
			},
			{ cached: true },
		),
		getModules(
			withProps<ActiveThemeModule>(
				'useIsClientThemeOrCustomThemeActive',
				'useActiveThemeType',
			),
			module => {
				// Discord only checks saved custom themes, excluding active previews
				cleanup(
					instead(
						module,
						'useIsClientThemeOrCustomThemeActive',
						(args, orig) => {
							useBackgroundUpdates()
							const active = orig(...args)
							return active || activeBackground() !== undefined
						},
					),
				)
			},
			{ cached: true },
		),
	)
}

function activeBackground() {
	return activeBackgroundOf(themesStore.getState())
}

function themeStore() {
	return Stores.ThemeStore as unknown as ThemeStore
}

function subscribeThemeStore(listener: () => void) {
	themeStore().addChangeListener(listener)
	return () => themeStore().removeChangeListener(listener)
}

function currentTheme() {
	return themeStore().theme
}

/** Custom theme settings applied while background is active. Caches result until inputs change. */
function backgroundDisplaySettings() {
	const state = themesStore.getState()
	const background = activeBackgroundOf(state)
	if (!background) return

	const baseTheme = currentTheme()
	const surface = resolveSemanticColor(baseTheme, SurfaceColor)
	if (!surface || !/^#[0-9a-f]{6}/i.test(surface)) return

	if (
		displaySettings?.background === background &&
		displaySettings.baseTheme === baseTheme &&
		displaySettings.surface === surface
	)
		return displaySettings.value

	const customTheme: CustomThemeSettings = {
		colors: [gradientColorFor(surface, baseTheme === 'light')],
		gradientColorStops: [],
		gradientAngle: 0,
		baseMix: BaseMix,
	}
	ownGradientSettings.set(customTheme, background.dimming)

	displaySettings = {
		background,
		baseTheme,
		surface,
		value: { baseTheme, customTheme },
	}
	return displaySettings.value
}

/** Calculates gradient color whose mix renders as theme surface color. */
function gradientColorFor(surface: string, light: boolean) {
	const weight = light ? GradientWeight.light : GradientWeight.dark
	const overlay = light ? 255 : 0

	let hex = '#'
	for (let i = 1; i < 7; i += 2) {
		const value = Number.parseInt(surface.slice(i, i + 2), 16)
		const channel = Math.round((value - (1 - weight) * overlay) / weight)
		hex += Math.min(255, Math.max(0, channel)).toString(16).padStart(2, '0')
	}

	return hex
}
