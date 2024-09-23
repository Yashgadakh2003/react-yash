'use client'

import { InvariantError } from '../../shared/lib/invariant-error'

import type { Params } from '../../server/request/params'

export function ClientSegmentRoot({
  Component,
  slots,
  params,
}: {
  Component: React.ComponentType<any>
  slots: { [key: string]: React.ReactNode }
  params: Params
}) {
  if (typeof window === 'undefined') {
    const { staticGenerationAsyncStorage } =
      require('./static-generation-async-storage.external') as typeof import('./static-generation-async-storage.external')

    let clientParams: Promise<Params>
    // We are going to instrument the searchParams prop with tracking for the
    // appropriate context. We wrap differently in prerendering vs rendering
    const store = staticGenerationAsyncStorage.getStore()
    if (!store) {
      throw new InvariantError(
        'Expected staticGenerationStore to exist when handling params in a client segment such as a Layout or Template.'
      )
    }

    const { createPrerenderParamsFromClient } =
      require('../../server/request/params') as typeof import('../../server/request/params')

    if (store.isStaticGeneration) {
      clientParams = createPrerenderParamsFromClient(params, store)
    } else {
      const { createRenderParamsFromClient } =
        require('../../server/request/params') as typeof import('../../server/request/params')
      clientParams = createRenderParamsFromClient(params, store)
    }
    return <Component {...slots} params={clientParams} />
  } else {
    const { createRenderParamsFromClient } =
      require('../../server/request/params.browser') as typeof import('../../server/request/params.browser')
    const clientParams = createRenderParamsFromClient(params)
    return <Component {...slots} params={clientParams} />
  }
}

/**
 * When the Segment is a client component we need to also serialize the promise value of params
 * to trigger dynamic in certain situations like when dynamicIO is on. This component is a sink to send
 * this promise to but doesn't render anything. The prop is optional and it's up to the caller to
 * decide whether the promise is needed. We don't want to send it unless it is because we want
 * to avoid over-serializing data.
 *
 * @internal
 */
export function ClientSegmentSink({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  params,
}: {
  params?: Promise<Params>
}) {
  return null
}
