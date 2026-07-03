import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileSwitcher from '../../src/renderer/components/ProfileSwitcher';
import { Profile } from '../../src/types';

// Mock electron API
const mockElectronAPI = {
  profiles: {
    list: vi.fn(),
    switch: vi.fn(),
    getActive: vi.fn()
  }
};

// Setup global window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

describe('ProfileSwitcher Component', () => {
  const mockProfiles: Profile[] = [
    {
      id: 'profile-1',
      name: 'Test Profile 1',
      address: 'test-address-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      lastUsedAt: new Date('2024-01-01T00:00:00Z')
    },
    {
      id: 'profile-2',
      name: 'Test Profile 2',
      address: 'test-address-2',
      createdAt: new Date('2024-01-02T00:00:00Z'),
      lastUsedAt: new Date('2024-01-02T00:00:00Z')
    }
  ];

  const defaultProps = {
    currentProfile: mockProfiles[0],
    onProfileSwitch: vi.fn(),
    onAddProfile: vi.fn(),
    onManageProfiles: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.profiles.list.mockResolvedValue(mockProfiles);
  });

  /** Opens the profile dropdown and returns a scoped query helper for it. */
  const openDropdown = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Test Profile 1/ }));
    const dropdown = document.querySelector('.profile-dropdown');
    expect(dropdown).not.toBeNull();
    return within(dropdown as HTMLElement);
  };

  /** Opens the dropdown and selects the non-current profile to trigger the password prompt. */
  const openPasswordPrompt = async () => {
    const dropdown = await openDropdown();
    fireEvent.click(await dropdown.findByText('Test Profile 2'));
    expect(
      screen.getByText('Enter your password to unlock this profile')
    ).toBeInTheDocument();
  };

  it('should render the current profile name and shortened address', () => {
    render(<ProfileSwitcher {...defaultProps} />);

    expect(screen.getByText('Test Profile 1')).toBeInTheDocument();
    // formatAddress: first 6 chars + '...' + last 4 chars
    expect(screen.getByText('test-a...ss-1')).toBeInTheDocument();
  });

  it('should load profiles on mount and list them in the dropdown', async () => {
    render(<ProfileSwitcher {...defaultProps} />);

    await waitFor(() => {
      expect(mockElectronAPI.profiles.list).toHaveBeenCalled();
    });

    const dropdown = await openDropdown();
    expect(await dropdown.findByText('Test Profile 2')).toBeInTheDocument();
    expect(dropdown.getByText('Add Profile')).toBeInTheDocument();
    expect(dropdown.getByText('Manage Profiles')).toBeInTheDocument();
  });

  it('should show password prompt when switching to a different profile', async () => {
    render(<ProfileSwitcher {...defaultProps} />);

    await openPasswordPrompt();

    expect(screen.getByRole('heading', { name: 'Switch Profile' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    // The switch only happens after a password is submitted
    expect(mockElectronAPI.profiles.switch).not.toHaveBeenCalled();
  });

  it('should not show password prompt when clicking the current profile', async () => {
    render(<ProfileSwitcher {...defaultProps} />);

    const dropdown = await openDropdown();
    fireEvent.click(await dropdown.findByText('Test Profile 1'));

    // Dropdown closes without prompting for a password
    expect(screen.queryByPlaceholderText('Enter password')).not.toBeInTheDocument();
    expect(document.querySelector('.profile-dropdown')).toBeNull();
    expect(defaultProps.onProfileSwitch).not.toHaveBeenCalled();
  });

  it('should handle successful profile switch', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(true);

    render(<ProfileSwitcher {...defaultProps} />);
    await openPasswordPrompt();

    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'test-password' }
    });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(mockElectronAPI.profiles.switch).toHaveBeenCalledWith('profile-2', 'test-password');
      expect(defaultProps.onProfileSwitch).toHaveBeenCalledWith('profile-2');
    });

    // Modal closes after a successful switch
    expect(screen.queryByPlaceholderText('Enter password')).not.toBeInTheDocument();
  });

  it('should show an error and keep the modal open on wrong password', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(false);

    render(<ProfileSwitcher {...defaultProps} />);
    await openPasswordPrompt();

    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'wrong-password' }
    });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(screen.getByText('Invalid password')).toBeInTheDocument();
    });

    // Modal stays open, parent is not notified
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    expect(defaultProps.onProfileSwitch).not.toHaveBeenCalled();
  });

  it('should handle errors thrown during profile switch', async () => {
    mockElectronAPI.profiles.switch.mockRejectedValue(new Error('Network error'));

    render(<ProfileSwitcher {...defaultProps} />);
    await openPasswordPrompt();

    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'test-password' }
    });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(screen.getByText('Failed to unlock profile')).toBeInTheDocument();
    });
    expect(defaultProps.onProfileSwitch).not.toHaveBeenCalled();
  });

  it('should close the password modal when cancelled', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    await openPasswordPrompt();

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('Enter password')).not.toBeInTheDocument();
    expect(mockElectronAPI.profiles.switch).not.toHaveBeenCalled();
  });

  it('should disable the unlock button until a password is entered', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    await openPasswordPrompt();

    const unlockButton = screen.getByText('Unlock').closest('button') as HTMLButtonElement;
    expect(unlockButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Enter password'), {
      target: { value: 'test-password' }
    });

    expect(unlockButton).not.toBeDisabled();
  });

  it('should submit the password with the Enter key', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(true);

    render(<ProfileSwitcher {...defaultProps} />);
    await openPasswordPrompt();

    const passwordInput = screen.getByPlaceholderText('Enter password');
    fireEvent.change(passwordInput, { target: { value: 'test-password' } });
    // charCode is required for React's synthetic keyPress event to fire
    fireEvent.keyPress(passwordInput, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => {
      expect(mockElectronAPI.profiles.switch).toHaveBeenCalledWith('profile-2', 'test-password');
    });
  });

  it('should invoke the add-profile action from the dropdown', async () => {
    render(<ProfileSwitcher {...defaultProps} />);

    const dropdown = await openDropdown();
    fireEvent.click(dropdown.getByText('Add Profile'));

    expect(defaultProps.onAddProfile).toHaveBeenCalled();
    // Dropdown closes after selecting an action
    expect(document.querySelector('.profile-dropdown')).toBeNull();
  });

  // NOTE: a "should prevent state updates after unmount" test was removed here.
  // The component guards setState via isMountedRef, but React 18 makes
  // post-unmount setState a silent no-op (the unmounted-component warning was
  // removed), so no assertion could detect a regression — the test could not
  // meaningfully fail.
});
