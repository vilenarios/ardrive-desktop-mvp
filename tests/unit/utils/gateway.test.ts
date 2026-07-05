// SYNC-19: the renderer had no single source of the configured Arweave
// gateway host - every "View on Arweave" / raw-file / tx link hardcoded
// arweave.net directly, defeating SYNC-17's main-process gateway
// configurability (arweave.net rate-limits/429s some users - see
// src/main/gateway.ts). src/renderer/utils/gateway.ts is the renderer-side
// equivalent: it reads the same persisted `gatewayHost` via the existing
// config:get IPC call, falls back to turbo-gateway.com (never arweave.net),
// and caches the resolved value so repeat callers don't re-hit IPC.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGatewayHost, invalidateGatewayHostCache, DEFAULT_GATEWAY_HOST } from '@/renderer/utils/gateway';

describe('SYNC-19 renderer gateway host resolution', () => {
  beforeEach(() => {
    invalidateGatewayHostCache();
    vi.restoreAllMocks();
  });

  it('DEFAULT_GATEWAY_HOST is turbo-gateway.com, not arweave.net', () => {
    expect(DEFAULT_GATEWAY_HOST).toBe('turbo-gateway.com');
    expect(DEFAULT_GATEWAY_HOST).not.toBe('arweave.net');
  });

  it('falls back to turbo-gateway.com when config has no gatewayHost set', async () => {
    window.electronAPI.config.get = vi.fn().mockResolvedValue({ success: true, data: {} });
    await expect(getGatewayHost()).resolves.toBe('turbo-gateway.com');
  });

  it('falls back to turbo-gateway.com when config:get resolves { success: false }', async () => {
    window.electronAPI.config.get = vi.fn().mockResolvedValue({ success: false, error: 'boom' });
    await expect(getGatewayHost()).resolves.toBe('turbo-gateway.com');
  });

  it('falls back to turbo-gateway.com when config:get rejects', async () => {
    window.electronAPI.config.get = vi.fn().mockRejectedValue(new Error('IPC unavailable'));
    await expect(getGatewayHost()).resolves.toBe('turbo-gateway.com');
  });

  it('falls back to turbo-gateway.com when electronAPI.config.get is missing entirely', async () => {
    const original = (window as any).electronAPI;
    (window as any).electronAPI = {};
    try {
      await expect(getGatewayHost()).resolves.toBe('turbo-gateway.com');
    } finally {
      (window as any).electronAPI = original;
    }
  });

  it('resolves and trims a configured gateway host override', async () => {
    window.electronAPI.config.get = vi.fn().mockResolvedValue({
      success: true,
      data: { gatewayHost: '  my-gateway.example  ' }
    });
    await expect(getGatewayHost()).resolves.toBe('my-gateway.example');
  });

  it('caches the resolved host: only the first call hits config:get', async () => {
    const getMock = vi.fn().mockResolvedValue({ success: true, data: { gatewayHost: 'cached.example' } });
    window.electronAPI.config.get = getMock;

    const first = await getGatewayHost();
    const second = await getGatewayHost();
    const third = await getGatewayHost();

    expect(first).toBe('cached.example');
    expect(second).toBe('cached.example');
    expect(third).toBe('cached.example');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent in-flight calls into a single config:get request', async () => {
    let resolveConfig: (value: unknown) => void = () => {};
    const getMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      })
    );
    window.electronAPI.config.get = getMock;

    const p1 = getGatewayHost();
    const p2 = getGatewayHost();
    resolveConfig({ success: true, data: { gatewayHost: 'concurrent.example' } });

    await expect(p1).resolves.toBe('concurrent.example');
    await expect(p2).resolves.toBe('concurrent.example');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateGatewayHostCache() forces the next call to re-read config', async () => {
    window.electronAPI.config.get = vi.fn().mockResolvedValue({
      success: true,
      data: { gatewayHost: 'first.example' }
    });
    await expect(getGatewayHost()).resolves.toBe('first.example');

    invalidateGatewayHostCache();
    window.electronAPI.config.get = vi.fn().mockResolvedValue({
      success: true,
      data: { gatewayHost: 'second.example' }
    });
    await expect(getGatewayHost()).resolves.toBe('second.example');
  });
});
