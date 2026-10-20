import type { EntryKind } from '@revenge-mod/themes-api/store'
import type { FontRole } from '@revenge-mod/themes-api/types'

export interface KindRouteParams {
	kind: EntryKind
	/** For font packs, lists those providing this role, picked for it alone. */
	role?: FontRole
}

export interface GroupRouteParams {
	kind: EntryKind
	plugin: string
	group: string
	/** The font role the group's packs are picked for. */
	role?: FontRole
}

export interface FontFamilyRouteParams {
	family: string
}
