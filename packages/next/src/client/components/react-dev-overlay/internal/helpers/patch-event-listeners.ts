import {
  handleClientError,
  rejectionQueue,
  rejectionHandlers,
} from './use-error-handler'

import { isNextRouterError } from '../../../is-next-router-error'

let isPatched = false
function patchEventListeners() {
  // Ensure it's only patched once
  if (isPatched || typeof window === 'undefined') return
  isPatched = true

  // These event handlers must be added outside of the hook because there is no
  // guarantee that the hook will be alive in a mounted component in time to
  // when the errors occur.
  // uncaught errors go through reportError
  window.addEventListener(
    'error',
    (event: WindowEventMap['error']): void | boolean => {
      console.log('window.onerror', event.error)
      if (isNextRouterError(event.error)) {
        event.preventDefault()
        return false
      }
      handleClientError(event.error)
    }
  )

  window.addEventListener(
    'unhandledrejection',
    (ev: WindowEventMap['unhandledrejection']): void => {
      const reason = ev?.reason
      console.log('window.onunhandledrejection', reason)
      if (isNextRouterError(reason)) {
        ev.preventDefault()
        return
      }

      if (
        !reason ||
        !(reason instanceof Error) ||
        typeof reason.stack !== 'string'
      ) {
        // A non-error was thrown, we don't have anything to show. :-(
        return
      }

      const e = reason
      rejectionQueue.push(e)
      for (const handler of rejectionHandlers) {
        handler(e)
      }
    }
  )
}

patchEventListeners()
