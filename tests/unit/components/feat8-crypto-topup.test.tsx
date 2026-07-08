// FEAT-8: "Top up with crypto" deep-links to the ar.io Console so the user
// pays with their own browser wallet — the desktop app never handles a private
// key. These tests drive the REAL TurboCreditsManager -> TurboPurchaseTab
// chain and assert the exact deep-link contract:
//
//   https://console.ar.io/topup?destinationAddress=<publicArweaveAddress>&source=ardrive-desktop
//
// Guarantees under test:
//   1. Clicking the crypto button opens shell.openExternal with the EXACT URL
//      (public wallet address + source param) and NO private key / secret.
//   2. The button is disabled when no wallet address is available (no broken URL).
//   3. Returning to the app (window 'focus') AFTER initiating a top-up re-fetches
//      the Turbo balance — and an idle focus with no top-up does NOT.
//
// No real funds can be spent: opening a URL costs nothing and every IPC is mocked.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import TurboCreditsManager from '../../../src/renderer/components/TurboCreditsManager';
import { WalletInfo } from '../../../src/types';

const mockElectronAPI = {
  wallet: {
    getInfo: vi.fn(),
  },
  turbo: {
    getBalance: vi.fn(),
    getFiatEstimate: vi.fn(),
    createCheckoutSession: vi.fn(),
    topUpWithTokens: vi.fn(),
  },
  files: {
    getUploads: vi.fn(),
  },
  shell: {
    // D-005: shell:open-external resolves the IpcResult envelope.
    openExternal: vi.fn(),
  },
  payment: {
    openWindow: vi.fn(),
    onPaymentCompleted: vi.fn(() => vi.fn()),
    onPaymentCancelled: vi.fn(() => vi.fn()),
  },
  onWalletInfoUpdated: vi.fn(() => vi.fn()),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// A realistic base64url Arweave address (43 chars, includes '-' and '_').
const ARWEAVE_ADDRESS = 'abcDEF-123_ghiJKL456mnoPQR789stuVWX012yz-_AB';
const EXPECTED_URL =
  'https://console.ar.io/topup?destinationAddress=' +
  encodeURIComponent(ARWEAVE_ADDRESS) +
  '&source=ardrive-desktop';

describe('FEAT-8: crypto top-up via ar.io Console deep-link', () => {
  const baseWalletInfo: WalletInfo = {
    address: ARWEAVE_ADDRESS,
    balance: '1.000000',
    walletType: 'arweave',
    turboBalance: '0.500000',
    turboWinc: '500000000000',
  };

  const mockOnClose = vi.fn();

  const renderManager = (walletInfo: WalletInfo = baseWalletInfo) =>
    render(<TurboCreditsManager walletInfo={walletInfo} onClose={mockOnClose} />);

  /** The crypto top-up button, addressed by its accessible name. */
  const getCryptoButton = () =>
    screen.getByRole('button', {
      name: /Top up with crypto on ar\.io Console/i,
    }) as HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.wallet.getInfo.mockResolvedValue(baseWalletInfo);
    mockElectronAPI.turbo.getBalance.mockResolvedValue({
      success: true,
      data: { ar: '0.500000', winc: '500000000000' },
    });
    mockElectronAPI.turbo.getFiatEstimate.mockResolvedValue({
      success: true,
      data: { byteCount: 1024 * 1024 * 1024, amount: 10, winc: '1000000000000', currency: 'usd' },
    });
    mockElectronAPI.files.getUploads.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.shell.openExternal.mockResolvedValue({ success: true, data: true });
  });

  it('opens shell.openExternal with the EXACT ar.io Console URL (public address + source, no key)', async () => {
    renderManager();

    // Let the mount-time balance load settle so `loading` is false and the
    // crypto button is interactable.
    await screen.findByText('0.500000');

    fireEvent.click(getCryptoButton());

    await waitFor(() => {
      expect(mockElectronAPI.shell.openExternal).toHaveBeenCalledTimes(1);
    });

    const calledUrl = mockElectronAPI.shell.openExternal.mock.calls[0][0] as string;

    // Exact contract the console side reads.
    expect(calledUrl).toBe(EXPECTED_URL);

    // The PUBLIC Arweave address is present as the credit destination...
    expect(calledUrl).toContain(`destinationAddress=${ARWEAVE_ADDRESS}`);
    expect(calledUrl).toContain('source=ardrive-desktop');

    // ...and NOTHING secret is ever in the URL. Only these two params exist.
    const query = new URL(calledUrl).searchParams;
    expect([...query.keys()].sort()).toEqual(['destinationAddress', 'source']);
    for (const forbidden of ['privateKey', 'private_key', 'seed', 'mnemonic', 'jwk', 'kty', 'secret', 'password']) {
      expect(calledUrl.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('never routes the crypto top-up through the card/Stripe payment window', async () => {
    renderManager();
    await screen.findByText('0.500000');

    fireEvent.click(getCryptoButton());

    await waitFor(() => {
      expect(mockElectronAPI.shell.openExternal).toHaveBeenCalled();
    });
    // Distinct rail: it must not create a Stripe session or open the in-app
    // payment window.
    expect(mockElectronAPI.turbo.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockElectronAPI.payment.openWindow).not.toHaveBeenCalled();
  });

  it('disables the crypto button and opens nothing when no wallet address is available', async () => {
    renderManager({ ...baseWalletInfo, address: '' });
    await screen.findByText('0.500000');

    const button = getCryptoButton();
    expect(button).toBeDisabled();

    // Even if the click is forced through, no URL is opened.
    fireEvent.click(button);
    expect(mockElectronAPI.shell.openExternal).not.toHaveBeenCalled();
  });

  it('re-fetches the Turbo balance on window focus AFTER a crypto top-up was initiated', async () => {
    renderManager();
    await screen.findByText('0.500000');

    // Baseline: getBalance was called once on mount.
    await waitFor(() => {
      expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(1);
    });

    // A focus event WITHOUT an initiated top-up must not spam getBalance.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(1);

    // Initiate the crypto top-up (opens the browser)...
    fireEvent.click(getCryptoButton());
    await waitFor(() => {
      expect(mockElectronAPI.shell.openExternal).toHaveBeenCalled();
    });

    // ...then the user returns and the app regains focus -> balance re-fetch.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2);
    });

    // The refresh is one-shot: a second focus with no new top-up does nothing.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2);
  });

  it('shows honest, no-keys copy for the crypto rail', async () => {
    renderManager();
    await screen.findByText('0.500000');

    expect(
      screen.getByText(/Pay with your Solana, Ethereum, or Arweave wallet via ar\.io Console/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/we never see your keys/i)).toBeInTheDocument();
  });

  it('surfaces an error and clears the pending top-up when the browser fails to open', async () => {
    mockElectronAPI.shell.openExternal.mockResolvedValue({
      success: false,
      error: 'no handler for URL',
    });
    renderManager();
    await screen.findByText('0.500000');

    fireEvent.click(getCryptoButton());

    await waitFor(() => {
      expect(screen.getByText(/no handler for URL/i)).toBeInTheDocument();
    });

    // A failed open must NOT arm the focus refresh.
    const callsBefore = mockElectronAPI.turbo.getBalance.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(callsBefore);
  });
});
