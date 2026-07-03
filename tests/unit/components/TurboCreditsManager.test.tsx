// Migrated from src/renderer/components/__tests__/TurboCreditsManager.test.tsx
// (jest) as part of INFRA-2, and updated to the component's current contract
// (tabbed layout: TurboBalanceCard + TurboPurchaseTab; the old debug panel and
// turbo.isInitialized/getStatus calls no longer exist).
//
// All Turbo/payment IPC calls are mocked — this suite can never spend funds.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import TurboCreditsManager from '../../../src/renderer/components/TurboCreditsManager';
import { WalletInfo } from '../../../src/types';

// Mock the window.electronAPI
const mockElectronAPI = {
  wallet: {
    getInfo: vi.fn(),
  },
  turbo: {
    getBalance: vi.fn(),
    getFiatEstimate: vi.fn(),
    createCheckoutSession: vi.fn(),
    topUpWithTokens: vi.fn(),
  },
  payment: {
    openWindow: vi.fn(),
    onPaymentCompleted: vi.fn(),
    removePaymentCompletedListener: vi.fn(),
  },
  onWalletInfoUpdated: vi.fn(),
  removeWalletInfoUpdatedListener: vi.fn(),
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

  const mockOnClose = vi.fn();

  const renderComponent = () =>
    render(<TurboCreditsManager walletInfo={mockWalletInfo} onClose={mockOnClose} />);

  /** The custom-amount purchase button (the "Purchase" tab button shares the same name). */
  const getPurchaseButton = () =>
    document.querySelector('.tcm-purchase-btn') as HTMLButtonElement;

  const getConvertButton = () =>
    document.querySelector('.tcm-convert-btn') as HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();

    mockElectronAPI.wallet.getInfo.mockResolvedValue(mockWalletInfo);
    mockElectronAPI.turbo.getBalance.mockResolvedValue({
      ar: '0.500000',
      winc: '500000000000'
    });
    mockElectronAPI.turbo.getFiatEstimate.mockResolvedValue({
      byteCount: 1024 * 1024 * 1024,
      amount: 10,
      winc: '1000000000000',
      currency: 'usd'
    });
    mockElectronAPI.payment.openWindow.mockResolvedValue(undefined);
  });

  it('should render the Turbo Credits header and back button', async () => {
    renderComponent();

    expect(screen.getByRole('heading', { name: 'Turbo Credits' })).toBeInTheDocument();
    expect(screen.getByText('← Back to Dashboard')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockElectronAPI.turbo.getBalance).toHaveBeenCalled();
    });
  });

  it('should display the current Turbo balance', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('0.500000')).toBeInTheDocument();
    });
    expect(screen.getByText('Turbo Credits Balance')).toBeInTheDocument();
  });

  it('should handle back button click', () => {
    renderComponent();

    fireEvent.click(screen.getByText('← Back to Dashboard'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  describe('Fiat Top-up', () => {
    it('should create a checkout session and open the payment window', async () => {
      mockElectronAPI.turbo.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/test-session',
        id: 'cs_test_123'
      });

      renderComponent();

      // Default custom amount is $10 USD
      fireEvent.click(getPurchaseButton());

      await waitFor(() => {
        expect(mockElectronAPI.turbo.createCheckoutSession).toHaveBeenCalledWith(10, 'USD');
        expect(mockElectronAPI.payment.openWindow).toHaveBeenCalledWith(
          'https://checkout.stripe.com/test-session'
        );
      });

      expect(await screen.findByText(/Payment window opened/)).toBeInTheDocument();
    });

    it('should pass the selected currency to the checkout session', async () => {
      mockElectronAPI.turbo.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/test-session',
        id: 'cs_test_123'
      });

      renderComponent();

      const currencySelect = document.querySelector('.tcm-currency-select select') as HTMLSelectElement;
      fireEvent.change(currencySelect, { target: { value: 'EUR' } });
      expect(currencySelect).toHaveValue('EUR');

      fireEvent.click(getPurchaseButton());

      await waitFor(() => {
        expect(mockElectronAPI.turbo.createCheckoutSession).toHaveBeenCalledWith(10, 'EUR');
      });
    });

    it('should create a checkout session for a quick-buy amount', async () => {
      mockElectronAPI.turbo.createCheckoutSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/test-session',
        id: 'cs_test_123'
      });

      renderComponent();

      fireEvent.click(screen.getByText('$25').closest('button') as HTMLButtonElement);

      await waitFor(() => {
        expect(mockElectronAPI.turbo.createCheckoutSession).toHaveBeenCalledWith(25, 'USD');
      });
    });

    it('should handle payment errors', async () => {
      mockElectronAPI.turbo.createCheckoutSession.mockRejectedValue(new Error('Payment failed'));

      renderComponent();

      fireEvent.click(getPurchaseButton());

      await waitFor(() => {
        expect(screen.getByText(/Payment failed/)).toBeInTheDocument();
      });
      expect(mockElectronAPI.payment.openWindow).not.toHaveBeenCalled();
    });

    it('should validate the amount before creating a session', async () => {
      renderComponent();

      const amountInput = document.querySelector('.tcm-amount-input') as HTMLInputElement;
      fireEvent.change(amountInput, { target: { value: '0' } });

      fireEvent.click(getPurchaseButton());

      await waitFor(() => {
        expect(screen.getByText(/Amount must be at least/)).toBeInTheDocument();
      });
      expect(mockElectronAPI.turbo.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('Token Top-up (AR conversion)', () => {
    it('should convert AR to credits', async () => {
      mockElectronAPI.turbo.topUpWithTokens.mockResolvedValue({
        transactionId: 'tx-123'
      });

      renderComponent();

      const tokenInput = screen.getByDisplayValue('0.001');
      fireEvent.change(tokenInput, { target: { value: '0.5' } });

      fireEvent.click(getConvertButton());

      await waitFor(() => {
        expect(mockElectronAPI.turbo.topUpWithTokens).toHaveBeenCalledWith(0.5);
      });
      expect(await screen.findByText(/Successfully converted AR to Turbo Credits/)).toBeInTheDocument();
    });

    it('should handle token top-up errors', async () => {
      mockElectronAPI.turbo.topUpWithTokens.mockRejectedValue(new Error('Insufficient balance'));

      renderComponent();

      fireEvent.click(getConvertButton());

      await waitFor(() => {
        expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
      });
    });
  });

  describe('Event Listeners', () => {
    it('should set up payment completion and wallet update listeners', () => {
      renderComponent();

      expect(mockElectronAPI.payment.onPaymentCompleted).toHaveBeenCalled();
      expect(mockElectronAPI.onWalletInfoUpdated).toHaveBeenCalled();
    });

    it('should clean up listeners on unmount', () => {
      const { unmount } = renderComponent();

      unmount();

      expect(mockElectronAPI.payment.removePaymentCompletedListener).toHaveBeenCalled();
      expect(mockElectronAPI.removeWalletInfoUpdatedListener).toHaveBeenCalled();
    });

    it('calls onWalletRefresh when payment-completed fires (MONEY-6: App must get fresh info by return value, not the dead event channel)', async () => {
      const onWalletRefresh = vi.fn();
      render(
        <TurboCreditsManager
          walletInfo={mockWalletInfo}
          onClose={mockOnClose}
          onWalletRefresh={onWalletRefresh}
        />
      );

      // Capture the payment-completed callback the component registered
      expect(mockElectronAPI.payment.onPaymentCompleted).toHaveBeenCalled();
      const paymentCompletedCallback =
        mockElectronAPI.payment.onPaymentCompleted.mock.calls[0][0];

      // Simulate the main process announcing a completed payment
      act(() => {
        paymentCompletedCallback();
      });

      await waitFor(() => {
        expect(onWalletRefresh).toHaveBeenCalled();
      });
    });
  });

  describe('Auto Top-Up removal (MONEY-4)', () => {
    // Matches "Auto Top-Up", "auto top-up", "Automatic Top-Up", "autoTopUp", …
    const autoTopUpPattern = /auto(?:matic)?[\s-]*top[\s-]*up/i;

    const getTabButtons = () =>
      Array.from(document.querySelectorAll('.tcm-tab')) as HTMLButtonElement[];

    it('renders no Auto Top-Up controls or save affordance on any tab', async () => {
      renderComponent();

      // Let the mount-time balance load settle before walking the tabs.
      await screen.findByText('0.500000');

      const tabs = getTabButtons();
      expect(tabs.length).toBe(4);

      for (const tab of tabs) {
        fireEvent.click(tab);

        // No Auto Top-Up copy anywhere in the rendered document
        expect(document.body.textContent).not.toMatch(autoTopUpPattern);

        // No toggle, threshold/amount settings inputs, or save affordance
        expect(document.querySelector('.tcm-toggle')).toBeNull();
        expect(document.querySelector('.tcm-setting-input')).toBeNull();
        expect(document.querySelector('.tcm-save-btn')).toBeNull();
        expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
        expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
      }
    });

    it('cannot show a "Saved!" confirmation because no save control exists', async () => {
      renderComponent();
      await screen.findByText('0.500000');

      // Open the Settings tab, where the fake save confirmation used to live
      const settingsTab = getTabButtons().find((b) => b.textContent?.includes('Settings'));
      expect(settingsTab).toBeDefined();
      fireEvent.click(settingsTab!);

      // The tab still renders its remaining content...
      expect(screen.getByText('Usage Statistics')).toBeInTheDocument();

      // ...but there is no enable toggle that could reveal a save control,
      // and nothing to click that could claim settings were saved.
      expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
      expect(document.querySelector('.tcm-toggle')).toBeNull();
      expect(document.querySelector('.tcm-save-btn')).toBeNull();
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
      expect(document.querySelector('.tcm-saved-indicator')).toBeNull();
      expect(screen.queryByText(/saved!?/i)).not.toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should show a processing state while the checkout session is created', async () => {
      // Keep the checkout session pending to observe the loading state
      let resolveSession: (session: { url: string }) => void;
      mockElectronAPI.turbo.createCheckoutSession.mockImplementation(
        () => new Promise((resolve) => { resolveSession = resolve; })
      );

      renderComponent();

      // Let the mount-time balance load settle first: it shares the same
      // `loading` flag and would re-enable the button mid-assertion.
      await screen.findByText('0.500000');

      fireEvent.click(getPurchaseButton());

      await waitFor(() => {
        expect(screen.getByText('Processing...')).toBeInTheDocument();
      });
      expect(getPurchaseButton()).toBeDisabled();

      // Resolve and let the flow finish
      resolveSession!({ url: 'https://checkout.stripe.com/test-session' });
      await waitFor(() => {
        expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
      });
    });
  });
});
