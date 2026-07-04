// UX-3 (+ PRIV-2 qa-gate finding): the PrivateDriveUnlockModal used to hardcode
// 'Invalid password' on ANY failed unlock, so a network/gateway verification
// failure was misreported to the user as a wrong password. The unlock now
// resolves { success, error } and the modal renders the SPECIFIC error.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PrivateDriveUnlockModal } from '../../../src/renderer/components/PrivateDriveUnlockModal';

const lockedDrive = {
  id: 'drive-locked',
  name: 'Locked Drive',
  privacy: 'private',
  rootFolderId: 'root-2',
  isLocked: true,
  emojiFingerprint: '🔒',
} as any;

const NETWORK_ERROR = 'Could not verify the password (network or gateway error). Please try again.';
const WRONG_PASSWORD = 'Invalid password. Please check your password and try again.';

const submitPassword = () => {
  fireEvent.change(screen.getByPlaceholderText('Enter your drive password'), {
    target: { value: 'typed-password' },
  });
  fireEvent.click(screen.getByText('Unlock Drive'));
};

describe('PrivateDriveUnlockModal error display (UX-3)', () => {
  it('shows the SPECIFIC network/gateway error, not a hardcoded wrong-password message', async () => {
    const onUnlock = vi.fn().mockResolvedValue({ success: false, error: NETWORK_ERROR });

    render(
      <PrivateDriveUnlockModal drive={lockedDrive} isOpen onUnlock={onUnlock} onCancel={vi.fn()} />
    );
    submitPassword();

    expect(await screen.findByText(NETWORK_ERROR)).toBeInTheDocument();
    // The bug was that ANY failure printed the wrong-password line.
    expect(screen.queryByText(WRONG_PASSWORD)).not.toBeInTheDocument();
  });

  it('surfaces a wrong-password failure verbatim from the unlock envelope', async () => {
    const onUnlock = vi.fn().mockResolvedValue({ success: false, error: WRONG_PASSWORD });

    render(
      <PrivateDriveUnlockModal drive={lockedDrive} isOpen onUnlock={onUnlock} onCancel={vi.fn()} />
    );
    submitPassword();

    expect(await screen.findByText(WRONG_PASSWORD)).toBeInTheDocument();
  });

  it('falls back to the generic message when the envelope carries no error string', async () => {
    const onUnlock = vi.fn().mockResolvedValue({ success: false });

    render(
      <PrivateDriveUnlockModal drive={lockedDrive} isOpen onUnlock={onUnlock} onCancel={vi.fn()} />
    );
    submitPassword();

    expect(await screen.findByText(WRONG_PASSWORD)).toBeInTheDocument();
  });

  it('clears the password and shows no error on a successful unlock', async () => {
    const onUnlock = vi.fn().mockResolvedValue({ success: true });

    render(
      <PrivateDriveUnlockModal drive={lockedDrive} isOpen onUnlock={onUnlock} onCancel={vi.fn()} />
    );
    submitPassword();

    // PRIV-4: onUnlock now also receives the "remember this drive" choice
    // (default false — the checkbox starts unchecked).
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('typed-password', false));
    expect(screen.queryByText(NETWORK_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(WRONG_PASSWORD)).not.toBeInTheDocument();
  });

  it('PRIV-4: checking "remember this drive" forwards persistKey=true', async () => {
    const onUnlock = vi.fn().mockResolvedValue({ success: true });

    render(
      <PrivateDriveUnlockModal drive={lockedDrive} isOpen onUnlock={onUnlock} onCancel={vi.fn()} />
    );

    // Opt in, then unlock.
    fireEvent.click(screen.getByRole('checkbox'));
    submitPassword();

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('typed-password', true));
  });
});
