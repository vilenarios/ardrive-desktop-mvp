// FEAT-8 (balance-poll refresh): on-chain crypto top-ups bought on the ar.io
// Console have confirmation latency, so a single refresh-on-focus can fire
// before the credits land and then NEVER re-fire. This suite drives the REAL
// TurboCreditsManager and proves the bounded, self-terminating poll that
// replaces the one-shot refresh:
//
//   * initiating a crypto top-up records the "before" balance (baseline);
//   * on return (window focus) a BOUNDED poll starts and STOPS EARLY the moment
//     the balance rises past that baseline, with an honest positive message;
//   * if the balance never rises, the poll STOPS after the cap with a gentle,
//     non-error message (never claims failure, never claims credits arrived);
//   * re-focusing mid-poll does NOT stack a second poll / second timer chain;
//   * unmount clears the pending timer (no leak, no post-unmount fetch);
//   * the manual Refresh affordance cancels a running poll and fetches now.
//
// Everything is on fake timers so ~2 minutes of polling runs in milliseconds,
// and every IPC is mocked — this suite can never spend funds (balance reads are
// free and mocked anyway).
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import TurboCreditsManager from '../../../src/renderer/components/TurboCreditsManager';
import { WalletInfo } from '../../../src/types';

const mockElectronAPI = {
  wallet: { getInfo: vi.fn() },
  turbo: {
    getBalance: vi.fn(),
    getFiatEstimate: vi.fn(),
    createCheckoutSession: vi.fn(),
    topUpWithTokens: vi.fn(),
  },
  files: { getUploads: vi.fn() },
  // D-005: shell:open-external resolves the IpcResult envelope.
  shell: { openExternal: vi.fn() },
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

const ARWEAVE_ADDRESS = 'abcDEF-123_ghiJKL456mnoPQR789stuVWX012yz-_AB';

/** An IpcResult-enveloped Turbo balance. `winc` is the precise number the poll compares. */
const balanceEnv = (ar: string, winc: string) => ({ success: true, data: { ar, winc } });
const BASE = balanceEnv('0.500000', '500000000000'); // 0.5 credits — the baseline
const HIGHER = balanceEnv('0.750000', '750000000000'); // credits landed

// The poll's own constants (kept in sync with the component): 8 checks ~14s apart.
const POLL_INTERVAL_MS = 14000;
const POLL_MAX_ATTEMPTS = 8;

describe('FEAT-8: bounded balance poll after crypto top-up', () => {
  const baseWalletInfo: WalletInfo = {
    address: ARWEAVE_ADDRESS,
    balance: '1.000000',
    walletType: 'arweave',
    turboBalance: '0.500000',
    turboWinc: '500000000000',
  };

  const mockOnClose = vi.fn();

  const renderManager = () =>
    render(<TurboCreditsManager walletInfo={baseWalletInfo} onClose={mockOnClose} />);

  const getCryptoButton = () =>
    screen.getByRole('button', {
      name: /Top up with crypto on ar\.io Console/i,
    }) as HTMLButtonElement;

  /** Flush pending promises (and any due timers) so React state settles. */
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  /** Advance fake time and let the resulting async poll work run to a rest state. */
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /** Click the crypto button (opens the console) and let the async open settle. */
  const initiateCryptoTopUp = async () => {
    await act(async () => {
      fireEvent.click(getCryptoButton());
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  /** Simulate returning to the app (window regains focus). */
  const returnToApp = async () => {
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockElectronAPI.wallet.getInfo.mockResolvedValue(baseWalletInfo);
    mockElectronAPI.turbo.getBalance.mockResolvedValue(BASE);
    mockElectronAPI.turbo.getFiatEstimate.mockResolvedValue({
      success: true,
      data: { byteCount: 1024 * 1024 * 1024, amount: 10, winc: '1000000000000', currency: 'usd' },
    });
    mockElectronAPI.files.getUploads.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.shell.openExternal.mockResolvedValue({ success: true, data: true });
  });

  afterEach(() => {
    // Discard (don't run) any pending fake timers — running them here would fire
    // dismiss-timer setState outside act() and print spurious warnings.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('records the baseline on initiation and STOPS the poll early with a positive message when credits land', async () => {
    // mount + first poll check see the baseline; the next check sees the credits.
    mockElectronAPI.turbo.getBalance.mockReset();
    mockElectronAPI.turbo.getBalance
      .mockResolvedValueOnce(BASE) // mount load
      .mockResolvedValueOnce(BASE) // poll attempt 1 (immediate on return) — no increase yet
      .mockResolvedValue(HIGHER); // poll attempt 2+ — credits have landed

    renderManager();
    await settle();
    expect(screen.getByText('0.500000')).toBeInTheDocument(); // baseline shown at mount

    // Initiate the crypto top-up — this must capture 0.5 as the baseline.
    await initiateCryptoTopUp();
    expect(mockElectronAPI.shell.openExternal).toHaveBeenCalledTimes(1);

    // Return to the app -> bounded poll starts; the immediate check is still the
    // baseline, so it must NOT yet claim credits arrived (baseline was recorded
    // and compared — a false positive here would prove it wasn't).
    await returnToApp();
    expect(screen.getByText(/Checking for new credits/i)).toBeInTheDocument();
    expect(screen.queryByText(/Credits added/i)).not.toBeInTheDocument();
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2); // mount + immediate

    // The next scheduled check sees the higher balance -> stop EARLY, positive copy.
    await advance(POLL_INTERVAL_MS);

    const successMsg = screen.getByText('Credits added! Your balance is up to date.');
    expect(successMsg).toBeInTheDocument();
    expect(successMsg.closest('.tcm-success-message')).not.toBeNull(); // positive tone
    expect(screen.getByText('0.750000')).toBeInTheDocument(); // balance updated on screen

    // Poll self-terminated: advancing further triggers NO more balance fetches.
    const callsAtStop = mockElectronAPI.turbo.getBalance.mock.calls.length; // 3
    expect(callsAtStop).toBe(3);
    await advance(POLL_INTERVAL_MS * 4);
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(callsAtStop);
  });

  it('STOPS after the max attempts with a gentle, honest (non-error) message when the balance never rises', async () => {
    // Balance never changes (credits still confirming on-chain).
    mockElectronAPI.turbo.getBalance.mockResolvedValue(BASE);

    const { container } = renderManager();
    await settle();
    await initiateCryptoTopUp();
    await returnToApp();

    // Immediate attempt (1) has run: mount + 1.
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Credits added/i)).not.toBeInTheDocument();

    // Drive the remaining attempts (2..8) — one per interval.
    for (let i = 0; i < POLL_MAX_ATTEMPTS - 1; i++) {
      await advance(POLL_INTERVAL_MS);
    }

    // Exactly MAX_ATTEMPTS balance checks ran (mount + 8), then the poll stopped.
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(1 + POLL_MAX_ATTEMPTS);

    const timeoutMsg = screen.getByText(/No new credits detected yet/i);
    expect(timeoutMsg).toBeInTheDocument();
    expect(timeoutMsg).toHaveTextContent(/Click Refresh to check again/i);
    // Never claims credits arrived, and is NOT styled as an error.
    expect(screen.queryByText(/Credits added/i)).not.toBeInTheDocument();
    expect(timeoutMsg.closest('.tcm-error-message')).toBeNull();
    expect(container.querySelector('.tcm-error-message')).toBeNull();

    // Terminated: no further fetches after the cap.
    const callsAtStop = mockElectronAPI.turbo.getBalance.mock.calls.length;
    await advance(POLL_INTERVAL_MS * 4);
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(callsAtStop);
  });

  it('does NOT start a second poll (no stacked timers) if the user re-focuses mid-poll', async () => {
    mockElectronAPI.turbo.getBalance.mockResolvedValue(BASE);

    renderManager();
    await settle();

    // First top-up + return -> one poll running (immediate attempt = call #2).
    await initiateCryptoTopUp();
    await returnToApp();
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2);

    // User re-initiates and re-focuses WHILE the poll is still running. The
    // running-guard must prevent a second immediate fetch / second timer chain.
    await initiateCryptoTopUp(); // re-arms the initiated flag, no fetch itself
    await returnToApp();
    // No second immediate fetch fired: the running poll was NOT restarted.
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2);

    // Advancing ONE interval yields exactly ONE more fetch (call #3), not two —
    // there is a single timer chain, so no stacked/overlapping polls.
    await advance(POLL_INTERVAL_MS);
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(3);

    // ...and each subsequent interval likewise advances by exactly one.
    await advance(POLL_INTERVAL_MS);
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(4);
  });

  it('cancels a running poll and forces an immediate fetch when Refresh is clicked', async () => {
    mockElectronAPI.turbo.getBalance.mockResolvedValue(BASE);

    renderManager();
    await settle();
    await initiateCryptoTopUp();
    await returnToApp();

    // Poll running: immediate attempt = call #2, next scheduled at +interval.
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(2);

    // Click the balance-card Refresh -> immediate fetch (#3) AND poll cancelled.
    const refreshBtn = screen.getByLabelText('Refresh Turbo Credits balance');
    await act(async () => {
      fireEvent.click(refreshBtn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(3);

    // With the poll cancelled, advancing time triggers NO scheduled attempt.
    await advance(POLL_INTERVAL_MS * 4);
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(3);
  });

  it('clears the poll timer on unmount (no leak, no post-unmount fetch/setState)', async () => {
    mockElectronAPI.turbo.getBalance.mockResolvedValue(BASE);
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderManager();
    await settle();
    await initiateCryptoTopUp();
    await returnToApp();

    // Poll running with a pending timer (immediate attempt already ran = #2).
    const callsAtUnmount = mockElectronAPI.turbo.getBalance.mock.calls.length;
    expect(callsAtUnmount).toBe(2);

    unmount();

    // The pending timer must have been cleared: advancing well past several
    // intervals triggers no further balance fetches (no leaked timer).
    await advance(POLL_INTERVAL_MS * (POLL_MAX_ATTEMPTS + 2));
    expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalledTimes(callsAtUnmount);

    // No post-unmount React state-update warning was emitted.
    expect(consoleErr).not.toHaveBeenCalledWith(
      expect.stringContaining('unmounted'),
      expect.anything()
    );
    consoleErr.mockRestore();
  });
});
