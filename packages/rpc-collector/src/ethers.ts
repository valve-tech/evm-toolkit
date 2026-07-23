import { FallbackProvider, JsonRpcProvider, WebSocketProvider } from 'ethers';

import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';

export type EthersTransportMode = 'fallback' | 'loadBalance';

export interface ToEthersProviderOptions {
  /**
   * `'fallback'` (default) dispatches in list order — ethers sends to the
   * lowest priority number first. `'loadBalance'` gives every endpoint
   * equal priority so ethers spreads requests across them.
   */
  mode?: EthersTransportMode;
}

/**
 * Build an ethers `FallbackProvider` from collected endpoints.
 *
 * Quorum is pinned to 1: we want failover and load spreading, not
 * multi-provider consensus, which would multiply every request.
 *
 * @throws {EmptyEndpointSetError} if `endpoints` is empty.
 */
export function toEthersProvider(
  endpoints: readonly RpcEndpoint[],
  options: ToEthersProviderOptions = {},
): FallbackProvider {
  const { mode = 'fallback' } = options;

  if (endpoints.length === 0) {
    throw new EmptyEndpointSetError('toEthersProvider');
  }

  // ethers does not re-export FallbackProviderConfig from its root entry,
  // so the config shape is typed structurally via the constructor.
  const configs = endpoints.map((endpoint, index) => ({
    provider:
      endpoint.protocol === 'ws'
        ? new WebSocketProvider(endpoint.url)
        : new JsonRpcProvider(endpoint.url),
    priority: mode === 'loadBalance' ? 1 : index + 1,
    weight: 1,
  }));

  return new FallbackProvider(configs, undefined, { quorum: 1 });
}
