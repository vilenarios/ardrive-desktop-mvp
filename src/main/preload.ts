import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Wallet operations
  wallet: {
    import: (walletPath: string, password: string) => 
      ipcRenderer.invoke('wallet:import', walletPath, password),
    importFromSeedPhrase: (seedPhrase: string, password: string) =>
      ipcRenderer.invoke('wallet:import-from-seed-phrase', seedPhrase, password),
    importFromKeyfile: (walletPath: string, password: string) =>
      ipcRenderer.invoke('wallet:import', walletPath, password),
    createNew: (password: string) =>
      ipcRenderer.invoke('wallet:create-new', password),
    generate: (password: string) =>
      ipcRenderer.invoke('wallet:create-new', password),
    completeSetup: () =>
      Promise.resolve(true),
    getInfo: () => 
      ipcRenderer.invoke('wallet:get-info'),
    ensureLoaded: () =>
      ipcRenderer.invoke('wallet:ensure-loaded'),
    isLoaded: () =>
      ipcRenderer.invoke('wallet:is-loaded'),
    hasStoredWallet: () =>
      ipcRenderer.invoke('wallet:has-stored'),
    clearStored: () =>
      ipcRenderer.invoke('wallet:clear-stored'),
    logout: () =>
      ipcRenderer.invoke('wallet:logout'),
    export: (options: {
      format: 'jwk-encrypted' | 'jwk-plain' | 'seed-phrase' | 'private-key';
      password: string;
      newPassword?: string;
    }) => ipcRenderer.invoke('wallet:export', options),
  },

  // Drive operations
  drive: {
    list: () => 
      ipcRenderer.invoke('drive:list'),
    create: (name: string, privacy?: 'private' | 'public') => 
      ipcRenderer.invoke('drive:create', name, privacy),
    select: (driveId: string) => 
      ipcRenderer.invoke('drive:select', driveId),
    getMetadata: (mappingId: string) =>
      ipcRenderer.invoke('drive:get-metadata', mappingId),
    refreshMetadata: (mappingId: string) =>
      ipcRenderer.invoke('drive:refresh-metadata', mappingId),
  },

  // Sync operations
  sync: {
    getFolder: () => 
      ipcRenderer.invoke('sync:getFolder'),
    setFolder: (folderPath: string) => 
      ipcRenderer.invoke('sync:setFolder', folderPath),
    start: () => 
      ipcRenderer.invoke('sync:start'),
    stop: () => 
      ipcRenderer.invoke('sync:stop'),
    getStatus: () => 
      ipcRenderer.invoke('sync:status'),
  },

  // File operations
  files: {
    getUploads: () => 
      ipcRenderer.invoke('files:get-uploads'),
    getDownloads: () =>
      ipcRenderer.invoke('files:get-downloads'),
    redownloadAll: () =>
      ipcRenderer.invoke('files:redownload-all'),
  },

  // Upload approval queue operations
  uploads: {
    getPending: () =>
      ipcRenderer.invoke('uploads:get-pending'),
    approve: (uploadId: string, uploadMethod?: 'ar' | 'turbo') =>
      ipcRenderer.invoke('uploads:approve', uploadId, uploadMethod),
    reject: (uploadId: string) =>
      ipcRenderer.invoke('uploads:reject', uploadId),
    approveAll: () =>
      ipcRenderer.invoke('uploads:approve-all'),
    rejectAll: () =>
      ipcRenderer.invoke('uploads:reject-all'),
  },

  // Config operations
  config: {
    get: () => 
      ipcRenderer.invoke('config:get'),
    markFirstRunComplete: () =>
      ipcRenderer.invoke('config:mark-first-run-complete'),
    clearDrive: () =>
      ipcRenderer.invoke('config:clear-drive'),
    clearFolder: () =>
      ipcRenderer.invoke('config:clear-folder'),
  },

  // Dialog operations
  dialog: {
    selectFolder: () => 
      ipcRenderer.invoke('dialog:select-folder'),
    selectWallet: () => 
      ipcRenderer.invoke('dialog:select-wallet'),
  },

  // Shell operations
  shell: {
    openExternal: (url: string) => 
      ipcRenderer.invoke('shell:open-external', url),
    openPath: (path: string) =>
      ipcRenderer.invoke('shell:open-path', path),
  },
  
  // Payment operations
  payment: {
    openWindow: (url: string) =>
      ipcRenderer.invoke('payment:open-window', url),
    onPaymentCompleted: (callback: () => void) => {
      ipcRenderer.on('payment-completed', callback);
    },
    removePaymentCompletedListener: () => {
      ipcRenderer.removeAllListeners('payment-completed');
    },
  },

  // Security operations
  security: {
    isKeychainAvailable: () =>
      ipcRenderer.invoke('security:is-keychain-available'),
    getMethod: () =>
      ipcRenderer.invoke('security:get-method'),
  },

  // Turbo operations
  turbo: {
    getBalance: () =>
      ipcRenderer.invoke('turbo:get-balance'),
    getUploadCosts: (bytes: number) =>
      ipcRenderer.invoke('turbo:get-upload-costs', bytes),
    getFiatEstimate: (byteCount: number, currency?: string) =>
      ipcRenderer.invoke('turbo:get-fiat-estimate', byteCount, currency),
    createCheckoutSession: (amount: number, currency?: string) =>
      ipcRenderer.invoke('turbo:create-checkout-session', amount, currency),
    topUpWithTokens: (tokenAmount: number, feeMultiplier?: number) =>
      ipcRenderer.invoke('turbo:top-up-with-tokens', tokenAmount, feeMultiplier),
    isInitialized: () =>
      ipcRenderer.invoke('turbo:is-initialized'),
    getStatus: () =>
      ipcRenderer.invoke('turbo:get-status'),
  },
  
  // Event listeners
  onWalletInfoUpdated: (callback: (walletInfo: any) => void) => {
    ipcRenderer.on('wallet-info-updated', (_, walletInfo) => callback(walletInfo));
  },
  removeWalletInfoUpdatedListener: () => {
    ipcRenderer.removeAllListeners('wallet-info-updated');
  },
  
  // ArNS operations
  arns: {
    getProfile: (address: string) =>
      ipcRenderer.invoke('arns:get-profile', address),
  },

  // Profile operations
  profiles: {
    list: () =>
      ipcRenderer.invoke('profiles:list'),
    getActive: () =>
      ipcRenderer.invoke('profiles:get-active'),
    switch: (profileId: string, password?: string) =>
      ipcRenderer.invoke('profiles:switch', profileId, password),
    update: (profileId: string, updates: any) =>
      ipcRenderer.invoke('profiles:update', profileId, updates),
    delete: (profileId: string) =>
      ipcRenderer.invoke('profiles:delete', profileId),
  },
  
  profile: {
    getActive: () =>
      ipcRenderer.invoke('profiles:get-active'),
  },

  // Multi-drive mapping operations
  driveMappings: {
    list: () =>
      ipcRenderer.invoke('drive-mappings:list'),
    add: (driveMapping: any) =>
      ipcRenderer.invoke('drive-mappings:add', driveMapping),
    update: (mappingId: string, updates: any) =>
      ipcRenderer.invoke('drive-mappings:update', mappingId, updates),
    remove: (mappingId: string) =>
      ipcRenderer.invoke('drive-mappings:remove', mappingId),
    getById: (mappingId: string) =>
      ipcRenderer.invoke('drive-mappings:get-by-id', mappingId),
    getPrimary: () =>
      ipcRenderer.invoke('drive-mappings:get-primary'),
  },

  // Multi-drive sync operations
  multiSync: {
    start: (mappingId?: string) =>
      ipcRenderer.invoke('multi-sync:start', mappingId),
    stop: (mappingId?: string) =>
      ipcRenderer.invoke('multi-sync:stop', mappingId),
    getStatus: () =>
      ipcRenderer.invoke('multi-sync:status'),
  },

  // Enhanced file operations
  multiFiles: {
    getUploadsByMapping: (mappingId: string) =>
      ipcRenderer.invoke('files:get-uploads-by-mapping', mappingId),
  },

  // Error reporting
  error: {
    reportError: (errorData: {
      message: string;
      stack?: string;
      componentStack?: string;
      timestamp: string;
    }) => ipcRenderer.invoke('error:report', errorData),
  },

  // Event listeners
  onSyncStatusUpdate: (callback: (status: any) => void) => {
    ipcRenderer.on('sync:status-update', (_, status) => callback(status));
  },
  onUploadProgress: (callback: (upload: any) => void) => {
    ipcRenderer.on('upload:progress', (_, upload) => callback(upload));
  },
  onDriveUpdate: (callback: () => void) => {
    ipcRenderer.on('drive:update', () => callback());
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;