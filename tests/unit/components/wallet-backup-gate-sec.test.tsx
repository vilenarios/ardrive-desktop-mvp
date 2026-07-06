// SEC / wallet-safety: the new-account backup gate must be MANDATORY.
//
// For a self-custody wallet, losing the recovery phrase = losing everything,
// with no "forgot password" reset. So the Create-Account flow must (a) actually
// SHOW the generated recovery phrase, (b) tell the truth about "no recovery if
// lost", and (c) BLOCK the finalize/"Continue" action — the only thing that
// persists the account and lets the user reach the dashboard — until the user
// has explicitly confirmed they saved the phrase, with no trivial bypass.
//
// These tests drive the real WalletSetup component. `wallet.generate` and
// `wallet.completeSetup` are mocked with sentinel data (no real wallet / no
// derivation), so the suite asserts the GATE, not the crypto. The seed-phrase
// *derivation* is proven separately in tests/unit/main/seed-import-*.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WalletSetup from '../../../src/renderer/components/WalletSetup';
import { ThemeProvider } from '../../../src/renderer/contexts/ThemeContext';

// A 12-word sentinel "phrase" — not a real mnemonic (generate is mocked), but
// distinctive so we can assert it is actually rendered once revealed.
const SENTINEL_SEED =
  'sentinelalpha sentinelbravo sentinelcharlie sentineldelta sentinelecho sentinelfoxtrot ' +
  'sentinelgolf sentinelhotel sentinelindia sentineljuliett sentinelkilo sentinellima';
const SENTINEL_ADDRESS = 'SENTINELADDRESS_l55sI4sCbT9d9AV6WKz2DQpnW4Ld0Ec';

const mockGenerate = vi.fn();
const mockCompleteSetup = vi.fn();

const mockElectronAPI = {
  system: { getEnv: vi.fn().mockResolvedValue({ success: false }) },
  config: { get: vi.fn().mockResolvedValue({ success: false }), setTheme: vi.fn() },
  dialog: { selectWallet: vi.fn() },
  wallet: {
    generate: mockGenerate,
    importFromKeyfile: vi.fn(),
    importFromSeedPhrase: vi.fn(),
    completeSetup: mockCompleteSetup,
  },
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

function renderWalletSetup(onImported = vi.fn()) {
  return render(
    <ThemeProvider>
      <WalletSetup onWalletImported={onImported} />
    </ThemeProvider>
  );
}

// Drive the Create-Account flow from step 1 up to the recovery-phrase screen.
async function goToRecoveryPhraseStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Create New Account'));

  // Step 2: set a valid, matching password.
  await user.type(screen.getByPlaceholderText('Enter password'), 'correct-horse-battery');
  await user.type(screen.getByPlaceholderText('Re-enter password'), 'correct-horse-battery');
  await user.click(screen.getByRole('button', { name: /Create Account/i }));

  // Step 3 arrives once generate resolves.
  await screen.findByText('Save Your Recovery Phrase');
}

describe('Create-Account backup gate is mandatory (wallet-safety)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      success: true,
      data: { seedPhrase: SENTINEL_SEED, address: SENTINEL_ADDRESS },
    });
    mockCompleteSetup.mockResolvedValue({ success: true, data: { address: SENTINEL_ADDRESS } });
  });

  it('shows the generated recovery phrase (revealable) and the honest "lost = gone forever" copy', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToRecoveryPhraseStep(user);

    // The phrase is presented for the user to save (masked by default, with an
    // explicit reveal) — i.e. it is actually SHOWN, not hidden from the user.
    expect(screen.getByText('Reveal Recovery Phrase')).toBeInTheDocument();
    await user.click(screen.getByText('Reveal Recovery Phrase'));
    expect(await screen.findByText('sentinelalpha')).toBeInTheDocument();
    expect(screen.getByText('sentinellima')).toBeInTheDocument();

    // Honest copy: this is the ONLY way to recover, and losing it is permanent.
    expect(
      screen.getByText(/ONLY way to recover your account/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/you lose access to your files forever/i)
    ).toBeInTheDocument();
  });

  it('DISABLES the finalize button until the confirm checkbox is checked, and enables it after', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToRecoveryPhraseStep(user);

    const finalize = screen.getByRole('button', { name: /Continue to Drive Setup/i });
    const confirmCheckbox = screen.getByRole('checkbox');

    // Gate closed: submit disabled, checkbox unchecked.
    expect(confirmCheckbox).not.toBeChecked();
    expect(finalize).toBeDisabled();

    // User confirms they saved the phrase → gate opens.
    await user.click(confirmCheckbox);
    expect(confirmCheckbox).toBeChecked();
    expect(finalize).toBeEnabled();

    // Unchecking closes the gate again.
    await user.click(confirmCheckbox);
    expect(finalize).toBeDisabled();
  });

  it('does NOT finalize/persist the account while the gate is closed (no bypass)', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    renderWalletSetup(onImported);
    await goToRecoveryPhraseStep(user);

    // Attempt to click the disabled finalize button before confirming.
    const finalize = screen.getByRole('button', { name: /Continue to Drive Setup/i });
    fireEvent.click(finalize);

    // Nothing was persisted and the user did not advance out of setup.
    expect(mockCompleteSetup).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it('finalizes exactly once ONLY after confirmation, then advances the user', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    renderWalletSetup(onImported);
    await goToRecoveryPhraseStep(user);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Continue to Drive Setup/i }));

    await waitFor(() => expect(mockCompleteSetup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it('re-navigating Back from the phrase screen resets the confirmation (cannot carry a stale confirm)', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToRecoveryPhraseStep(user);

    // Confirm, then go Back to the password step.
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /^Back$/i }));

    // Re-create → land on the phrase screen again with the gate CLOSED.
    await user.click(screen.getByRole('button', { name: /Create Account/i }));
    await screen.findByText('Save Your Recovery Phrase');

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Continue to Drive Setup/i })).toBeDisabled();
  });
});
