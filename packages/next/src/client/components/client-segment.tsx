'use client'

import { use } from 'react'
import { InvariantError } from '../../shared/lib/invariant-error'

import type { Params } from '../../server/request/params'

export function ClientSegmentRoot({
  Component,
  slots,
  params,
  underlyingParams,
}: {
  Component: React.ComponentType<any>
  slots: { [key: string]: React.ReactNode }
  params: Promise<Params>
  underlyingParams: Params
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

    const { reifyClientPrerenderParams } =
      require('../../server/request/params') as typeof import('../../server/request/params')

    if (store.isStaticGeneration) {
      clientParams = reifyClientPrerenderParams(underlyingParams, store)
    } else {
      // We are in a dynamic context and need to unwrap the underlying searchParams
      const { reifyClientRenderParams } =
        require('../../server/request/params') as typeof import('../../server/request/params')
      clientParams = reifyClientRenderParams(use(params), store)
    }
    return <Component {...slots} params={clientParams} />
  } else {
    const { reifyClientRenderParams } =
      require('../../server/request/params.browser') as typeof import('../../server/request/params.browser')
    const clientParams = reifyClientRenderParams(use(params))
    return <Component {...slots} params={clientParams} />
  }
}
