// MONEY-13: UserMenu is the persistent header widget that displays the AR
// balance app-wide. wallet-manager-secure.getWalletInfo() can report the AR
// balance as unavailable (e.g. a gateway 429 masquerading as the balance
// body) via balance: '' - this must render as an explicit "Unavailable"
// state, never the literal string "NaN".
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserMenu from '../../../src/renderer/components/UserMenu';
import { Profile } from '../../../src/types';

const profile: Profile = {
  id: 'profile-1',
  name: 'Test Profile',
  address: 'fake-address-1234567890abcdef',
  createdAt: new Date(),
  lastUsedAt: new Date(),
};

const baseProps = {
  currentProfile: profile,
  onShowSettings: vi.fn(),
  onShowTurboManager: vi.fn(),
  onShowWalletExport: vi.fn(),
  onLogout: vi.fn(),
};

// UserMenu shows the dropdown (and the balance row) only once opened.
const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /test profile/i }));
};

describe('UserMenu AR balance display (MONEY-13)', () => {
  it('renders the normal numeric balance correctly', () => {
    // UserMenu's formatBalance rounds values >= 1 to 2 decimals - assert
    // against its real formatting, not a re-derivation of the value.
    render(<UserMenu {...baseProps} walletBalance="1.2345" />);
    openMenu();

    expect(screen.getByText('1.23 AR')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('renders "Unavailable" (not "NaN AR", not "0 AR") when the balance is unavailable ("")', () => {
    render(<UserMenu {...baseProps} walletBalance="" />);
    openMenu();

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText('0 AR')).toBeNull();
  });

  it('renders "Unavailable" (never "NaN AR") for a stray non-numeric balance string', () => {
    // Defense-in-depth: even if a non-numeric value slipped through (the
    // pre-fix arweave.js bug produced the literal string 'NaN'), the
    // renderer must never surface that verbatim.
    render(<UserMenu {...baseProps} walletBalance="NaN" />);
    openMenu();

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/NaN AR/)).toBeNull();
  });

  it('a genuine zero balance still renders as "0 AR", distinct from unavailable', () => {
    render(<UserMenu {...baseProps} walletBalance="0" />);
    openMenu();

    expect(screen.getByText('0 AR')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });
});
