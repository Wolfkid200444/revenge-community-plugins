import { ToastActionCreators } from '@revenge-mod/discord/actions'

export function showErrorToast(e: unknown) {
	ToastActionCreators.open('REVENGE_THEMES_ERROR', {
		text: e instanceof Error ? e.message : String(e),
		variant: 'critical',
	})
}
