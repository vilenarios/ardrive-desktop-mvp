// @vitest-environment node
//
// SYNC-17: the app hardcoded `arweave.net` in ~12 places, so any user whose
// arweave.net is rate-limited (429) had wallet ops / balance / downloads break.
// The gateway is now a single configurable source of truth defaulting to
// turbo-gateway.com. These tests pin that resolution contract:
//   env var  >  persisted config  >  turbo-gateway.com default
// plus the InputValidator guard on user-supplied hosts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// gateway.ts reads the persisted override from configManager (synchronously).
// Mock it so each test controls the configured value.
const getGatewayHostMock = vi.hoisted(() => vi.fn());
vi.mock('@/main/config-manager', () => ({
  configManager: { getGatewayHost: getGatewayHostMock }
}));

import {
  getGatewayHost,
  getGatewayConfig,
  getGatewayUrl,
  DEFAULT_GATEWAY_HOST,
  GATEWAY_PORT,
  GATEWAY_PROTOCOL
} from '@/main/gateway';
import { InputValidator, ValidationError } from '@/main/input-validator';

describe('SYNC-17 gateway source of truth', () => {
  const savedEnv = process.env.ARDRIVE_GATEWAY_HOST;

  beforeEach(() => {
    getGatewayHostMock.mockReset();
    delete process.env.ARDRIVE_GATEWAY_HOST;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.ARDRIVE_GATEWAY_HOST;
    else process.env.ARDRIVE_GATEWAY_HOST = savedEnv;
  });

  describe('resolution order', () => {
    it('defaults to turbo-gateway.com when nothing is configured', () => {
      getGatewayHostMock.mockReturnValue(undefined);
      expect(getGatewayHost()).toBe('turbo-gateway.com');
      expect(DEFAULT_GATEWAY_HOST).toBe('turbo-gateway.com');
    });

    it('treats an empty/whitespace config value as unset (falls back to default)', () => {
      getGatewayHostMock.mockReturnValue('   ');
      expect(getGatewayHost()).toBe('turbo-gateway.com');
    });

    it('respects a persisted config override', () => {
      getGatewayHostMock.mockReturnValue('my-gateway.example');
      expect(getGatewayHost()).toBe('my-gateway.example');
    });

    it('trims a persisted config override', () => {
      getGatewayHostMock.mockReturnValue('  spaced.example  ');
      expect(getGatewayHost()).toBe('spaced.example');
    });

    it('lets the env var override win over the persisted config', () => {
      getGatewayHostMock.mockReturnValue('config-host.example');
      process.env.ARDRIVE_GATEWAY_HOST = 'env-host.example';
      expect(getGatewayHost()).toBe('env-host.example');
    });
  });

  describe('getGatewayConfig', () => {
    it('produces an Arweave.init config with https/443 and the resolved host', () => {
      getGatewayHostMock.mockReturnValue(undefined);
      expect(getGatewayConfig()).toEqual({
        host: 'turbo-gateway.com',
        port: GATEWAY_PORT,
        protocol: GATEWAY_PROTOCOL
      });
      expect(GATEWAY_PORT).toBe(443);
      expect(GATEWAY_PROTOCOL).toBe('https');
    });

    it('merges caller options (timeout/logging) on top without changing host/port/protocol', () => {
      getGatewayHostMock.mockReturnValue('override.example');
      expect(getGatewayConfig({ timeout: 120000, logging: true })).toEqual({
        host: 'override.example',
        port: 443,
        protocol: 'https',
        timeout: 120000,
        logging: true
      });
    });
  });

  describe('getGatewayUrl', () => {
    it('builds https://<host> for GraphQL/data/avatar URLs', () => {
      getGatewayHostMock.mockReturnValue(undefined);
      expect(getGatewayUrl()).toBe('https://turbo-gateway.com');
      getGatewayHostMock.mockReturnValue('gw.example');
      expect(getGatewayUrl()).toBe('https://gw.example');
    });
  });
});

describe('SYNC-17 InputValidator.validateGatewayHost', () => {
  it('accepts a plain hostname and trims it', () => {
    expect(InputValidator.validateGatewayHost('turbo-gateway.com')).toBe('turbo-gateway.com');
    expect(InputValidator.validateGatewayHost('  ar-io.dev  ')).toBe('ar-io.dev');
  });

  it('rejects a value carrying a protocol, path, port, or slashes', () => {
    expect(() => InputValidator.validateGatewayHost('https://turbo-gateway.com')).toThrow(ValidationError);
    expect(() => InputValidator.validateGatewayHost('turbo-gateway.com/raw')).toThrow(ValidationError);
    expect(() => InputValidator.validateGatewayHost('turbo-gateway.com:443')).toThrow(ValidationError);
    expect(() => InputValidator.validateGatewayHost('javascript:alert(1)')).toThrow(ValidationError);
  });

  it('rejects empty / non-string input', () => {
    expect(() => InputValidator.validateGatewayHost('')).toThrow(ValidationError);
    expect(() => InputValidator.validateGatewayHost('   ')).toThrow(ValidationError);
    expect(() => InputValidator.validateGatewayHost(undefined)).toThrow(ValidationError);
    expect(() => InputValidator.validateGatewayHost(123)).toThrow(ValidationError);
  });
});
