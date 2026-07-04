// UX-7: profiles.switch() collapses every login failure into a plain
// `false`, so ProfileManagement (the boot-time login screen for an existing
// profile) always showed the same "Invalid password. Please try again."
// message — even when the real cause was a corrupted/unreadable wallet file,
// not a wrong password. wallet-manager-secure now records the specific cause
// via getLastAuthError(); this screen must surface it distinctly instead of
// always guessing "wrong password".
//
// wallet:get-last-auth-error is a NEW IPC handler, so per D-005 it returns
// the {success, data} envelope, not a raw string — the mocks below use that
// real shape (not a clean/raw string) so this test can't pass against broken
// production wiring (the exact trap noted in CLAUDE.md).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileManagement from '../../../src/renderer/components/ProfileManagement';
import { Profile } from '../../../src/types';

const mockElectronAPI = {
  profiles: {
    list: vi.fn(),
    switch: vi.fn(),
    delete: vi.fn(),
  },
  wallet: {
    getLastAuthError: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const profile: Profile = {
  id: 'profile-1',
  name: 'Test Profile',
  address: 'test-address-1',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  lastUsedAt: new Date('2024-01-01T00:00:00Z'),
};

describe('ProfileManagement login error surfacing (UX-7)', () => {
  const onProfileSelected = vi.fn();
  const onCreateNewProfile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.profiles.list.mockResolvedValue([profile]);
  });

  const submitPassword = async (value: string) => {
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    const input = await screen.findByPlaceholderText('Enter your password');
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('shows "Invalid password" on a wrong password', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(false);
    mockElectronAPI.wallet.getLastAuthError.mockResolvedValue({
      success: true,
      data: 'Invalid password',
    });

    render(
      <ProfileManagement onProfileSelected={onProfileSelected} onCreateNewProfile={onCreateNewProfile} />
    );

    await submitPassword('wrong-password');

    expect(await screen.findByText('Invalid password. Please try again.')).toBeInTheDocument();
    expect(onProfileSelected).not.toHaveBeenCalled();
  });

  it('shows a distinct message for a corrupted/unreadable wallet file, not "Invalid password"', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(false);
    mockElectronAPI.wallet.getLastAuthError.mockResolvedValue({
      success: true,
      data: 'Invalid wallet data format',
    });

    render(
      <ProfileManagement onProfileSelected={onProfileSelected} onCreateNewProfile={onCreateNewProfile} />
    );

    await submitPassword('correct-password');

    const message = await screen.findByText(/Could not unlock this profile/i);
    expect(message).toBeInTheDocument();
    expect(message.textContent).toContain('Invalid wallet data format');
    expect(screen.queryByText('Invalid password. Please try again.')).not.toBeInTheDocument();
    expect(onProfileSelected).not.toHaveBeenCalled();
  });

  it('falls back to the generic message when no reason is available (data: null)', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(false);
    mockElectronAPI.wallet.getLastAuthError.mockResolvedValue({ success: true, data: null });

    render(
      <ProfileManagement onProfileSelected={onProfileSelected} onCreateNewProfile={onCreateNewProfile} />
    );

    await submitPassword('wrong-password');

    expect(await screen.findByText('Invalid password. Please try again.')).toBeInTheDocument();
  });

  it('falls back to the generic message when the reason lookup itself fails (envelope success:false)', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(false);
    mockElectronAPI.wallet.getLastAuthError.mockResolvedValue({
      success: false,
      error: 'IPC failure',
    });

    render(
      <ProfileManagement onProfileSelected={onProfileSelected} onCreateNewProfile={onCreateNewProfile} />
    );

    await submitPassword('wrong-password');

    expect(await screen.findByText('Invalid password. Please try again.')).toBeInTheDocument();
  });

  it('still logs in successfully on the correct password', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(true);

    render(
      <ProfileManagement onProfileSelected={onProfileSelected} onCreateNewProfile={onCreateNewProfile} />
    );

    await submitPassword('correct-password');

    await waitFor(() => {
      expect(onProfileSelected).toHaveBeenCalledWith(profile, 'correct-password');
    });
    expect(mockElectronAPI.wallet.getLastAuthError).not.toHaveBeenCalled();
  });
});
