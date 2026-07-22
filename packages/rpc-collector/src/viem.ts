import { fallback, http, webSocket, type FallbackTransport } from 'viem';

import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';

export type TransportMode = 'fallback' | 'loadBalance';

export interface ToViemTransportOptions {
  /**
   * `'fallback'` (default) tries endpoints in order and rotates on
   * failure. `'loadBalance'` lets viem ping and re-rank them by latency,
   * steering traffic toward the fastest live endpoints.
   */
  mode?: TransportMode;
}

/**
 * Build a viem transport from collected endpoints.
 *
 * @throws {EmptyEndpointSetError} if `endpoints` is empty.
 */
export function toViemTransport(
  endpoints: readonly RpcEndpoint[],
  options: ToViemTransportOptions = {},
): FallbackTransport {
  const { mode = 'fallback' } = options;

  if (endpoints.length === 0) {
    throw new EmptyEndpointSetError('toViemTransport');
  }

  const transports = endpoints.map((endpoint) =>
    endpoint.protocol === 'ws' ? webSocket(endpoint.url) : http(endpoint.url),
  );

  return mode === 'loadBalance'
    ? fallback(transports, { rank: true })
    : fallback(transports);
}
