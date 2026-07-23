/** Privacy tracking rating an RPC provider self-reports upstream. */
export type Tracking =
  | 'none'
  | 'limited'
  | 'yes'
  | 'unspecified'
  | 'unknown';

/** Wire protocol an endpoint speaks. */
export type RpcProtocol = 'http' | 'ws';

/** A single public RPC endpoint for one chain. */
export interface RpcEndpoint {
  readonly url: string;
  readonly protocol: RpcProtocol;
  readonly tracking: Tracking;
  readonly isOpenSource?: boolean;
  readonly chainId: number;
}

export interface CollectRpcsOptions {
  /** Chain to look up by id. Mutually sufficient with `chainName`. */
  chainId?: number | string;
  /** Chain to look up by lowercase chainlist name, e.g. `'ethereum'`. */
  chainName?: string;
  /**
   * Restrict to these tracking ratings. Omit to get every endpoint,
   * ordered privacy-first — nothing is silently dropped.
   */
  allowedTracking?: readonly Tracking[];
  /** Wire protocol filter. Defaults to `'http'`. */
  protocol?: RpcProtocol | 'any';
  /** Cap the number of endpoints returned, after ordering. */
  limit?: number;
}

/** Thrown when no chain in the dataset matches the requested id or name. */
export class UnknownChainError extends Error {
  readonly chain: string | number;

  constructor(chain: string | number) {
    super(
      `No chain in the chainlist dataset matches ${JSON.stringify(chain)}.`,
    );
    this.name = 'UnknownChainError';
    this.chain = chain;
  }
}

/**
 * Thrown when an adapter is handed an empty endpoint list. Building a
 * transport with no endpoints would produce a client that fails on every
 * call, so we refuse loudly instead.
 */
export class EmptyEndpointSetError extends Error {
  readonly adapter: string;

  constructor(adapter: string) {
    super(
      `${adapter} received an empty endpoint list; refusing to build a transport with no RPC endpoints.`,
    );
    this.name = 'EmptyEndpointSetError';
    this.adapter = adapter;
  }
}
