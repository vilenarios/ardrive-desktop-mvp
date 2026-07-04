// TRUST-3 (DESIGN-8): the recovery-phrase import field had two bugs.
// (1) The inline error hardcoded "must contain exactly 12 words" even though
// ClientInputValidator.validateSeedPhrase (input-validator.ts) has always
// accepted 12 *or* 24 words -- a valid 24-word phrase was told it was wrong.
// (2) The error (and the textarea's red `.invalid` border) rendered on every
// keystroke, so the field was red for ~95% of normal typing. These tests pin
// the fixed contract: no error while the field is merely being typed into
// (a neutral word count shows instead), the validator's own message is used
// verbatim once the field is left (blur) or submit is attempted, and a
// well-formed 24-word phrase is accepted without complaint.
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

describe('Seed-phrase import validation (TRUST-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.system.getEnv.mockResolvedValue({ success: false });
    mockElectronAPI.config.get.mockResolvedValue({ success: false });
  });

  it('never shows the factually wrong "exactly 12 words" message', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12 or 24-word recovery phrase/i);
    await user.type(textarea, 'apple bravo charlie delta echo');
    fireEvent.blur(textarea);

    expect(screen.queryByText(/exactly 12 words/i)).not.toBeInTheDocument();
  });

  it('does not show any error while the user is still typing (only a neutral word count)', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12 or 24-word recovery phrase/i);
    await user.type(textarea, 'apple bravo charlie delta echo');

    // No red/danger error surfaced yet -- just an informational count.
    expect(screen.queryByText(/12 or 24 expected/i)).toBeInTheDocument();
    expect(screen.queryByText(/must contain/i)).not.toBeInTheDocument();
    expect(textarea.className).not.toContain('invalid');
  });

  it('surfaces the validator\'s real "12 or 24 words" message once the field is blurred', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12 or 24-word recovery phrase/i);
    // 5 real words (well over the validator's 20-char floor) so the error is
    // actually the word-count message, not the separate "too short" one.
    await user.type(textarea, 'apple bravo charlie delta echo');
    fireEvent.blur(textarea);

    expect(await screen.findByText(/seed phrase must contain exactly 12 or 24 words/i)).toBeInTheDocument();
    expect(textarea.className).toContain('invalid');
  });

  it('accepts a well-formed 24-word phrase without any error, before or after blur', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12 or 24-word recovery phrase/i);
    await user.type(textarea, twentyFourWords);
    fireEvent.blur(textarea);

    expect(screen.queryByText(/must contain/i)).not.toBeInTheDocument();
    expect(textarea.className).not.toContain('invalid');
  });

  it('accepts a well-formed 12-word phrase without any error after blur', async () => {
    const user = userEvent.setup();
    renderWalletSetup();
    await goToSeedPhraseImport(user);

    const textarea = screen.getByPlaceholderText(/12 or 24-word recovery phrase/i);
    await user.type(textarea, twelveWords);
    fireEvent.blur(textarea);

    expect(screen.queryByText(/must contain/i)).not.toBeInTheDocument();
    expect(textarea.className).not.toContain('invalid');
  });
});
