// @vitest-environment node
//
// SYNC-23: app-side ORDERED gateway failover — the CENTRAL invariant these
// tests pin is that failover is PER-REQUEST-TYPE (proven live 2026-07-05):
//
//   • DATA fetches (by-txid) fail over freely: primary 404-storms → next
//     gateway serves the same tx. Any persistent failure of gateway N ⇒ try
//     gateway N+1, and if ALL fail we surface an honest error within a bounded
//     number of attempts (never a hang).
//
//   • METADATA / GraphQL is CONSERVATIVE: retry the PRIMARY robustly, but fail
//     over to an alternate ONLY on a HARD-UNREACHABLE primary (network/5xx),
//     NEVER on an empty/404 result. Because perma.online does NOT index this
//     owner's ArFS metadata (returns EMPTY), trusting an alternate's empty
//     answer would be silently WORSE than the primary's — so the empty/404
//     result must stay on the primary. Test (c) below proves exactly this.
import { describe, it, expect, vi, afterEach } from 'vitest';

// gateway.ts (imported transitively for getGatewayHosts) reads the persisted
// gateway config synchronously — mock the config-manager so the ordered-list
// test controls it (and so the electron import chain never loads under node).
const getGatewayHostMock = vi.hoisted(() => vi.fn());
const getGatewayFallbacksMock = vi.hoisted(() => vi.fn());
vi.mock('@/main/config-manager', () => ({
  configManager: {
    getGatewayHost: getGatewayHostMock,
    getGatewayFallbacks: getGatewayFallbacksMock,
  },
}));

import {
  runWithGatewayFailover,
  fetchTxDataWithFailover,
  queryMetadataWithResilience,
  isHardUnreachable,
} from '@/main/sync/gateway-failover';
import { getGatewayHosts, DEFAULT_GATEWAY_FALLBACKS } from '@/main/gateway';

// A transient gateway 404 (SYNC-20 classifies this as retryable/transient).
function gateway404(): Error {
  return Object.assign(new Error('Request to gateway has failed: (Status: 404) Not Found'), {
    status: 404,
  });
}
// A 5xx — the gateway gave NO usable answer (hard-unreachable).
function gateway503(): Error {
  return Object.assign(new Error('HTTP 503: Service Unavailable'), { status: 503 });
}

// Minimal Response stand-in for the injected fetch.
function fakeResponse(opts: {
  ok: boolean;
  status: number;
  statusText?: string;
  body?: Uint8Array;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText ?? '',
    arrayBuffer: async () =>
      (opts.body ?? new Uint8Array()).buffer as ArrayBuffer,
  } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  getGatewayHostMock.mockReset();
  getGatewayFallbacksMock.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SYNC-23 getGatewayHosts — ordered list config', () => {
  it('defaults to turbo-gateway.com primary + [perma.online, arweave.net] fallbacks', () => {
    getGatewayHostMock.mockReturnValue(undefined); // → default primary
    getGatewayFallbacksMock.mockReturnValue(undefined); // → default fallbacks
    expect(getGatewayHosts()).toEqual(['turbo-gateway.com', 'perma.online', 'arweave.net']);
    expect(DEFAULT_GATEWAY_FALLBACKS).toEqual(['perma.online', 'arweave.net']);
  });

  it('puts the configured primary first, then the configured fallbacks', () => {
    getGatewayHostMock.mockReturnValue('my-gw.example');
    getGatewayFallbacksMock.mockReturnValue(['backup-a.example', 'backup-b.example']);
    expect(getGatewayHosts()).toEqual(['my-gw.example', 'backup-a.example', 'backup-b.example']);
  });

  it('de-dupes (primary already present in fallbacks) and drops empty entries, preserving order', () => {
    getGatewayHostMock.mockReturnValue('perma.online');
    getGatewayFallbacksMock.mockReturnValue(['  ', 'perma.online', 'arweave.net']);
    expect(getGatewayHosts()).toEqual(['perma.online', 'arweave.net']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SYNC-23 DATA-fetch failover (runWithGatewayFailover)', () => {
  const HOSTS = ['primary.test', 'perma.test', 'arweave.test'];

  it('(a) primary fails → fails over to the secondary → SUCCEEDS', async () => {
    const attempt = vi.fn(async (_url: string, host: string) => {
      if (host === 'primary.test') throw gateway404(); // primary 404-storms
      return `served-by-${host}`; // perma.test serves the same data fine
    });
    const onGatewaySwitch = vi.fn();

    const result = await runWithGatewayFailover(attempt, {
      hosts: HOSTS,
      retry: { attempts: 1 }, // single pass per gateway (download path shape)
      onGatewaySwitch,
    });

    expect(result).toBe('served-by-perma.test');
    // primary tried once, then the secondary succeeded — third never needed.
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt).toHaveBeenNthCalledWith(1, 'https://primary.test', 'primary.test');
    expect(attempt).toHaveBeenNthCalledWith(2, 'https://perma.test', 'perma.test');
    expect(onGatewaySwitch).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'primary.test', to: 'perma.test' })
    );
  });

  it('retries the SAME gateway (per-gateway retryWithBackoff) before moving on', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const attempt = vi.fn(async (_url: string, host: string) => {
      calls += 1;
      if (host === 'primary.test' && calls === 1) throw gateway404(); // one blip
      return `served-by-${host}`;
    });

    // attempts:2 → the primary's first-attempt blip self-heals on retry #2,
    // so we never fail over. Proves retryWithBackoff runs PER gateway.
    const p = runWithGatewayFailover(attempt, { hosts: HOSTS, retry: { attempts: 2 } });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe('served-by-primary.test');
    expect(attempt).toHaveBeenCalledTimes(2); // both calls on primary.test
    expect(attempt).toHaveBeenNthCalledWith(2, 'https://primary.test', 'primary.test');
  });

  it('(b) ALL gateways fail → rejects with the last error within a BOUNDED number of attempts (no hang)', async () => {
    vi.useFakeTimers();
    const attempt = vi.fn(async (_url: string, host: string) => {
      throw Object.assign(gateway404(), { message: `down: ${host}` });
    });

    const p = runWithGatewayFailover(attempt, { hosts: HOSTS, retry: { attempts: 2 } });
    const assertion = expect(p).rejects.toThrow(/down: arweave.test/); // honest LAST error
    await vi.runAllTimersAsync();
    await assertion;

    // Exactly gateways(3) × attempts(2) = 6 — bounded, never unbounded/hanging.
    expect(attempt).toHaveBeenCalledTimes(6);
  });

  it('a user-cancel (abort) short-circuits — NO failover to other gateways', async () => {
    const abortErr = Object.assign(new Error('canceled'), { code: 'ABORT_ERR' });
    const attempt = vi.fn(async () => {
      throw abortErr;
    });

    await expect(
      runWithGatewayFailover(attempt, { hosts: HOSTS, retry: { attempts: 1 } })
    ).rejects.toThrow('canceled');

    expect(attempt).toHaveBeenCalledTimes(1); // aborted on the primary → stop
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SYNC-23 fetchTxDataWithFailover (DATA, by-txid)', () => {
  it('primary returns 404 → fails over to the secondary → returns the bytes + serving gateway', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://primary.test')) {
        return fakeResponse({ ok: false, status: 404, statusText: 'Not Found' });
      }
      return fakeResponse({ ok: true, status: 200, body });
    });

    const { buffer, gatewayHost } = await fetchTxDataWithFailover('tx-abc', {
      hosts: ['primary.test', 'perma.test'],
      retry: { attempts: 1 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(gatewayHost).toBe('perma.test');
    expect(Buffer.from(body).equals(buffer)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://primary.test/tx-abc');
    expect(fetchImpl).toHaveBeenCalledWith('https://perma.test/tx-abc');
  });

  it('all gateways 404 → rejects honestly (bounded, no hang)', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: false, status: 404, statusText: 'Not Found' })
    );

    await expect(
      fetchTxDataWithFailover('tx-missing', {
        hosts: ['primary.test', 'perma.test'],
        retry: { attempts: 1 },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/HTTP 404/);

    expect(fetchImpl).toHaveBeenCalledTimes(2); // one per gateway, bounded
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) THE per-request-type safety proof: metadata must NOT fail over to an
// index-gapped alternate on an empty/404 result — only on hard-unreachable.
describe('SYNC-23 queryMetadataWithResilience (metadata, CONSERVATIVE)', () => {
  const HOSTS = ['primary.test', 'perma.test'];
  const EMPTY = { data: { transactions: { edges: [] as unknown[] } } };
  const NONEMPTY = { data: { transactions: { edges: [{ node: { id: 'x' } }] } } };

  it('(c) an EMPTY result on the primary is RETURNED AS-IS — never fails over to the alternate', async () => {
    // perma.test would (wrongly) also return empty for this owner, so failing
    // over would look identical but is semantically unsafe: we must trust the
    // PRIMARY's empty answer, not an alternate's.
    const runQuery = vi.fn(async (_url: string, host: string) => {
      if (host !== 'primary.test') {
        throw new Error('alternate must NEVER be queried on an empty result');
      }
      return EMPTY;
    });

    const result = await queryMetadataWithResilience(runQuery, { hosts: HOSTS });

    expect(result).toBe(EMPTY);
    expect(runQuery).toHaveBeenCalledTimes(1); // primary only — no failover
    expect(runQuery).toHaveBeenCalledWith('https://primary.test', 'primary.test');
  });

  it('(c) a 404 on the primary is retried on the PRIMARY then surfaced — never fails over to the alternate', async () => {
    vi.useFakeTimers();
    const runQuery = vi.fn(async (_url: string, host: string) => {
      if (host !== 'primary.test') {
        throw new Error('alternate must NEVER be queried on a 404');
      }
      throw gateway404(); // a 404 is an ANSWER, not an unreachable gateway
    });

    const p = queryMetadataWithResilience(runQuery, {
      hosts: HOSTS,
      retry: { attempts: 2 },
    });
    const assertion = expect(p).rejects.toThrow(/Status: 404/);
    await vi.runAllTimersAsync();
    await assertion;

    // Retried on the primary (2 attempts) but the alternate was NEVER touched.
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery).toHaveBeenCalledWith('https://primary.test', 'primary.test');
    expect(runQuery).not.toHaveBeenCalledWith('https://perma.test', 'perma.test');
  });

  it('a HARD-UNREACHABLE primary (5xx) DOES fail over to the alternate', async () => {
    vi.useFakeTimers();
    const runQuery = vi.fn(async (_url: string, host: string) => {
      if (host === 'primary.test') throw gateway503(); // no answer at all
      return NONEMPTY; // alternate can be trusted here — primary gave nothing
    });

    const p = queryMetadataWithResilience(runQuery, {
      hosts: HOSTS,
      retry: { attempts: 2 },
    });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe(NONEMPTY);
    expect(runQuery).toHaveBeenCalledWith('https://perma.test', 'perma.test');
  });

  it('a NETWORK-unreachable primary (no HTTP status) also fails over', async () => {
    vi.useFakeTimers();
    const runQuery = vi.fn(async (_url: string, host: string) => {
      if (host === 'primary.test') throw new Error('fetch failed'); // transport failure
      return NONEMPTY;
    });

    const p = queryMetadataWithResilience(runQuery, { hosts: HOSTS, retry: { attempts: 2 } });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe(NONEMPTY);
    expect(runQuery).toHaveBeenCalledWith('https://perma.test', 'perma.test');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SYNC-23 isHardUnreachable (metadata failover gate)', () => {
  it('treats 5xx and transport/network failures as hard-unreachable', () => {
    expect(isHardUnreachable(gateway503())).toBe(true);
    expect(isHardUnreachable({ status: 502, message: 'bad gateway' })).toBe(true);
    expect(isHardUnreachable(new Error('ETIMEDOUT'))).toBe(true);
    expect(isHardUnreachable(new Error('fetch failed'))).toBe(true);
    expect(isHardUnreachable(new Error('socket hang up'))).toBe(true);
  });

  it('does NOT treat a 404 / "not found" / empty answer as hard-unreachable', () => {
    expect(isHardUnreachable(gateway404())).toBe(false);
    expect(isHardUnreachable({ status: 404, message: 'Not Found' })).toBe(false);
    expect(isHardUnreachable(new Error('Not Found'))).toBe(false);
    // axios-style 404 message (no numeric status field) still classified as an answer.
    expect(isHardUnreachable(new Error('Request failed with status code 404'))).toBe(false);
  });

  it('does NOT treat a user-cancel (abort) as hard-unreachable', () => {
    expect(isHardUnreachable(Object.assign(new Error('canceled'), { code: 'ABORT_ERR' }))).toBe(false);
  });
});
