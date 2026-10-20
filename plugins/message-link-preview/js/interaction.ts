import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { getRecord, isLinked } from './cache'
import type { MessageRecord } from './types'

interface MessagesHandlersParams {
	getMessage(messageId: string): MessageRecord | undefined
}

// Chat events look up their message with params.getMessage, then use the message's own channel
export function patchMessagesHandlers(onUnsupported: () => void) {
	let restore: (() => void) | undefined

	const unsubscribe = getModules(
		// modules/messages/native/MessagesHandlers.tsx
		withProps<{ MessagesHandlers: { prototype: object } }>('MessagesHandlers'),
		({ MessagesHandlers: { prototype } }) => {
			const descriptor = Object.getOwnPropertyDescriptor(prototype, 'params')
			if (!descriptor?.get) return onUnsupported()

			const getParams = descriptor.get
			const wrapped = new WeakMap<object, MessagesHandlersParams>()

			Object.defineProperty(prototype, 'params', {
				...descriptor,
				get() {
					const params: MessagesHandlersParams = getParams.call(this)
					if (!params || typeof params !== 'object') return params

					let result = wrapped.get(params)

					if (!result) {
						result = Object.create(params) as MessagesHandlersParams
						result.getMessage = messageId =>
							params.getMessage(messageId) ??
							(isLinked(messageId) ? getRecord(messageId) : undefined)
						wrapped.set(params, result)
					}

					return result
				},
			})

			restore = () => Object.defineProperty(prototype, 'params', descriptor)
		},
	)

	return () => {
		unsubscribe()
		restore?.()
	}
}
