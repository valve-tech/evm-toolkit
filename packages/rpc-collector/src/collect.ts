import {
  CHAIN_ID_BY_NAME,
  RPCS_BY_CHAIN_ID,
  type RawRpcRecord,
} from './data.generated.js';
import {
  UnknownChainError,
  type CollectRpcsOptions,
  type RpcEndpoint,
  type RpcProtocol,
  type Tracking,
} from './types.js';

/** Lower rank sorts first. Privacy-respecting endpoints lead. */
const TRACKING_RANK: Record<Tracking, number> = {
  none: 0,
  limited: 1,
  unspecified: 2,
  unknown: 3,
  yes: 4,
};

const KNOWN_TRACKING = new Set<string>(Object.keys(TRACKING_RANK));

function toTracking(value: string): Tracking {
  return KNOWN_TRACKING.has(value) ? (value as Tracking) : 'unknown';
}

function toProtocol(url: string): RpcProtocol | null {
  if (url.startsWith('wss://') || url.startsWith('ws://')) return 'ws';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'http';
  return null;
}

function resolveChainId(options: CollectRpcsOptions): string {
  const { chainId, chainName } = options;

  if (chainId !== undefined && chainId !== null) {
    const key = String(chainId);
    if (!(key in RPCS_BY_CHAIN_ID)) throw new UnknownChainError(chainId);
    return key;
  }

  if (chainName) {
    const key = CHAIN_ID_BY_NAME[chainName.toLowerCase()];
    if (key === undefined || !(key in RPCS_BY_CHAIN_ID)) {
      throw new UnknownChainError(chainName);
    }
    return key;
  }

  throw new TypeError(
    'collectRpcs requires either a `chainId` or a `chainName`.',
  );
}

function toEndpoint(
  record: RawRpcRecord,
  chainId: number,
): RpcEndpoint | null {
  // Upstream ships a handful of templated urls (e.g. `${INFURA_API_KEY}`)
  // that are unusable without a key. Drop them rather than hand back an
  // endpoint that cannot connect.
  if (record.url.includes('${')) return null;

  const protocol = toProtocol(record.url);
  if (protocol === null) return null;

  return {
    url: record.url,
    protocol,
    tracking: toTracking(record.tracking),
    ...(record.isOpenSource === true ? { isOpenSource: true } : {}),
    chainId,
  };
}

/**
 * Resolve a chain to its public RPC endpoints, ordered privacy-first.
 *
 * Pure and synchronous — the dataset is compiled into the package, so no
 * network access happens here. Nothing is filtered out unless you ask:
 * by default every endpoint for the chain is returned, ordered so the
 * least-tracking providers come first.
 *
 * @throws {UnknownChainError} if the chain is not in the dataset.
 * @throws {TypeError} if neither `chainId` nor `chainName` is supplied.
 */
export function collectRpcs(options: CollectRpcsOptions): RpcEndpoint[] {
  const { allowedTracking, protocol = 'http', limit } = options;

  const chainKey = resolveChainId(options);
  const chainId = Number(chainKey);
  const records = RPCS_BY_CHAIN_ID[chainKey] ?? [];

  const seen = new Set<string>();
  const endpoints: RpcEndpoint[] = [];

  for (const record of records) {
    const endpoint = toEndpoint(record, chainId);
    if (endpoint === null) continue;
    if (protocol !== 'any' && endpoint.protocol !== protocol) continue;
    if (allowedTracking && !allowedTracking.includes(endpoint.tracking)) {
      continue;
    }
    if (seen.has(endpoint.url)) continue;
    seen.add(endpoint.url);
    endpoints.push(endpoint);
  }

  // Stable sort: equal-ranked endpoints keep their upstream order.
  endpoints.sort((a, b) => {
    const byTracking = TRACKING_RANK[a.tracking] - TRACKING_RANK[b.tracking];
    if (byTracking !== 0) return byTracking;

    const byOpenSource =
      Number(b.isOpenSource === true) - Number(a.isOpenSource === true);
    if (byOpenSource !== 0) return byOpenSource;

    // Prefer http over ws when both are in play.
    if (a.protocol !== b.protocol) return a.protocol === 'http' ? -1 : 1;

    return 0;
  });

  return typeof limit === 'number' ? endpoints.slice(0, limit) : endpoints;
}
