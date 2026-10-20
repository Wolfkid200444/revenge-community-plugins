import Page from '@revenge-mod/components/Page'
import { useLayoutEffect } from 'react'
import { OptionList } from '../components/OptionList'
import { useFontFamilySections } from '../utils/fonts'
import type { FontFamilyRouteParams } from '../types'

interface Props {
	navigation: { setOptions(options: object): void }
	route: { params: FontFamilyRouteParams }
}

/** Options for a specific font family: Discord default followed by providing packs. */
export default function RevengeThemesFontFamilySettingScreen({
	navigation,
	route: {
		params: { family },
	},
}: Props) {
	const sections = useFontFamilySections(family)

	useLayoutEffect(() => {
		navigation.setOptions({ title: family })
	}, [navigation, family])

	return (
		<Page>
			<OptionList kind="fontPacks" sections={sections} />
		</Page>
	)
}
