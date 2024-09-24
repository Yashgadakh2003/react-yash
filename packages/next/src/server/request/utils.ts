function hangForever() {}

/**
 * This function constructs a promise that will never resolve. This is primarily
 * useful for dynamicIO where we use promise resolution timing to determine which
 * parts of a render can be included in a prerender.
 *
 * @internal
 */
export function makeHangingPromise<T>(): Promise<T> {
  return new Promise(hangForever)
}

/**
 * React annotates Promises with extra properties to make unwrapping them synchronous
 * after they have resolved. We sometimes create promises that are compatible with this
 * internal implementation detail when we want to construct a promise that is already resolved.
 *
 * @internal
 */
export function makeResolvedReactPromise<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value)
  ;(promise as any).status = 'fulfilled'
  ;(promise as any).value = value
  return promise
}
