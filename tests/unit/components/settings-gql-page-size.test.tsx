// CORE-10: core-js 4.2.0 added a tunable GraphQL page size
// (setGqlPageSize/getGqlPageSize, default 1000 = the ar.io gateway max); some
// gateways (e.g. Goldsky) reject page requests that large. These tests drive
// the new Settings "GraphQL Page Size" field against the real IPC shapes
// (the D-005 envelope, not a raw value), mirroring
// tests/unit/components/settings-gateway.test.tsx's pattern for the sibling
// Gateway field.
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
    getGqlPageSize: vi.fn(),
    setGqlPageSize: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('Settings — GraphQL Page Size (CORE-10)', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    config: { syncFolder: '/sync/folder' } as any,
    onShowWalletExport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no override configured yet — resolves the app default.
    mockElectronAPI.config.getGqlPageSize.mockResolvedValue({ success: true, data: 1000 });
  });

  it('shows the default (1000) placeholder/value when nothing is configured', async () => {
    render(<Settings {...defaultProps} />);
    const input = (await screen.findByLabelText('Page size')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('1000'));
    expect(input.placeholder).toBe('1000');
  });

  it('seeds from `config.gqlPageSize` before the IPC fetch resolves', () => {
    mockElectronAPI.config.getGqlPageSize.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gqlPageSize: 250 } as any} />);
    const input = screen.getByLabelText('Page size') as HTMLInputElement;
    expect(input.value).toBe('250');
  });

  it('fetches the authoritative value from main on open and overrides the seed', async () => {
    mockElectronAPI.config.getGqlPageSize.mockResolvedValue({ success: true, data: 100 });
    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gqlPageSize: 1000 } as any} />);

    await waitFor(() => {
      expect(mockElectronAPI.config.getGqlPageSize).toHaveBeenCalled();
    });
    const input = (await screen.findByLabelText('Page size')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('100'));
  });

  it('keeps the seeded value when the fetch fails (non-critical setting)', async () => {
    mockElectronAPI.config.getGqlPageSize.mockRejectedValue(new Error('IPC unavailable'));
    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gqlPageSize: 500 } as any} />);

    // Give the rejected promise a tick to settle.
    await waitFor(() => expect(mockElectronAPI.config.getGqlPageSize).toHaveBeenCalled());
    const input = screen.getByLabelText('Page size') as HTMLInputElement;
    expect(input.value).toBe('500');
  });

  it('persists a valid page size via config.setGqlPageSize and shows confirmation', async () => {
    mockElectronAPI.config.setGqlPageSize.mockResolvedValue({ success: true, data: 100 });

    render(<Settings {...defaultProps} />);
    await screen.findByLabelText('Page size');
    const input = screen.getByLabelText('Page size');
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockElectronAPI.config.setGqlPageSize).toHaveBeenCalledWith(100);
    });
    expect(await screen.findByText('GraphQL page size saved.')).toBeInTheDocument();
  });

  it('surfaces the validator error and keeps the field editable when the IPC call resolves { success: false }', async () => {
    mockElectronAPI.config.setGqlPageSize.mockResolvedValue({
      success: false,
      error: 'gqlPageSize cannot exceed 1000',
    });

    render(<Settings {...defaultProps} />);
    await screen.findByLabelText('Page size');
    const input = screen.getByLabelText('Page size');
    // Bypass the client-side [1,1000] guard so the IPC call actually fires
    // (fireEvent.change doesn't enforce the number input's min/max).
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockElectronAPI.config.setGqlPageSize).toHaveBeenCalledWith(500);
    });

    expect(await screen.findByText('gqlPageSize cannot exceed 1000')).toBeInTheDocument();
    expect(screen.queryByText('GraphQL page size saved.')).not.toBeInTheDocument();
    expect((screen.getByLabelText('Page size') as HTMLInputElement).value).toBe('500');
  });

  it('refuses to submit an out-of-range value (2000) client-side, without calling the IPC handler', async () => {
    render(<Settings {...defaultProps} />);
    await screen.findByLabelText('Page size');
    const input = screen.getByLabelText('Page size');
    fireEvent.change(input, { target: { value: '2000' } });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Enter a whole number between 1 and 1000.')).toBeInTheDocument();
    expect(mockElectronAPI.config.setGqlPageSize).not.toHaveBeenCalled();
  });

  it('refuses to submit a non-integer value (3.5) client-side, without calling the IPC handler', async () => {
    render(<Settings {...defaultProps} />);
    await screen.findByLabelText('Page size');
    const input = screen.getByLabelText('Page size');
    fireEvent.change(input, { target: { value: '3.5' } });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Enter a whole number between 1 and 1000.')).toBeInTheDocument();
    expect(mockElectronAPI.config.setGqlPageSize).not.toHaveBeenCalled();
  });

  it('"Reset to Default" saves 1000 directly', async () => {
    mockElectronAPI.config.getGqlPageSize.mockResolvedValue({ success: true, data: 100 });
    mockElectronAPI.config.setGqlPageSize.mockResolvedValue({ success: true, data: 1000 });

    render(<Settings {...defaultProps} config={{ syncFolder: '/sync/folder', gqlPageSize: 100 } as any} />);
    const input = (await screen.findByLabelText('Page size')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('100'));

    // "Reset to Default" also appears on the sibling Gateway field — this
    // section's button is the one that follows it in DOM order.
    const resetButtons = screen.getAllByText('Reset to Default');
    fireEvent.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() => {
      expect(mockElectronAPI.config.setGqlPageSize).toHaveBeenCalledWith(1000);
    });
    expect((await screen.findByLabelText('Page size') as HTMLInputElement).value).toBe('1000');
  });

  it('disables "Reset to Default" once the field already reads the default (1000)', async () => {
    render(<Settings {...defaultProps} />);
    await waitFor(() => {
      expect((screen.getByLabelText('Page size') as HTMLInputElement).value).toBe('1000');
    });
    const resetButtons = screen.getAllByText('Reset to Default');
    // The second occurrence belongs to the GraphQL Page Size section (the
    // first is the Gateway field's own Reset to Default button).
    expect(resetButtons.length).toBeGreaterThanOrEqual(2);
    expect(resetButtons[resetButtons.length - 1]).toBeDisabled();
  });
});
