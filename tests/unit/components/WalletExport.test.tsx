// SEC-12 (AUDIT §4.11): wallet-export reveal-mask bug.
//
// `showExportData` used to double as "show the result screen" AND "reveal the
// secret" — it was set true on export success, so the seed phrase / private
// key rendered fully revealed the moment export completed and the mask
// branches were unreachable. These tests pin the fixed contract: after a
// successful export the secret renders MASKED, and an explicit reveal button
// toggles visibility on and off.
//
// Scope extension (PM, 2026-07-03): the plain (unencrypted) JWK keyfile is
// the same defect class and gets the same masked-until-reveal contract. The
// encrypted keyfile is password-protected — not raw secret material — and
// deliberately renders directly (contract pinned below).
//
// wallet.export is mocked with sentinel secrets — this suite never touches
// real key material.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WalletExport from '../../../src/renderer/components/WalletExport';

const SENTINEL_SEED =
  'sentinelalpha sentinelbravo sentinelcharlie sentineldelta sentinelecho sentinelfoxtrot ' +
  'sentinelgolf sentinelhotel sentinelindia sentineljuliett sentinelkilo sentinellima';

const SENTINEL_PRIVATE_KEY = 'SENTINEL-PRIVATE-KEY-MATERIAL-0123456789abcdef';

const SENTINEL_JWK =
  '{"kty":"RSA","n":"SENTINEL-JWK-MODULUS","d":"SENTINEL-JWK-PRIVATE-EXPONENT","e":"AQAB"}';

// Mock the window.electronAPI (override the global setup stub)
const mockElectronAPI = {
  wallet: {
    export: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('WalletExport reveal-mask (SEC-12)', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(<WalletExport walletAddress="test-address-1234567890" onClose={mockOnClose} />);

  /**
   * Drive the export flow to the result screen for a dangerous (non-encrypted)
   * format: select format → enter password → Continue → final warning →
   * confirm → "Export Successful".
   */
  const completeExport = async (
    optionTitle: 'Seed Phrase' | 'Private Key' | 'Unencrypted Keyfile'
  ) => {
    renderComponent();

    fireEvent.click(screen.getByText(optionTitle).closest('button') as HTMLButtonElement);

    fireEvent.change(screen.getByPlaceholderText('Enter your wallet password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByText('Continue'));

    // Dangerous formats show a final warning interstitial before exporting
    fireEvent.click(await screen.findByText('I Understand the Risks - Export'));

    await screen.findByText('Export Successful');
  };

  describe('seed phrase export', () => {
    beforeEach(() => {
      // UX-3: outer IpcResult envelope wraps the inner ExportResult.
      mockElectronAPI.wallet.export.mockResolvedValue({
        success: true,
        data: { success: true, data: SENTINEL_SEED },
      });
    });

    it('renders the seed phrase MASKED after export completes', async () => {
      await completeExport('Seed Phrase');

      expect(mockElectronAPI.wallet.export).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'seed-phrase' })
      );

      // No word of the seed phrase may be in the DOM until explicitly revealed
      expect(document.body.textContent).not.toContain('sentinelalpha');
      expect(document.body.textContent).not.toContain('sentinellima');
      expect(screen.getByText('••••• ••••• ••••• •••••')).toBeInTheDocument();
      expect(screen.getByText('Reveal Seed Phrase')).toBeInTheDocument();
    });

    it('reveals the seed phrase on explicit click, and masks it again on toggle', async () => {
      await completeExport('Seed Phrase');

      // Explicit reveal → every word visible
      fireEvent.click(screen.getByText('Reveal Seed Phrase'));
      expect(await screen.findByText('sentinelalpha')).toBeInTheDocument();
      expect(screen.getByText('sentinellima')).toBeInTheDocument();

      // Toggle back → masked again
      fireEvent.click(screen.getByText('Hide Seed Phrase'));
      expect(document.body.textContent).not.toContain('sentinelalpha');
      expect(screen.getByText('••••• ••••• ••••• •••••')).toBeInTheDocument();
    });
  });

  describe('private key export', () => {
    beforeEach(() => {
      mockElectronAPI.wallet.export.mockResolvedValue({
        success: true,
        data: { success: true, data: SENTINEL_PRIVATE_KEY },
      });
    });

    it('renders the private key MASKED after export completes', async () => {
      await completeExport('Private Key');

      expect(mockElectronAPI.wallet.export).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'private-key' })
      );

      expect(document.body.textContent).not.toContain(SENTINEL_PRIVATE_KEY);
      expect(document.body.textContent).toContain('•'.repeat(64));
      expect(screen.getByText('Reveal Private Key')).toBeInTheDocument();
    });

    it('reveals the private key on explicit click, and masks it again on toggle', async () => {
      await completeExport('Private Key');

      fireEvent.click(screen.getByText('Reveal Private Key'));
      expect(document.body.textContent).toContain(SENTINEL_PRIVATE_KEY);

      fireEvent.click(screen.getByText('Hide Private Key'));
      expect(document.body.textContent).not.toContain(SENTINEL_PRIVATE_KEY);
      expect(document.body.textContent).toContain('•'.repeat(64));
    });
  });

  describe('plain JWK (unencrypted keyfile) export', () => {
    beforeEach(() => {
      mockElectronAPI.wallet.export.mockResolvedValue({
        success: true,
        data: { success: true, data: SENTINEL_JWK },
      });
    });

    it('renders the plain JWK MASKED after export completes', async () => {
      await completeExport('Unencrypted Keyfile');

      expect(mockElectronAPI.wallet.export).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'jwk-plain' })
      );

      expect(document.body.textContent).not.toContain('SENTINEL-JWK-PRIVATE-EXPONENT');
      expect(document.body.textContent).not.toContain('SENTINEL-JWK-MODULUS');
      expect(document.body.textContent).toContain('•'.repeat(64));
      expect(screen.getByText('Reveal Keyfile')).toBeInTheDocument();
    });

    it('reveals the plain JWK on explicit click, and masks it again on toggle', async () => {
      await completeExport('Unencrypted Keyfile');

      fireEvent.click(screen.getByText('Reveal Keyfile'));
      expect(document.body.textContent).toContain('SENTINEL-JWK-PRIVATE-EXPONENT');

      fireEvent.click(screen.getByText('Hide Keyfile'));
      expect(document.body.textContent).not.toContain('SENTINEL-JWK-PRIVATE-EXPONENT');
      expect(document.body.textContent).toContain('•'.repeat(64));
    });
  });

  describe('encrypted keyfile export (deliberately unmasked)', () => {
    it('renders the password-protected keyfile directly — no reveal gate', async () => {
      mockElectronAPI.wallet.export.mockResolvedValue({
        success: true,
        data: { success: true, data: '{"ciphertext":"SENTINEL-ENCRYPTED-BLOB"}' },
      });

      renderComponent();

      fireEvent.click(
        screen.getByText('Encrypted Keyfile').closest('button') as HTMLButtonElement
      );
      fireEvent.change(screen.getByPlaceholderText('Enter your wallet password'), {
        target: { value: 'correct-horse-battery' },
      });
      // Encrypted export has no final-warning interstitial
      fireEvent.click(screen.getByText('Continue'));

      await screen.findByText('Export Successful');

      expect(document.body.textContent).toContain('SENTINEL-ENCRYPTED-BLOB');
      expect(document.body.textContent).not.toContain('Reveal');
    });
  });
});
