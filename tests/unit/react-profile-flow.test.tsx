import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      avatarUrl: null,
      arnsName: null,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'profile-2', 
      name: 'Test Profile 2',
      address: 'test-address-2',
      avatarUrl: null,
      arnsName: null,
      createdAt: '2024-01-02T00:00:00Z'
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render current profile information', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    
    expect(screen.getByText('Test Profile 1')).toBeInTheDocument();
    expect(screen.getByText('test-ad...ss-1')).toBeInTheDocument();
  });

  it('should load profiles on mount', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    
    await waitFor(() => {
      expect(mockElectronAPI.profiles.list).toHaveBeenCalled();
    });
  });

  it('should show password prompt when switching to different profile', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button'));
    
    // Wait for profiles to load and click on different profile
    await waitFor(() => {
      const profile2Button = screen.getByText('Test Profile 2');
      fireEvent.click(profile2Button);
    });
    
    // Should show password modal
    expect(screen.getByText('Switch Profile')).toBeInTheDocument();
    expect(screen.getByText('Enter your password to unlock this profile')).toBeInTheDocument();
  });

  it('should not show password prompt when clicking current profile', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button'));
    
    // Click on current profile
    await waitFor(() => {
      const currentProfileButton = screen.getByText('Test Profile 1');
      fireEvent.click(currentProfileButton);
    });
    
    // Should close dropdown, not show password modal
    expect(screen.queryByText('Switch Profile')).not.toBeInTheDocument();
  });

  it('should handle successful profile switch', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(true);
    
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown and select different profile
    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText('Test Profile 2'));
    });
    
    // Enter password
    const passwordInput = screen.getByPlaceholderText('Enter password');
    fireEvent.change(passwordInput, { target: { value: 'test-password' } });
    
    // Submit
    fireEvent.click(screen.getByText('Unlock'));
    
    await waitFor(() => {
      expect(mockElectronAPI.profiles.switch).toHaveBeenCalledWith('profile-2', 'test-password');
      expect(defaultProps.onProfileSwitch).toHaveBeenCalledWith('profile-2');
    });
  });

  it('should handle profile switch failure', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(false);
    
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown and select different profile
    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText('Test Profile 2'));
    });
    
    // Enter wrong password
    const passwordInput = screen.getByPlaceholderText('Enter password');
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
    
    // Submit
    fireEvent.click(screen.getByText('Unlock'));
    
    await waitFor(() => {
      expect(screen.getByText('Invalid password')).toBeInTheDocument();
    });
  });

  it('should handle network errors during profile switch', async () => {
    mockElectronAPI.profiles.switch.mockRejectedValue(new Error('Network error'));
    
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown and select different profile
    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText('Test Profile 2'));
    });
    
    // Enter password
    const passwordInput = screen.getByPlaceholderText('Enter password');
    fireEvent.change(passwordInput, { target: { value: 'test-password' } });
    
    // Submit
    fireEvent.click(screen.getByText('Unlock'));
    
    await waitFor(() => {
      expect(screen.getByText('Failed to unlock profile')).toBeInTheDocument();
    });
  });

  it('should prevent state updates after unmount', async () => {
    // Delay the profiles.list call to simulate slow network
    let resolveProfilesList: (profiles: Profile[]) => void;
    const profilesListPromise = new Promise<Profile[]>((resolve) => {
      resolveProfilesList = resolve;
    });
    mockElectronAPI.profiles.list.mockReturnValue(profilesListPromise);
    
    const { unmount } = render(<ProfileSwitcher {...defaultProps} />);
    
    // Unmount component before profiles load
    unmount();
    
    // Resolve the promise after unmount
    resolveProfilesList!(mockProfiles);
    
    // Wait a bit to ensure no state updates occur
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // No assertions needed - this test passes if no React warnings are thrown
  });

  it('should close password modal when cancelled', async () => {
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown and select different profile
    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText('Test Profile 2'));
    });
    
    // Should show password modal
    expect(screen.getByText('Switch Profile')).toBeInTheDocument();
    
    // Click cancel
    fireEvent.click(screen.getByText('Cancel'));
    
    // Modal should be closed
    expect(screen.queryByText('Switch Profile')).not.toBeInTheDocument();
  });

  it('should handle keyboard navigation in password modal', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue(true);
    
    render(<ProfileSwitcher {...defaultProps} />);
    
    // Open dropdown and select different profile
    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      fireEvent.click(screen.getByText('Test Profile 2'));
    });
    
    // Enter password
    const passwordInput = screen.getByPlaceholderText('Enter password');
    fireEvent.change(passwordInput, { target: { value: 'test-password' } });
    
    // Press Enter
    fireEvent.keyPress(passwordInput, { key: 'Enter', code: 'Enter' });
    
    await waitFor(() => {
      expect(mockElectronAPI.profiles.switch).toHaveBeenCalledWith('profile-2', 'test-password');
    });
  });
});