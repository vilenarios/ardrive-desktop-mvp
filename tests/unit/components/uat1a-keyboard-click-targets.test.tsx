// UAT-1a / A11Y-5: the wallet-import dropzone (WalletSetup.tsx) and Activity
// rows (ActivityTab.tsx) were `<div onClick>` with no role/tabIndex/keyboard
// handler — a keyboard-only user could never reach them. These tests drive
// real keyboard interaction (Tab reachability + Enter/Space activation)
// against the actual components, kept in their own file so neither needs the
// other's module mocked out.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityTab } from '../../../src/renderer/components/dashboard/ActivityTab';
import WalletSetup from '../../../src/renderer/components/WalletSetup';
import { ThemeProvider } from '../../../src/renderer/contexts/ThemeContext';

describe('UAT-1a: ActivityTab activity rows are real tab stops (A11Y-5)', () => {
  it('a completed upload row is keyboard-focusable and Enter-activatable', () => {
    const upload = {
      id: 'u1',
      fileName: 'photo.png',
      fileSize: 1024,
      status: 'completed',
      progress: 100,
      createdAt: new Date(),
      completedAt: new Date(),
      driveId: 'drive-a',
    };
    const onViewFile = vi.fn();

    render(
      <ActivityTab
        uploads={[upload as any]}
        downloads={[]}
        pendingUploads={[]}
        config={{ syncFolder: '/sync' } as any}
        drive={{ id: 'drive-a', name: 'Drive A' } as any}
        onViewFile={onViewFile}
      />
    );

    const row = screen.getByRole('button', { name: /photo\.png/i });
    expect(row).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onViewFile).toHaveBeenCalledWith(upload);

    onViewFile.mockClear();
    fireEvent.keyDown(row, { key: ' ' });
    expect(onViewFile).toHaveBeenCalledWith(upload);
  });
});

describe('UAT-1a: WalletSetup wallet-file dropzone is a real tab stop (A11Y-5)', () => {
  const mockElectronAPI = {
    dialog: {
      selectWallet: vi.fn(),
    },
    system: {
      getEnv: vi.fn().mockResolvedValue({ success: false }),
    },
    config: {
      get: vi.fn().mockResolvedValue({ success: false }),
      setTheme: vi.fn(),
    },
    wallet: {
      generate: vi.fn(),
      importFromKeyfile: vi.fn(),
      importFromSeedPhrase: vi.fn(),
      completeSetup: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.dialog.selectWallet.mockResolvedValue({ success: true, data: null });
    mockElectronAPI.system.getEnv.mockResolvedValue({ success: false });
    mockElectronAPI.config.get.mockResolvedValue({ success: false });
    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
    });
  });

  const renderWalletSetup = () =>
    render(
      <ThemeProvider>
        <WalletSetup onWalletImported={vi.fn()} />
      </ThemeProvider>
    );

  it('the dropzone is reachable via Tab and Enter triggers the same file-browse action as a click', async () => {
    renderWalletSetup();

    // Step 1: choose "Import Existing Account"
    fireEvent.click(screen.getByText(/Import Existing Account/i));
    // Default import method is 'file', which renders the dropzone directly.

    const dropzone = await screen.findByRole('button', {
      name: /Browse for a wallet file, or drag and drop one here/i,
    });
    expect(dropzone).toHaveAttribute('tabIndex', '0');

    fireEvent.keyDown(dropzone, { key: 'Enter' });
    expect(mockElectronAPI.dialog.selectWallet).toHaveBeenCalled();
  });
});
