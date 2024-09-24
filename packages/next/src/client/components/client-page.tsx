'use client'

import type { ParsedUrlQuery } from 'querystring'
import { use } from 'react'
import { InvariantError } from '../../shared/lib/invariant-error'

import type { Params } from '../../server/request/params'

export function ClientPageRoot({
  Component,
  searchParams,
  params,
  underlyingParams,
}: {
  Component: React.ComponentType<any>
  searchParams: Promise<ParsedUrlQuery>
  params: Promise<Params>
  underlyingParams: Params
}) {
  if (typeof window === 'undefined') {
    const { staticGenerationAsyncStorage } =
      require('./static-generation-async-storage.external') as typeof import('./static-generation-async-storage.external')

    let clientSearchParams: Promise<ParsedUrlQuery>
    let clientParams: Promise<Params>
    // We are going to instrument the searchParams prop with tracking for the
    // appropriate context. We wrap differently in prerendering vs rendering
    const store = staticGenerationAsyncStorage.getStore()
    if (!store) {
      throw new InvariantError(
        'Expected staticGenerationStore to exist when handling searchParams in a client Page.'
      )
    }

    if (store.isStaticGeneration) {
      // We are in a prerender context
      // We need to recover the underlying searchParams from the server
      const { reifyClientPrerenderSearchParams } =
        require('../../server/request/search-params') as typeof import('../../server/request/search-params')
      clientSearchParams = reifyClientPrerenderSearchParams(store)

      const { reifyClientPrerenderParams } =
        require('../../server/request/params') as typeof import('../../server/request/params')

      clientParams = reifyClientPrerenderParams(underlyingParams, store)
    } else {
      // We are in a dynamic context and need to unwrap the underlying searchParams
      const { reifyClientRenderSearchParams } =
        require('../../server/request/search-params') as typeof import('../../server/request/search-params')
      clientSearchParams = reifyClientRenderSearchParams(
        use(searchParams),
        store
      )
      const { reifyClientRenderParams } =
        require('../../server/request/params') as typeof import('../../server/request/params')
      clientParams = reifyClientRenderParams(use(params), store)
    }

    return <Component params={clientParams} searchParams={clientSearchParams} />
  } else {
    const { reifyClientRenderSearchParams } =
      require('../../server/request/search-params.browser') as typeof import('../../server/request/search-params.browser')
    const clientSearchParams = reifyClientRenderSearchParams(use(searchParams))
    const { reifyClientRenderParams } =
      require('../../server/request/params.browser') as typeof import('../../server/request/params.browser')
    const clientParams = reifyClientRenderParams(use(params))

    return <Component params={clientParams} searchParams={clientSearchParams} />
  }
}
