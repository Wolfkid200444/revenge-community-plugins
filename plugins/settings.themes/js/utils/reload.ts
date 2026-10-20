import { useSyncExternalStore } from 'react'

let reloadNeeded = false
const listeners = new Set<() => void>()

export function markReloadNeeded() {
	if (reloadNeeded) return
	reloadNeeded = true
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function useReloadNeeded() {
	return useSyncExternalStore(subscribe, () => reloadNeeded)
}
