/**
 * Test stub for @kyvejs/sdk (INFRA-2).
 *
 * @ardrive/turbo-sdk imports `KyveSDK` from `@kyvejs/sdk/dist/sdk.js` at module
 * scope (lib/cjs/common/signer.js). That pulls in @keplr-wallet/cosmos ->
 * @keplr-wallet/crypto, which calls bitcoinjs-lib's `initEccLib` at import time.
 * The ecc self-check fails under Vitest/jsdom ("Error: ecc library invalid"),
 * killing collection of any test that transitively imports the turbo SDK.
 *
 * Nothing in this app or its tests uses KYVE tokens, so the whole package is
 * aliased to this stub in vitest.config.ts. Any accidental real use fails loudly.
 */
export class KyveSDK {
  constructor(..._args: unknown[]) {
    // no-op: construction is reached at require-time by turbo-sdk only when
    // a KYVE signer is requested, which tests never do.
  }

  async fromPrivateKey(..._args: unknown[]): Promise<never> {
    throw new Error('@kyvejs/sdk is stubbed out in tests (see tests/mocks/kyve-sdk-stub.ts)');
  }

  async fromMnemonic(..._args: unknown[]): Promise<never> {
    throw new Error('@kyvejs/sdk is stubbed out in tests (see tests/mocks/kyve-sdk-stub.ts)');
  }
}

export default KyveSDK;
