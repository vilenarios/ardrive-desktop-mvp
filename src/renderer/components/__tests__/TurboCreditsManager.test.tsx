import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TurboCreditsManager from '../TurboCreditsManager';
import { WalletInfo } from '../../../types';

// Mock the window.electronAPI
const mockElectronAPI = {
  turbo: {
    getBalance: jest.fn(),
    getFiatEstimate: jest.fn(),
    createCheckoutSession: jest.fn(),
    topUpWithTokens: jest.fn(),
    isInitialized: jest.fn(),
    getStatus: jest.fn(),
    getUploadCosts: jest.fn(),
  },
  payment: {
    openWindow: jest.fn(),
    onPaymentCompleted: jest.fn(),
    removePaymentCompletedListener: jest.fn(),
  },
  onWalletInfoUpdated: jest.fn(),
  removeWalletInfoUpdatedListener: jest.fn(),
};

// Override the global setup
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('TurboCreditsManager', () => {
  const mockWalletInfo: WalletInfo = {
    address: 'test-address-123',
    balance: '1.000000',
    walletType: 'arweave',
    turboBalance: '0.500000',
    turboWinc: '500000000000',
  };

  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    mockElectronAPI.turbo.getBalance.mockResolvedValue({
      ar: '0.500000',
      winc: '500000000000'
    });
    
    mockElectronAPI.turbo.getFiatEstimate.mockResolvedValue({
      amount: 10,
      winc: '1000000000000',
      currency: 'usd'
    });
    
    mockElectronAPI.turbo.isInitialized.mockResolvedValue(true);
    mockElectronAPI.turbo.getStatus.mockResolvedValue({
      isInitialized: true,
      hasBalance: true,
      balance: { ar: '0.500000', winc: '500000000000' }
    });
    
    mockElectronAPI.turbo.getUploadCosts.mockResolvedValue({
      winc: '1000',
      adjustments: []
    });
  });

  it('should render the TurboCreditsManager component', async () => {
    render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
    
    expect(screen.getByText('Turbo Credits Manager')).toBeInTheDocument();
    expect(screen.getByText('← Back')).toBeInTheDocument();
  });

  it('should display current balance', async () => {
    render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
    
    await waitFor(() => {
      expect(screen.getByText(/0\.500000 AR/)).toBeInTheDocument();
    });
  });

  it('should handle back button click', () => {
    render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('← Back'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  describe('Fiat Top-up', () => {
    it('should update amount input', async () => {
      const user = userEvent.setup();
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      const amountInput = screen.getByLabelText(/Amount/);
      await user.clear(amountInput);
      await user.type(amountInput, '25');
      
      expect(amountInput).toHaveValue('25');
    });

    it('should update currency selection', async () => {
      const user = userEvent.setup();
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      const currencySelect = screen.getByLabelText(/Currency/);
      await user.selectOptions(currencySelect, 'EUR');
      
      expect(currencySelect).toHaveValue('EUR');
    });

    it('should handle successful payment window opening', async () => {
      const user = userEvent.setup();
      mockElectronAPI.turbo.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/test-session',
        id: 'cs_test_123'
      });
      
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      // Wait for component to settle and button to show correct text
      await waitFor(() => {
        expect(screen.getByText('Pay with Card')).toBeInTheDocument();
      });
      
      const payButton = screen.getByText('Pay with Card');
      await user.click(payButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.turbo.createCheckoutSession).toHaveBeenCalledWith(10, 'USD');
        expect(mockElectronAPI.payment.openWindow).toHaveBeenCalledWith('https://checkout.stripe.com/test-session');
      });
      
      expect(screen.getByText(/Payment window opened/)).toBeInTheDocument();
    });

    it('should handle payment errors', async () => {
      const user = userEvent.setup();
      mockElectronAPI.turbo.createCheckoutSession.mockRejectedValue(new Error('Payment failed'));
      
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      // Wait for component to settle and button to show correct text
      await waitFor(() => {
        expect(screen.getByText('Pay with Card')).toBeInTheDocument();
      });
      
      const payButton = screen.getByText('Pay with Card');
      await user.click(payButton);
      
      await waitFor(() => {
        expect(screen.getByText(/Payment failed/)).toBeInTheDocument();
      });
    });

    it('should validate amount input', async () => {
      const user = userEvent.setup();
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      // Wait for component to settle and button to show correct text
      await waitFor(() => {
        expect(screen.getByText('Pay with Card')).toBeInTheDocument();
      });
      
      const amountInput = screen.getByLabelText(/Amount/);
      const payButton = screen.getByText('Pay with Card');
      
      await user.clear(amountInput);
      await user.type(amountInput, '0');
      await user.click(payButton);
      
      await waitFor(() => {
        expect(screen.getByText(/Please enter a valid amount/)).toBeInTheDocument();
      });
    });
  });

  describe('Token Top-up', () => {
    it('should handle token top-up', async () => {
      const user = userEvent.setup();
      mockElectronAPI.turbo.topUpWithTokens.mockResolvedValue({
        transactionId: 'tx-123'
      });
      
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      // Wait for component to settle
      await waitFor(() => {
        expect(screen.getByText('Top Up with AR')).toBeInTheDocument();
      });
      
      const tokenAmountInput = screen.getByDisplayValue('0.001');
      const topUpButton = screen.getByText('Top Up with AR');
      
      await user.clear(tokenAmountInput);
      await user.type(tokenAmountInput, '0.5');
      await user.click(topUpButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.turbo.topUpWithTokens).toHaveBeenCalledWith(0.5, 1.0);
      });
    });

    it('should handle token top-up errors', async () => {
      const user = userEvent.setup();
      mockElectronAPI.turbo.topUpWithTokens.mockRejectedValue(new Error('Insufficient balance'));
      
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      // Wait for component to settle
      await waitFor(() => {
        expect(screen.getByText('Top Up with AR')).toBeInTheDocument();
      });
      
      const topUpButton = screen.getByText('Top Up with AR');
      await user.click(topUpButton);
      
      await waitFor(() => {
        expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
      });
    });
  });

  describe('Debug Information', () => {
    it('should display debug information', async () => {
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      await waitFor(() => {
        expect(screen.getByText(/Turbo Debug Information/)).toBeInTheDocument();
        expect(screen.getByText(/Turbo Initialized:/)).toBeInTheDocument();
        expect(screen.getByText(/Yes/)).toBeInTheDocument();
      });
    });

    it('should show error state in debug info', async () => {
      mockElectronAPI.turbo.isInitialized.mockResolvedValue(false);
      mockElectronAPI.turbo.getStatus.mockResolvedValue({
        isInitialized: false,
        hasBalance: false,
        error: 'Failed to initialize'
      });
      
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      await waitFor(() => {
        expect(screen.getByText(/No/)).toBeInTheDocument();
        expect(screen.getByText(/Failed to initialize/)).toBeInTheDocument();
      });
    });
  });

  describe('Event Listeners', () => {
    it('should set up payment completion listener', () => {
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      expect(mockElectronAPI.payment.onPaymentCompleted).toHaveBeenCalled();
      expect(mockElectronAPI.onWalletInfoUpdated).toHaveBeenCalled();
    });

    it('should clean up listeners on unmount', () => {
      const { unmount } = render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      unmount();
      
      expect(mockElectronAPI.payment.removePaymentCompletedListener).toHaveBeenCalled();
      expect(mockElectronAPI.removeWalletInfoUpdatedListener).toHaveBeenCalled();
    });
  });

  describe('Loading States', () => {
    it('should show loading state during operations', async () => {
      const user = userEvent.setup();
      // Make the checkout session hang to test loading state
      mockElectronAPI.turbo.createCheckoutSession.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ url: 'test' }), 1000))
      );
      
      render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);
      
      // Wait for component to settle
      await waitFor(() => {
        expect(screen.getByText('Pay with Card')).toBeInTheDocument();
      });
      
      const payButton = screen.getByText('Pay with Card');
      await user.click(payButton);
      
      // Should be disabled during loading and show loading text
      await waitFor(() => {
        expect(screen.getByText('Creating Session...')).toBeInTheDocument();
      });
      
      const loadingButton = screen.getByText('Creating Session...');
      expect(loadingButton).toBeDisabled();
    });
  });
});