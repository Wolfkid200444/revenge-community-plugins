import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { useLayoutEffect } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import ReloadButton from '../components/ReloadButton'
import { RouteNames, Setting } from '../constants'
import { useFontFamilies } from '../utils/fonts'
import { FontRoleLabels, FontRoles, useFontRolePickNames } from '../utils/kinds'
import type { FontRole } from '@revenge-mod/themes-api/types'
import type { FontFamilyRouteParams, KindRouteParams } from '../types'

const { TableRow, TableRowGroup, Text } = Design

const styles = StyleSheet.create({
	content: {
		paddingBottom: 16,
	},
})

/** Font roles, followed by individual standalone families such as display fonts. */
const Sections: (FontRole | undefined)[] = [...FontRoles, undefined]

interface Props {
	navigation: {
		setOptions(options: object): void
		navigate(route: string, params: object): void
	}
}

/** Granular font management view showing role-based pack selections and individual font overrides. */
export default function RevengeThemesFontFamiliesSettingScreen({
	navigation,
}: Props) {
	const families = useFontFamilies()
	const rolePicks = useFontRolePickNames()

	useLayoutEffect(() => {
		navigation.setOptions({ title: 'Individual fonts' })
	}, [navigation])

	return (
		<ScrollView contentContainerStyle={styles.content}>
			<Page>
				<ReloadButton />
				<Text variant="text-sm/medium" color="text-muted">
					Pick sans serif and monospace fonts apart, or each font Discord uses
					from any font pack. Only fonts some pack provides are listed. Fonts
					apply after a reload.
				</Text>
				{Sections.map(role => {
					const entries = families.get(role) ?? []
					// Roles always show, saying when nothing provides them
					if (!role && !entries.length) return null

					return (
						<TableRowGroup
							key={role ?? 'other'}
							title={role ? FontRoleLabels[role] : 'Other'}
						>
							{role && !entries.length && (
								<TableRow
									label={`No ${FontRoleLabels[role].toLowerCase()} fonts installed`}
									subLabel={`Install a font pack with ${FontRoleLabels[role].toLowerCase()} fonts to pick them here. Discord's are used until then.`}
									disabled
								/>
							)}
							{role && entries.length > 0 && (
								<TableRow
									label={`All ${FontRoleLabels[role].toLowerCase()} fonts`}
									subLabel={rolePicks[role]}
									arrow
									onPress={() =>
										navigation.navigate(RouteNames[Setting.RevengeThemesKind], {
											kind: 'fontPacks',
											role,
										} satisfies KindRouteParams)
									}
								/>
							)}
							{entries.map(({ family, packName }) => (
								<TableRow
									key={family}
									label={family}
									subLabel={packName ?? 'Discord'}
									arrow
									onPress={() =>
										navigation.navigate(
											RouteNames[Setting.RevengeThemesFontFamily],
											{
												family,
											} satisfies FontFamilyRouteParams,
										)
									}
								/>
							))}
						</TableRowGroup>
					)
				})}
			</Page>
		</ScrollView>
	)
}
