import type { StaticGenerationStore } from '../../client/components/static-generation-async-storage.external'

import { ReflectAdapter } from '../web/spec-extension/adapters/reflect'
import {
  abortAndThrowOnSynchronousDynamicDataAccess,
  throwToInterruptStaticGeneration,
  postponeWithTracking,
} from '../app-render/dynamic-rendering'

import {
  prerenderAsyncStorage,
  type PrerenderStore,
} from '../app-render/prerender-async-storage.external'
import { InvariantError } from '../../shared/lib/invariant-error'
import { StaticGenBailoutError } from '../../client/components/static-generation-bailout'
import { makeHangingPromise, makeResolvedReactPromise } from './utils'
import type { FallbackRouteParams } from './fallback-params'

export type Params = Record<string, string | Array<string> | undefined>

/**
 * In this version of Next.js the `params` prop passed to Layouts, Pages, and other Segments is a Promise.
 * However to facilitate migration to this new Promise type you can currently still access params directly on the Promise instance passed to these Segments.
 * The `UnsafeUnwrappedParams` type is available if you need to temporarily access the underlying params without first awaiting or `use`ing the Promise.
 *
 * In a future version of Next.js the `params` prop will be a plain Promise and this type will be removed.
 *
 * Typically instances of `params` can be updated automatically to be treated as a Promise by a codemod published alongside this Next.js version however if you
 * have not yet run the codemod of the codemod cannot detect certain instances of `params` usage you should first try to refactor your code to await `params`.
 *
 * If refactoring is not possible but you still want to be able to access params directly without typescript errors you can cast the params Promise to this type
 *
 * ```tsx
 * type Props = { params: Promise<{ id: string }>}
 *
 * export default async function Layout(props: Props) {
 *  const directParams = (props.params as unknown as UnsafeUnwrappedParams<typeof props.params>)
 *  return ...
 * }
 * ```
 *
 * This type is marked deprecated to help identify it as target for refactoring away.
 *
 * @deprecated
 */
export type UnsafeUnwrappedParams<P> =
  P extends Promise<infer U> ? Omit<U, 'then' | 'status' | 'value'> : never

export function createPrerenderParamsFromClient(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
) {
  return createPrerenderParams(underlying, staticGenerationStore)
}

export function createRenderParamsFromClient(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
) {
  return createRenderParams(underlying, staticGenerationStore)
}

// generateMetadata always runs in RSC context so it is equivalent to a Server Page Component
export type CreateServerParamsForMetadata = typeof createServerParamsForMetadata
export const createServerParamsForMetadata = createServerParamsForServerSegment

// routes always runs in RSC context so it is equivalent to a Server Page Component
export function createServerParamsForRoute(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
) {
  if (staticGenerationStore.isStaticGeneration) {
    return createPrerenderParams(underlying, staticGenerationStore)
  } else {
    return createRenderParams(underlying, staticGenerationStore)
  }
}

export function createServerParamsForServerSegment(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
): Promise<Params> {
  if (staticGenerationStore.isStaticGeneration) {
    return createPrerenderParams(underlying, staticGenerationStore)
  } else {
    return createRenderParams(underlying, staticGenerationStore)
  }
}

export function createPrerenderParamsForClientSegment(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
): Promise<Params> {
  const prerenderStore = prerenderAsyncStorage.getStore()
  if (prerenderStore) {
    if (prerenderStore.controller || prerenderStore.cacheSignal) {
      const fallbackParams = staticGenerationStore.fallbackRouteParams
      if (fallbackParams) {
        for (let key in underlying) {
          if (fallbackParams.has(key)) {
            // This params object has one of more fallback params so we need to consider
            // the awaiting of this params object "dynamic". Since we are in dynamicIO mode
            // we encode this as a promise that never resolves
            return makeHangingPromise()
          }
        }
      }
    }
  }
  // We're prerendering in a mode that does not abort. We resolve the promise without
  // any tracking because we're just transporting a value from server to client where the tracking
  // will be applied.
  return makeResolvedReactPromise(underlying)
}

function createPrerenderParams(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
): Promise<Params> {
  const fallbackParams = staticGenerationStore.fallbackRouteParams
  if (fallbackParams) {
    let hasSomeFallbackParams = false
    for (const key in underlying) {
      if (fallbackParams.has(key)) {
        hasSomeFallbackParams = true
        break
      }
    }

    if (hasSomeFallbackParams) {
      // params need to be treated as dynamic because we have at least one fallback param
      const prerenderStore = prerenderAsyncStorage.getStore()
      if (prerenderStore) {
        if (prerenderStore.controller || prerenderStore.cacheSignal) {
          // We are in a dynamicIO (PPR or otherwise) prerender
          return makeAbortingExoticParams(
            underlying,
            staticGenerationStore.route,
            prerenderStore
          )
        }
      }
      // We aren't in a dynamicIO prerender but we do have fallback params at this
      // level so we need to make an erroring exotic params object which will postpone
      // if you access the fallback params
      return makeErroringExoticParams(
        underlying,
        fallbackParams,
        staticGenerationStore,
        prerenderStore
      )
    }
  }

  // We don't have any fallback params so we have an entirely static safe params object
  return makeUntrackedExoticParams(underlying)
}

function createRenderParams(
  underlying: Params,
  staticGenerationStore: StaticGenerationStore
): Promise<Params> {
  if (process.env.NODE_ENV === 'development') {
    return makeDynamicallyTrackedExoticParamsWithDevWarnings(
      underlying,
      staticGenerationStore
    )
  } else {
    return makeUntrackedExoticParams(underlying)
  }
}

interface CacheLifetime {}
const CachedParams = new WeakMap<CacheLifetime, Promise<Params>>()

function makeAbortingExoticParams(
  underlying: Params,
  route: string,
  prerenderStore: PrerenderStore
): Promise<Params> {
  const cachedParams = CachedParams.get(underlying)
  if (cachedParams) {
    return cachedParams
  }

  const promise = makeHangingPromise<Params>()
  CachedParams.set(underlying, promise)

  Object.keys(underlying).forEach((prop) => {
    switch (prop) {
      case 'then':
      case 'status': {
        // We can't assign params over these properties because the VM and React use
        // them to reason about the Promise.
        break
      }
      default: {
        Object.defineProperty(promise, prop, {
          get() {
            const expression = describeStringPropertyAccess(prop)
            abortAndThrowOnSynchronousDynamicDataAccess(
              route,
              expression,
              prerenderStore
            )
          },
          set(newValue) {
            Object.defineProperty(promise, prop, {
              value: newValue,
              writable: true,
              enumerable: true,
            })
          },
          enumerable: true,
          configurable: true,
        })
      }
    }
  })

  return promise
}

function makeErroringExoticParams(
  underlying: Params,
  fallbackParams: FallbackRouteParams,
  staticGenerationStore: StaticGenerationStore,
  prerenderStore: undefined | PrerenderStore
): Promise<Params> {
  const cachedParams = CachedParams.get(underlying)
  if (cachedParams) {
    return cachedParams
  }

  const augmentedUnderlying = { ...underlying }

  // We don't use makeResolvedReactPromise here because params
  // supports copying with spread and we don't want to unnecessarily
  // instrument the promise with spreadable properties of ReactPromise.
  const promise = Promise.resolve(augmentedUnderlying)
  CachedParams.set(underlying, promise)

  Object.keys(underlying).forEach((prop) => {
    switch (prop) {
      case 'then':
      case 'status':
      case 'value': {
        // We can't assign params over these properties because the VM and React use
        // them to reason about the Promise.
        break
      }
      default: {
        if (fallbackParams.has(prop)) {
          Object.defineProperty(augmentedUnderlying, prop, {
            get() {
              const expression = describeStringPropertyAccess(prop)
              if (staticGenerationStore.dynamicShouldError) {
                throwWithStaticGenerationBailoutError(
                  staticGenerationStore.route,
                  expression
                )
              } else if (prerenderStore) {
                postponeWithTracking(
                  staticGenerationStore.route,
                  expression,
                  prerenderStore.dynamicTracking
                )
              } else {
                throwToInterruptStaticGeneration(
                  expression,
                  staticGenerationStore
                )
              }
            },
            enumerable: true,
          })
          Object.defineProperty(promise, prop, {
            get() {
              const expression = describeStringPropertyAccess(prop)
              if (staticGenerationStore.dynamicShouldError) {
                throwWithStaticGenerationBailoutError(
                  staticGenerationStore.route,
                  expression
                )
              } else if (prerenderStore) {
                postponeWithTracking(
                  staticGenerationStore.route,
                  expression,
                  prerenderStore.dynamicTracking
                )
              } else {
                throwToInterruptStaticGeneration(
                  expression,
                  staticGenerationStore
                )
              }
            },
            set(newValue) {
              Object.defineProperty(promise, prop, {
                value: newValue,
                writable: true,
                enumerable: true,
              })
            },
            enumerable: true,
            configurable: true,
          })
        } else {
          ;(promise as any)[prop] = underlying[prop]
        }
      }
    }
  })

  return promise
}

function makeUntrackedExoticParams(underlying: Params): Promise<Params> {
  const cachedParams = CachedParams.get(underlying)
  if (cachedParams) {
    return cachedParams
  }

  // We don't use makeResolvedReactPromise here because params
  // supports copying with spread and we don't want to unnecessarily
  // instrument the promise with spreadable properties of ReactPromise.
  const promise = Promise.resolve(underlying)
  CachedParams.set(underlying, promise)

  Object.keys(underlying).forEach((prop) => {
    switch (prop) {
      case 'then':
      case 'value':
      case 'status': {
        // These properties cannot be shadowed with a search param because they
        // are necessary for ReactPromise's to work correctly with `use`
        break
      }
      default: {
        ;(promise as any)[prop] = underlying[prop]
      }
    }
  })

  return promise
}

function makeDynamicallyTrackedExoticParamsWithDevWarnings(
  underlying: Params,
  store: StaticGenerationStore
): Promise<Params> {
  const cachedParams = CachedParams.get(underlying)
  if (cachedParams) {
    return cachedParams
  }

  // We don't use makeResolvedReactPromise here because params
  // supports copying with spread and we don't want to unnecessarily
  // instrument the promise with spreadable properties of ReactPromise.
  const promise = Promise.resolve(underlying)

  const proxiedProperties = new Set<string>()
  const unproxiedProperties: Array<string> = []

  Object.keys(underlying).forEach((prop) => {
    switch (prop) {
      case 'then':
      case 'value':
      case 'status': {
        // These properties cannot be shadowed with a search param because they
        // are necessary for ReactPromise's to work correctly with `use`
        unproxiedProperties.push(prop)
        break
      }
      default: {
        proxiedProperties.add(prop)
        ;(promise as any)[prop] = underlying[prop]
      }
    }
  })

  const proxiedPromise = new Proxy(promise, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        if (
          // We are accessing a property that was proxied to the promise instance
          proxiedProperties.has(prop)
        ) {
          const expression = describeStringPropertyAccess(prop)
          warnForSyncAccess(store.route, expression)
        }
      }
      return ReflectAdapter.get(target, prop, receiver)
    },
    ownKeys(target) {
      warnForEnumeration(store.route, unproxiedProperties)
      return Reflect.ownKeys(target)
    },
  })

  CachedParams.set(underlying, proxiedPromise)
  return proxiedPromise
}

function warnForSyncAccess(route: undefined | string, expression: string) {
  const prefix = route ? ` In route ${route} a ` : 'A '
  console.error(
    `${prefix}param property was accessed directly with ${expression}. \`params\` is now a Promise and should be awaited before accessing properties of the underlying params object. In this version of Next.js direct access to param properties is still supported to facilitate migration but in a future version you will be required to await \`params\`. If this use is inside an async function await it. If this use is inside a synchronous function then convert the function to async or await it from outside this function and pass the result in.`
  )
}

function warnForEnumeration(
  route: undefined | string,
  missingProperties: Array<string>
) {
  const prefix = route ? ` In route ${route} ` : ''
  if (missingProperties.length) {
    const describedMissingProperties =
      describeListOfPropertyNames(missingProperties)
    console.error(
      `${prefix}params are being enumerated incompletely with \`{...params}\`, \`Object.keys(params)\`, or similar. The following properties were not copied: ${describedMissingProperties}. \`params\` is now a Promise, however in the current version of Next.js direct access to the underlying params object is still supported to facilitate migration to the new type. param names that conflict with Promise properties cannot be accessed directly and must be accessed by first awaiting the \`params\` promise.`
    )
  } else {
    console.error(
      `${prefix}params are being enumerated with \`{...params}\`, \`Object.keys(params)\`, or similar. \`params\` is now a Promise, however in the current version of Next.js direct access to the underlying params object is still supported to facilitate migration to the new type. You should update your code to await \`params\` before accessing its properties.`
    )
  }
}

function describeListOfPropertyNames(properties: Array<string>) {
  switch (properties.length) {
    case 0:
      throw new InvariantError(
        'Expected describeListOfPropertyNames to be called with a non-empty list of strings.'
      )
    case 1:
      return `\`${properties[0]}\``
    case 2:
      return `\`${properties[0]}\` and \`${properties[1]}\``
    default: {
      let description = ''
      for (let i = 0; i < properties.length - 1; i++) {
        description += `\`${properties[i]}\`, `
      }
      description += `, and \`${properties[properties.length - 1]}\``
      return description
    }
  }
}

// This regex will have fast negatives meaning valid identifiers may not pass
// this test. However this is only used during static generation to provide hints
// about why a page bailed out of some or all prerendering and we can use bracket notation
// for example while `ಠ_ಠ` is a valid identifier it's ok to print `params['ಠ_ಠ']`
// even if this would have been fine too `params.ಠ_ಠ`
const isDefinitelyAValidIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function describeStringPropertyAccess(prop: string) {
  if (isDefinitelyAValidIdentifier.test(prop)) {
    return `\`params.${prop}\``
  }
  return `\`params[${JSON.stringify(prop)}]\``
}

function throwWithStaticGenerationBailoutError(
  route: string,
  expression: string
): never {
  throw new StaticGenBailoutError(
    `Route ${route} couldn't be rendered statically because it used ${expression}. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`
  )
}
