import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { useEffect, useLayoutEffect, useState } from 'react'
import { ScrollView, StyleSheet, TurboModuleRegistry } from 'react-native'
import { useStore } from 'zustand/react'
import { themesInternal } from '..'
import { showErrorToast } from '../utils/toasts'
import type { BackgroundSettings } from '@revenge-mod/themes-api/types'
import type { TurboModule } from 'react-native'

const {
	Button,
	Slider,
	Stack,
	TableRadioGroup,
	TableRadioRow,
	TableRow,
	TableRowGroup,
	Text,
} = Design

const {
	store: {
		themesStore,
		themeBackgroundOf,
		setBackgroundSettings,
		importBackgroundImage,
	},
} = themesInternal

const styles = StyleSheet.create({
	content: {
		paddingBottom: 16,
	},
})

const MaxBlur = 25

// react-native-image-crop-picker, which Discord bundles for its own image uploads
interface ImageCropPicker extends TurboModule {
	openPicker(options: object): Promise<{ path: string }>
}

interface Props {
	navigation: {
		setOptions(options: object): void
	}
}

/** Overrides the color theme's background with a custom image or none, and tunes its opacity, blur and dimming. */
export default function RevengeThemesBackgroundSettingScreen({
	navigation,
}: Props) {
	const theme = useStore(themesStore, themeBackgroundOf)
	const settings = useStore(themesStore, s => s.selected.background)
	const source = settings?.source ?? 'theme'
	// The theme's values suit its own image only
	const base = source === 'theme' ? theme : undefined

	useLayoutEffect(() => {
		navigation.setOptions({ title: 'Background' })
	}, [navigation])

	const update = (patch: Partial<BackgroundSettings>) =>
		setBackgroundSettings({ source, ...settings, ...patch }).catch(
			showErrorToast,
		)

	const pickImage = async () => {
		const picker =
			TurboModuleRegistry.get<ImageCropPicker>('RNCImageCropPicker')
		if (!picker) throw new Error('Image picker is unavailable')

		let picked: { path: string }
		try {
			picked = await picker.openPicker({
				mediaType: 'photo',
				multiple: false,
				cropping: false,
				compressImageQuality: 1,
				forceJpg: false,
			})
		} catch (e) {
			if ((e as { code?: string }).code === 'E_PICKER_CANCELLED') return
			throw e
		}

		const path = await importBackgroundImage(picked.path)
		await setBackgroundSettings({ ...settings, source: 'custom', path })
	}

	const onPickImage = () => {
		pickImage().catch(showErrorToast)
	}

	return (
		<ScrollView contentContainerStyle={styles.content}>
			<Page spacing={24}>
				<TableRadioGroup<BackgroundSettings['source']>
					title="Image"
					value={source}
					onChange={next => {
						if (next === 'custom' && !settings?.path) onPickImage()
						else update({ source: next })
					}}
				>
					<TableRadioRow
						value="theme"
						label="From theme"
						subLabel={
							theme
								? 'Use the background provided by your color theme'
								: "Your color theme doesn't have a background"
						}
					/>
					<TableRadioRow
						value="custom"
						label="Custom image"
						subLabel="Use a custom image as the background"
					/>
					<TableRadioRow value="none" label="None" />
				</TableRadioGroup>
				{source === 'custom' && (
					<TableRowGroup>
						<TableRow
							label="Choose image"
							subLabel={settings?.path?.split('/').pop() ?? 'No image chosen'}
							arrow
							onPress={onPickImage}
						/>
					</TableRowGroup>
				)}
				{source !== 'none' && (
					<TableRowGroup title="Appearance">
						<SliderRow
							label="Opacity"
							value={settings?.opacity ?? base?.opacity ?? 1}
							min={0}
							max={1}
							step={0.05}
							format={value => `${Math.round(value * 100)}%`}
							onCommit={opacity => update({ opacity })}
						/>
						<SliderRow
							label="Blur"
							value={settings?.blur ?? base?.blur ?? 0}
							min={0}
							max={MaxBlur}
							step={1}
							format={value => `${Math.round(value)}`}
							onCommit={blur => update({ blur })}
						/>
						<SliderRow
							label="Dimming"
							value={settings?.dimming ?? base?.dimming ?? 0.7}
							min={0}
							max={1}
							step={0.05}
							format={value => `${Math.round(value * 100)}%`}
							onCommit={dimming => update({ dimming })}
						/>
					</TableRowGroup>
				)}
				{settings && (
					<Stack spacing={8}>
						<Button
							variant="secondary"
							text="Reset"
							onPress={() => setBackgroundSettings(null).catch(showErrorToast)}
						/>
						<Text variant="text-sm/medium" color="text-muted">
							Follow your color theme's background again.
						</Text>
					</Stack>
				)}
			</Page>
		</ScrollView>
	)
}

/** Slider that saves when released, showing its value while dragged. */
function SliderRow({
	label,
	value,
	min,
	max,
	step,
	format,
	onCommit,
}: {
	label: string
	value: number
	min: number
	max: number
	step: number
	format(value: number): string
	onCommit(value: number): void
}) {
	const [current, setCurrent] = useState(value)
	useEffect(() => setCurrent(value), [value])

	return (
		<TableRow
			label={label}
			trailing={
				<Text variant="text-sm/medium" color="text-muted">
					{format(current)}
				</Text>
			}
			subLabel={
				<Slider
					value={current}
					minimumValue={min}
					maximumValue={max}
					step={step}
					onValueChange={setCurrent}
					onSlidingComplete={onCommit}
				/>
			}
		/>
	)
}
