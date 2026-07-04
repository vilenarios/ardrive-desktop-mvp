// INFO-3: SYNC-17 wired the gateway host backend (src/main/gateway.ts,
// config:set-gateway IPC + InputValidator.validateGatewayHost) but shipped no
// UI to view/change it. These tests drive the new Settings "Gateway" field
// against the real IPC shapes (the envelope, not a raw value - D-005), and
// pin the client-side guard against sending an empty host.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Settings from '../../../src/renderer/components/Settings';

const mockElectronAPI = {
  dialog: {
    selectFolder: vi.fn(),
  },
  sync: {
    setFolder: vi.fn(),
    start: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
  config: {
    setGateway: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('Settings — Gateway host (INFO-3)', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    config: { syncFolder: '/sync/folder' } as any,
    onShowWalletExport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the turbo-gateway.com placeholder when no gateway is configured', () => {
    render(<Settings {...defaultProps} />);
    const input = screen.getByLabelText('Gateway host') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('turbo-gateway.com');
  });

  it('pre-fills the field with a previously configured gateway host', () => {
    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gatewayHost: 'my-gateway.example' } as any} />);
    const input = screen.getByLabelText('Gateway host') as HTMLInputElement;
    expect(input.value).toBe('my-gateway.example');
  });

  it('persists a valid host via the existing config.setGateway IPC path and shows confirmation', async () => {
    mockElectronAPI.config.setGateway.mockResolvedValue({ success: true, data: undefined });

    render(<Settings {...defaultProps} />);
    const input = screen.getByLabelText('Gateway host');
    fireEvent.change(input, { target: { value: 'ar-io.dev' } });
    fireEvent.click(screen.getByText('Save Gateway'));

    await waitFor(() => {
      expect(mockElectronAPI.config.setGateway).toHaveBeenCalledWith('ar-io.dev');
    });
    expect(await screen.findByText('Gateway saved.')).toBeInTheDocument();
  });

  it('surfaces the validator error and keeps the field editable when the IPC call resolves { success: false }', async () => {
    // InputValidator.validateGatewayHost rejects hosts carrying a protocol/
    // path/port - main.ts resolves { success:false, error } for this rather
    // than throwing (D-005 envelope), so the UI must branch on it explicitly.
    mockElectronAPI.config.setGateway.mockResolvedValue({
      success: false,
      error: 'gatewayHost must match pattern',
    });

    render(<Settings {...defaultProps} />);
    const input = screen.getByLabelText('Gateway host');
    fireEvent.change(input, { target: { value: 'https://bad host/' } });
    fireEvent.click(screen.getByText('Save Gateway'));

    expect(await screen.findByText('gatewayHost must match pattern')).toBeInTheDocument();
    expect(screen.queryByText('Gateway saved.')).not.toBeInTheDocument();
    // The invalid value stays in the field so the user can fix it in place.
    expect((screen.getByLabelText('Gateway host') as HTMLInputElement).value).toBe('https://bad host/');
  });

  it('refuses to submit an empty host client-side, without calling the IPC handler', async () => {
    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gatewayHost: 'my-gateway.example' } as any} />);
    const input = screen.getByLabelText('Gateway host');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save Gateway'));

    expect(await screen.findByText('Enter a gateway host, or use Reset to Default.')).toBeInTheDocument();
    expect(mockElectronAPI.config.setGateway).not.toHaveBeenCalled();
  });

  it('"Reset to Default" saves turbo-gateway.com directly', async () => {
    mockElectronAPI.config.setGateway.mockResolvedValue({ success: true, data: undefined });

    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gatewayHost: 'my-gateway.example' } as any} />);
    fireEvent.click(screen.getByText('Reset to Default'));

    await waitFor(() => {
      expect(mockElectronAPI.config.setGateway).toHaveBeenCalledWith('turbo-gateway.com');
    });
    expect((await screen.findByLabelText('Gateway host') as HTMLInputElement).value).toBe('turbo-gateway.com');
  });

  it('disables "Reset to Default" once the field already reads the default host', () => {
    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gatewayHost: 'turbo-gateway.com' } as any} />);
    expect(screen.getByText('Reset to Default')).toBeDisabled();
  });
});
