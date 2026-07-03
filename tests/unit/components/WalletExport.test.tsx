// SEC-12 (AUDIT §4.11): wallet-export reveal-mask bug.
//
// `showExportData` used to double as "show the result screen" AND "reveal the
// secret" — it was set true on export success, so the seed phrase / private
// key rendered fully revealed the moment export completed and the mask
// branches were unreachable. These tests pin the fixed contract: after a
// successful export the secret renders MASKED, and an explicit reveal button
// toggles visibility on and off.
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
  const completeExport = async (optionTitle: 'Seed Phrase' | 'Private Key') => {
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
      mockElectronAPI.wallet.export.mockResolvedValue({
        success: true,
        data: SENTINEL_SEED,
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
        data: SENTINEL_PRIVATE_KEY,
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
});
