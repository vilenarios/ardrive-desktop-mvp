// TRUST-3 (DESIGN-8) + UX-34: the recovery-phrase import field had three bugs.
// (1) [TRUST-3] The inline error hardcoded "must contain exactly 12 words"
// even though, at the time, ClientInputValidator.validateSeedPhrase
// (input-validator.ts) accepted 12 *or* 24 words -- a valid 24-word phrase
// was told it was wrong.
// (2) [TRUST-3] The error (and the textarea's red `.invalid` border)
// rendered on every keystroke, so the field was red for ~95% of normal
// typing.
// (3) [UX-34] The "12 or 24 words" story itself was wrong: ardrive-core-js
// only ever derives an Arweave wallet from a 12-word BIP-39 phrase (see
// wallet-manager-secure.ts / ardrive-core-js SeedPhrase) -- a 24-word phrase
// always failed at derivation with "...exactly 12 words", so inviting one
// here just produced a guaranteed confusing failure later. The validator and
// all onboarding copy now agree: 12 words, no more, no less.
//
// These tests pin the corrected contract: no error while the field is merely
// being typed into (a neutral word count shows instead), the validator's own
// "12 words" message is used verbatim once the field is left (blur) or
// submit is attempted, a well-formed 12-word phrase is accepted without
// complaint, and a 24-word phrase is now correctly rejected (not silently
// waved through) so the UI never invites input it will then fail on.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WalletSetup from '../../../src/renderer/components/WalletSetup';
import { ThemeProvider } from '../../../src/renderer/contexts/ThemeContext';

const mockElectronAPI = {
  system: {
    getEnv: vi.fn().mockResolvedValue({ success: false }),
  },
  config: {
    get: vi.fn().mockResolvedValue({ success: false }),
    setTheme: vi.fn(),
  },
  dialog: {
    selectWallet: vi.fn(),
  },
  wallet: {
    generate: vi.fn(),
    importFromKeyfile: vi.fn(),
    importFromSeedPhrase: vi.fn(),
    completeSetup: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

function renderWalletSetup() {
  return render(
    <ThemeProvider>
      <WalletSetup onWalletImported={vi.fn()} />
    </ThemeProvider>
  );
}

async function goToSeedPhraseImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Import Existing Account'));
  await user.click(screen.getByText('Recovery Phrase'));
}

const twelveWords = 'apple bravo delta echo foxtrot golf hotel india juliet kilo lima mango';
const twentyFourWords = `${twelveWords} nectar orange papaya quince raisin sable tango umbra violet walnut xray yam`;

describe('Seed-phrase import validation (TRUST-3 / UX-34)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.system.getEnv.mockResolvedValue({ success: false });
    mockElectronAPI.config.get.mockResolvedValue({ success: false });
  });

  it('does not show any error while the user is still typing (only a neutral word count)', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12-word recovery phrase/i);
    await user.type(textarea, 'apple bravo charlie delta echo');

    // No red/danger error surfaced yet -- just an informational count.
    expect(screen.queryByText(/12 expected/i)).toBeInTheDocument();
    expect(screen.queryByText(/must contain/i)).not.toBeInTheDocument();
    expect(textarea.className).not.toContain('invalid');
  });

  it('surfaces the validator\'s real "12 words" message once the field is blurred', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12-word recovery phrase/i);
    // 5 real words (well over the validator's 20-char floor) so the error is
    // actually the word-count message, not the separate "too short" one.
    await user.type(textarea, 'apple bravo charlie delta echo');
    fireEvent.blur(textarea);

    expect(await screen.findByText(/seed phrase must contain exactly 12 words/i)).toBeInTheDocument();
    expect(textarea.className).toContain('invalid');
  });

  it('rejects a 24-word phrase with the accurate "12 words" error, instead of accepting it', async () => {
    // UX-34 regression test: a 24-word phrase (e.g. from a Ledger) must never
    // be waved through as "valid" here only to fail later at derivation --
    // the UI must reject it up front with copy that matches reality.
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12-word recovery phrase/i);
    await user.type(textarea, twentyFourWords);
    fireEvent.blur(textarea);

    expect(await screen.findByText(/seed phrase must contain exactly 12 words/i)).toBeInTheDocument();
    expect(textarea.className).toContain('invalid');
    // The old, inaccurate "12 or 24" framing must never resurface.
    expect(screen.queryByText(/12 or 24/i)).not.toBeInTheDocument();
  });

  it('accepts a well-formed 12-word phrase without any error after blur', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12-word recovery phrase/i);
    await user.type(textarea, twelveWords);
    fireEvent.blur(textarea);

    expect(screen.queryByText(/must contain/i)).not.toBeInTheDocument();
    expect(textarea.className).not.toContain('invalid');
  });

  it('never advertises 24-word support anywhere on the import screen', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    expect(screen.queryByText(/12 or 24/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/24-word/i)).not.toBeInTheDocument();
  });
});
