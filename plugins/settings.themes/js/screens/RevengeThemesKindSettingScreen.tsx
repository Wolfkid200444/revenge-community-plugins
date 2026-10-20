import { getAssetIdByName } from '@revenge-mod/assets'
import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { useLayoutEffect } from 'react'
import { OptionList } from '../components/OptionList'
import { RouteNames, Setting } from '../constants'
import { FontRoleLabels, Kinds, useKindSections } from '../utils/kinds'
import type { KindRouteParams } from '../types'

const { IconButton } = Design

const SettingsIcon = getAssetIdByName('SettingsIcon')!

interface Props {
	navigation: {
		setOptions(options: object): void
		navigate(route: string): void
	}
	route: { params: KindRouteParams }
}

/**
 * Displays Discord defaults and previews for every group providing this theme kind.
 * Font packs provide an action bar shortcut to granular font management.
 */
export default function RevengeThemesKindSettingScreen({
	navigation,
	route: {
		params: { kind, role },
	},
}: Props) {
	const sections = useKindSections(kind, role)
	const { tab, empty } = Kinds[kind]
	const title = role ? FontRoleLabels[role] : tab
	const individualFonts = kind === 'fontPacks' && !role

	const settings = individualFonts
		? { label: 'Individual fonts', route: Setting.RevengeThemesFontFamilies }
		: kind === 'themes'
			? { label: 'Background', route: Setting.RevengeThemesBackground }
			: undefined

	useLayoutEffect(() => {
		navigation.setOptions({
			title,
			headerRight: settings
				? () => (
						<IconButton
							style={{ marginInlineEnd: 8 }}
							size="sm"
							variant="secondary"
							icon={SettingsIcon}
							accessibilityLabel={settings.label}
							onPress={() => navigation.navigate(RouteNames[settings.route])}
						/>
					)
				: undefined,
		})
	}, [navigation, title, settings?.route])

	return (
		<Page>
			<OptionList
				kind={kind}
				sections={sections}
				// Only Discord's option
				empty={sections.length === 1 ? empty : undefined}
			/>
		</Page>
	)
}
