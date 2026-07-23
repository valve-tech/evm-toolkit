import type { RpcEndpoint } from './types.js';

export interface ProbedRpcEndpoint extends RpcEndpoint {
  /** Round-trip time in ms, or null if not measured (websocket). */
  readonly latencyMs: number | null;
  /** False only when the endpoint was probed and failed. */
  readonly alive: boolean;
}

export interface ProbeOptions {
  /** Per-endpoint timeout. Defaults to 3000ms. */
  timeoutMs?: number;
  /** Keep failed endpoints in the result, flagged `alive: false`. */
  keepDead?: boolean;
}

const DEFAULT_TIMEOUT_MS = 3_000;

async function probeOne(
  endpoint: RpcEndpoint,
  timeoutMs: number,
): Promise<ProbedRpcEndpoint> {
  // Websockets cannot be probed with fetch. Rather than declare them dead
  // on no evidence, pass them through unmeasured.
  if (endpoint.protocol === 'ws') {
    return { ...endpoint, latencyMs: null, alive: true };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return { ...endpoint, latencyMs: null, alive: false };

    const payload = (await response.json()) as { result?: unknown };
    if (typeof payload.result !== 'string') {
      return { ...endpoint, latencyMs: null, alive: false };
    }

    // An endpoint answering for the wrong chain is misconfigured, not
    // healthy — treat it as dead rather than quietly returning it.
    if (Number(payload.result) !== endpoint.chainId) {
      return { ...endpoint, latencyMs: null, alive: false };
    }

    return { ...endpoint, latencyMs: Date.now() - startedAt, alive: true };
  } catch {
    return { ...endpoint, latencyMs: null, alive: false };
  }
}

/**
 * Ping each endpoint and reorder by measured latency.
 *
 * Opt-in and network-bound — the rest of this package is pure. Dead
 * endpoints are dropped unless `keepDead` is set. Websocket endpoints are
 * not probed; they are kept, unmeasured, and sorted after measured ones.
 */
export async function probeEndpoints(
  endpoints: readonly RpcEndpoint[],
  options: ProbeOptions = {},
): Promise<ProbedRpcEndpoint[]> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, keepDead = false } = options;

  const probed = await Promise.all(
    endpoints.map((endpoint) => probeOne(endpoint, timeoutMs)),
  );

  const kept = keepDead ? probed : probed.filter((e) => e.alive);

  return kept.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.latencyMs === b.latencyMs) return 0;
    if (a.latencyMs === null) return 1;
    if (b.latencyMs === null) return -1;
    return a.latencyMs - b.latencyMs;
  });
}
