import { contextBridge, ipcRenderer } from 'electron';
import type { IpcResult } from '../types/ipc';
import type {
  DriveInfo,
  DriveInfoWithStatus,
  PermawebFile,
  FolderNode,
  ManifestCreationResult,
  WalletInfo,
  Profile,
  AppConfig,
  DriveSyncMapping,
  FileUpload,
  FileDownload,
  FileVersion,
  PendingUpload,
  SyncStatus,
} from '../types';
import type { ExportResult } from './wallet-export-manager';
import type { TurboBalance, TurboCosts } from './turbo-manager';
import type { ArNSProfile } from './arns-service';

// UX-3 / D-005: methods whose main-process handler is wrapped in
// `envelopeHandler` are annotated `Promise<IpcResult<T>>`. Because the
// renderer's `window.electronAPI` type is `typeof api`, these annotations flow
// to every call site, so the compiler flags any raw-property access on the
// wrapper (`.id`, `.find()`, `.length`) that skips the `.success`/`.data`
// guard. Un-annotated methods below are handlers not yet migrated (raw shape).

const api = {
  // Wallet operations (UX-3: migrated to the IpcResult envelope)
  wallet: {
    import: (walletPath: string, password: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:import', walletPath, password),
    importFromSeedPhrase: (seedPhrase: string, password: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:import-from-seed-phrase', seedPhrase, password),
    importFromKeyfile: (walletPath: string, password: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:import', walletPath, password),
    createNew: (password: string): Promise<IpcResult<{ seedPhrase: string; address: string }>> =>
      ipcRenderer.invoke('wallet:create-new', password),
    generate: (password: string): Promise<IpcResult<{ seedPhrase: string; address: string }>> =>
      ipcRenderer.invoke('wallet:create-new', password),
    completeSetup: (): Promise<IpcResult<{ address: string }>> =>
      ipcRenderer.invoke('wallet:complete-setup'),
    getInfo: (forceRefresh?: boolean): Promise<IpcResult<WalletInfo | null>> =>
      ipcRenderer.invoke('wallet:get-info', forceRefresh),
    ensureLoaded: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:ensure-loaded'),
    isLoaded: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:is-loaded'),
    hasStoredWallet: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:has-stored'),
    // UX-7: the specific reason the last profiles.switch(id, password)
    // attempt failed (wrong password vs. a corrupted/IO wallet-file
    // failure), so the login UI can distinguish them.
    getLastAuthError: (): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke('wallet:get-last-auth-error'),
    clearStored: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:clear-stored'),
    logout: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('wallet:logout'),
    // UX-3: outer IpcResult envelope wraps the inner ExportResult (which keeps
    // its own success/data/error/warning). Callers unwrap outer, then inner.
    export: (options: {
      format: 'jwk-encrypted' | 'jwk-plain' | 'seed-phrase' | 'private-key';
      password: string;
      newPassword?: string;
    }): Promise<IpcResult<ExportResult>> => ipcRenderer.invoke('wallet:export', options),
  },

  // Drive operations (UX-3: all migrated to the IpcResult envelope)
  drive: {
    list: (): Promise<IpcResult<DriveInfo[]>> =>
      ipcRenderer.invoke('drive:list'),
    create: (name: string, privacy?: 'private' | 'public'): Promise<IpcResult<DriveInfo>> =>
      ipcRenderer.invoke('drive:create', name, privacy),
    select: (driveId: string): Promise<IpcResult<DriveInfo>> =>
      ipcRenderer.invoke('drive:select', driveId),
    rename: (driveId: string, newName: string): Promise<IpcResult<{ newName: string; usedTurbo: boolean }>> =>
      ipcRenderer.invoke('drive:rename', driveId, newName),
    // Dead preload surface (no matching handler) — left un-migrated; no callers.
    getMetadata: (driveId: string) =>
      ipcRenderer.invoke('drive:get-metadata', driveId),
    refreshMetadata: (driveId: string) =>
      ipcRenderer.invoke('drive:refresh-metadata', driveId),
    getPermawebFiles: (driveId: string, forceRefresh?: boolean): Promise<IpcResult<PermawebFile[]>> =>
      ipcRenderer.invoke('drive:get-permaweb-files', driveId, forceRefresh),
    createManifest: (params: {
      driveId: string;
      folderId: string;
      manifestName?: string;
    }): Promise<IpcResult<Omit<ManifestCreationResult, 'success'>>> =>
      ipcRenderer.invoke('drive:create-manifest', params),
    getFolderTree: (driveId: string): Promise<IpcResult<FolderNode[]>> =>
      ipcRenderer.invoke('drive:get-folder-tree', driveId),
    countFolderFiles: (driveId: string, folderId: string): Promise<IpcResult<{ fileCount: number; estimatedCost: number }>> =>
      ipcRenderer.invoke('drive:count-folder-files', driveId, folderId),
    getAll: (): Promise<IpcResult<DriveInfo[]>> =>
      ipcRenderer.invoke('drive:getAll'),
    getMapped: (): Promise<IpcResult<DriveInfo[]>> =>
      ipcRenderer.invoke('drive:getMapped'),
    setActive: (driveId: string, mappingId?: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('drive:setActive', driveId, mappingId),
    getActive: (): Promise<IpcResult<{ driveId: string; mappingId?: string } | null>> =>
      ipcRenderer.invoke('drive:getActive'),
    switchTo: (driveId: string): Promise<IpcResult<DriveInfo>> =>
      ipcRenderer.invoke('drive:switchTo', driveId),
    // Private drive operations
    createPrivate: (name: string, password: string): Promise<IpcResult<DriveInfo>> =>
      ipcRenderer.invoke('drive:create-private', name, password),
    // PRIV-4: persistKey opts this drive's key into encrypted persistence
    // ("remember this drive") so it auto-unlocks next launch.
    unlock: (driveId: string, password: string, persistKey?: boolean): Promise<IpcResult<DriveInfoWithStatus | undefined>> =>
      ipcRenderer.invoke('drive:unlock', driveId, password, persistKey),
    // PRIV-4: read/toggle whether a drive's key is remembered across sessions.
    isPersisted: (driveId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('drive:is-persisted', driveId),
    setPersistence: (driveId: string, persist: boolean): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('drive:set-persistence', driveId, persist),
    lock: (driveId: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('drive:lock', driveId),
    isUnlocked: (driveId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('drive:isUnlocked', driveId),
    listWithStatus: (): Promise<IpcResult<DriveInfoWithStatus[]>> =>
      ipcRenderer.invoke('drive:listWithStatus'),
  },

  // Sync operations
  // Sync operations (UX-3: migrated to the IpcResult envelope)
  sync: {
    getFolder: (): Promise<IpcResult<string | undefined>> =>
      ipcRenderer.invoke('sync:getFolder'),
    setFolder: (folderPath: string, options?: { updateActiveMapping?: boolean }): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('sync:setFolder', folderPath, options),
    start: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('sync:start'),
    stop: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('sync:stop'),
    getStatus: (): Promise<IpcResult<SyncStatus>> =>
      ipcRenderer.invoke('sync:status'),
    manual: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('sync:manual'),
    // SYNC-5: queue an ArFS unhide for a previously-hidden (locally-deleted) entity
    unhideEntity: (params: { driveId: string; entityId: string; entityType: 'file' | 'folder'; name?: string }): Promise<IpcResult<{ id: string }>> =>
      ipcRenderer.invoke('sync:unhide-entity', params),
    // DEBUG methods
    getState: (): Promise<IpcResult<string>> =>
      ipcRenderer.invoke('sync:get-state'),
    forceMonitoring: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('sync:force-monitoring'),
  },

  // File operations (UX-3: migrated to the IpcResult envelope)
  files: {
    getUploads: (): Promise<IpcResult<FileUpload[]>> =>
      ipcRenderer.invoke('files:get-uploads'),
    getDownloads: (): Promise<IpcResult<FileDownload[]>> =>
      ipcRenderer.invoke('files:get-downloads'),
    redownloadAll: (): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('files:redownload-all'),
    // Sync preference operations
    setFileSyncPreference: (fileId: string, preference: 'auto' | 'cloud_only'): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('sync:set-file-preference', fileId, preference),
    queueDownload: (fileId: string, priority?: number): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('sync:queue-download', fileId, priority),
    cancelDownload: (fileId: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('sync:cancel-download', fileId),
    getQueueStatus: (): Promise<IpcResult<{ queued: number; active: number; total: number }>> =>
      ipcRenderer.invoke('sync:get-queue-status'),
    getQueuedDownloads: (limit?: number): Promise<IpcResult<any[]>> =>
      ipcRenderer.invoke('sync:get-queued-downloads', limit),
    // FEAT-6: permanent version history — every recorded ArFS revision of a
    // file (newest-first), for the Version history modal. Read-only.
    getVersions: (filePath: string): Promise<IpcResult<FileVersion[]>> =>
      ipcRenderer.invoke('files:get-versions', filePath),
  },

  // Upload approval queue operations (UX-3: migrated to the IpcResult envelope)
  uploads: {
    getPending: (): Promise<IpcResult<PendingUpload[]>> =>
      ipcRenderer.invoke('uploads:get-pending'),
    // Turbo-only (D-010): 'turbo' is the only accepted upload method.
    // The inner data is a legacy mixed shape (a plain `true` for a queued
    // upload, or an already-processed/metadata-operation summary object);
    // no caller reads it — they only need `.success` to know the request ran.
    approve: (uploadId: string, uploadMethod?: 'turbo'): Promise<IpcResult<
      boolean
      | { alreadyProcessed: true; status: string }
      | { success: true; operationType: string }
    >> =>
      ipcRenderer.invoke('uploads:approve', uploadId, uploadMethod),
    reject: (uploadId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('uploads:reject', uploadId),
    approveAll: (): Promise<IpcResult<{ approvedCount: number; totalCount: number; errors?: string[] }>> =>
      ipcRenderer.invoke('uploads:approve-all'),
    rejectAll: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('uploads:reject-all'),
    cancel: (uploadId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('uploads:cancel', uploadId),
    retry: (uploadId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('uploads:retry', uploadId),
    retryAll: (): Promise<IpcResult<number>> =>
      ipcRenderer.invoke('uploads:retry-all'),
  },

  // Config operations (UX-3: migrated to the IpcResult envelope)
  config: {
    get: (): Promise<IpcResult<AppConfig>> =>
      ipcRenderer.invoke('config:get'),
    markFirstRunComplete: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('config:mark-first-run-complete'),
    clearDrive: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('config:clear-drive'),
    clearFolder: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('config:clear-folder'),
    setTheme: (theme: 'light' | 'dark' | 'system'): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('config:set-theme', theme),
    // SYNC-17: override the Arweave gateway host (defaults to turbo-gateway.com).
    setGateway: (host: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('config:set-gateway', host),
    // SYNC-23: set the ordered DATA-fetch fallback gateway list (tried after the
    // primary; defaults to [perma.online, arweave.net]). DATA fetches only.
    setGatewayFallbacks: (hosts: string[]): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('config:set-gateway-fallbacks', hosts),
  },

  // Dialog operations (UX-3: migrated to the IpcResult envelope)
  dialog: {
    selectFolder: (): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke('dialog:select-folder'),
    selectWallet: (): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke('dialog:select-wallet'),
  },

  // Shell operations (UX-3: migrated to the IpcResult envelope)
  shell: {
    openExternal: (url: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('shell:open-external', url),
    openPath: (path: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('shell:open-path', path),
    openFile: (filePath: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('shell:open-file', filePath),
  },

  // Payment operations (UX-3: openWindow migrated to the IpcResult envelope;
  // the payment-completed/cancelled events are unchanged, MONEY-7)
  payment: {
    openWindow: (url: string): Promise<IpcResult<void>> =>
      ipcRenderer.invoke('payment:open-window', url),
    onPaymentCompleted: (callback: () => void) => {
      ipcRenderer.on('payment-completed', callback);
    },
    removePaymentCompletedListener: () => {
      ipcRenderer.removeAllListeners('payment-completed');
    },
    // MONEY-7: fired when the user closes the payment window without
    // completing checkout (exactly one of completed/cancelled ever fires).
    onPaymentCancelled: (callback: () => void) => {
      ipcRenderer.on('payment-cancelled', callback);
    },
    removePaymentCancelledListener: () => {
      ipcRenderer.removeAllListeners('payment-cancelled');
    },
  },

  // Security operations (UX-3: migrated to the IpcResult envelope)
  security: {
    isKeychainAvailable: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('security:is-keychain-available'),
    getMethod: (): Promise<IpcResult<'keychain' | 'fallback'>> =>
      ipcRenderer.invoke('security:get-method'),
    // SEC-4: per-profile "remember me on this device" consent (gates OS
    // keychain persistence of the session credential).
    getKeychainConsent: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('security:get-keychain-consent'),
    setKeychainConsent: (consent: boolean): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('security:set-keychain-consent', consent),
  },

  // Turbo operations (UX-3: migrated to the IpcResult envelope; payload
  // semantics unchanged — no cost/approval/charge logic altered)
  turbo: {
    getBalance: (): Promise<IpcResult<TurboBalance>> =>
      ipcRenderer.invoke('turbo:get-balance'),
    getUploadCosts: (bytes: number): Promise<IpcResult<TurboCosts>> =>
      ipcRenderer.invoke('turbo:get-upload-costs', bytes),
    getFiatEstimate: (byteCount: number, currency?: string): Promise<IpcResult<any>> =>
      ipcRenderer.invoke('turbo:get-fiat-estimate', byteCount, currency),
    createCheckoutSession: (amount: number, currency?: string): Promise<IpcResult<any>> =>
      ipcRenderer.invoke('turbo:create-checkout-session', amount, currency),
    topUpWithTokens: (tokenAmount: number, feeMultiplier?: number): Promise<IpcResult<any>> =>
      ipcRenderer.invoke('turbo:top-up-with-tokens', tokenAmount, feeMultiplier),
    isInitialized: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('turbo:is-initialized'),
    getStatus: (): Promise<IpcResult<{
      isInitialized: boolean;
      hasBalance: boolean;
      balance: TurboBalance | null;
      error: string | null;
    }>> =>
      ipcRenderer.invoke('turbo:get-status'),
  },
  
  // Event listeners
  onWalletInfoUpdated: (callback: (walletInfo: any) => void) => {
    ipcRenderer.on('wallet-info-updated', (_, walletInfo) => callback(walletInfo));
  },
  removeWalletInfoUpdatedListener: () => {
    ipcRenderer.removeAllListeners('wallet-info-updated');
  },
  removeSyncProgressListener: () => {
    ipcRenderer.removeAllListeners('sync:progress');
  },
  
  // Upload progress events
  onUploadProgress: (callback: (data: { uploadId: string; progress: number; status: 'uploading' | 'completed' | 'failed'; error?: string }) => void) => {
    ipcRenderer.on('upload:progress', (_, data) => callback(data));
  },
  removeUploadProgressListener: () => {
    ipcRenderer.removeAllListeners('upload:progress');
  },
  onUploadComplete: (callback: (data: { uploadId: string; success: boolean; error?: string }) => void) => {
    ipcRenderer.on('upload:complete', (_, data) => callback(data));
  },
  removeUploadCompleteListener: () => {
    ipcRenderer.removeAllListeners('upload:complete');
  },
  
  // Download progress events
  onDownloadProgress: (callback: (data: {
    downloadId: string;
    fileName: string;
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
    speed: number;
    remainingTime: number;
  }) => void) => {
    ipcRenderer.on('download:progress', (_, data) => callback(data));
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download:progress');
  },
  
  // ArNS operations (UX-3: migrated to the IpcResult envelope)
  arns: {
    getProfile: (address: string): Promise<IpcResult<ArNSProfile>> =>
      ipcRenderer.invoke('arns:get-profile', address),
  },

  // Profile operations (UX-3: migrated to the IpcResult envelope)
  profiles: {
    list: (): Promise<IpcResult<Profile[]>> =>
      ipcRenderer.invoke('profiles:list'),
    getActive: (): Promise<IpcResult<Profile | null>> =>
      ipcRenderer.invoke('profiles:get-active'),
    switch: (profileId: string, password?: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('profiles:switch', profileId, password),
    update: (profileId: string, updates: any): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('profiles:update', profileId, updates),
    delete: (profileId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('profiles:delete', profileId),
  },

  profile: {
    getActive: (): Promise<IpcResult<Profile | null>> =>
      ipcRenderer.invoke('profiles:get-active'),
  },

  // Multi-drive mapping operations
  // Drive mapping operations (UX-3: migrated to the IpcResult envelope)
  driveMappings: {
    list: (): Promise<IpcResult<DriveSyncMapping[]>> =>
      ipcRenderer.invoke('drive-mappings:list'),
    add: (driveMapping: any): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('drive-mappings:add', driveMapping),
    update: (mappingId: string, updates: any): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('drive-mappings:update', mappingId, updates),
    remove: (mappingId: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke('drive-mappings:remove', mappingId),
    getById: (mappingId: string): Promise<IpcResult<DriveSyncMapping | null>> =>
      ipcRenderer.invoke('drive-mappings:get-by-id', mappingId),
    getPrimary: (): Promise<IpcResult<DriveSyncMapping | null>> =>
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

  // Enhanced file operations (UX-3: migrated to the IpcResult envelope)
  multiFiles: {
    getUploadsByDrive: (driveId: string): Promise<IpcResult<FileUpload[]>> =>
      ipcRenderer.invoke('files:get-uploads-by-mapping', driveId), // TODO: Rename IPC channel
  },

  // Error reporting (UX-3: migrated to the IpcResult envelope)
  error: {
    reportError: (errorData: {
      message: string;
      stack?: string;
      componentStack?: string;
      timestamp: string;
    }): Promise<IpcResult<boolean>> => ipcRenderer.invoke('error:report', errorData),
  },

  // System operations (UX-3: migrated to the IpcResult envelope)
  system: {
    getEnv: (key: string): Promise<IpcResult<string | undefined>> =>
      ipcRenderer.invoke('system:get-env', key),
  },

  // Event listeners
  onSyncStatusUpdate: (callback: (status: any) => void) => {
    ipcRenderer.on('sync:status-update', (_, status) => callback(status));
  },
  onSyncProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('sync:progress', (_, progress) => callback(progress));
  },
  onDriveUpdate: (callback: () => void) => {
    ipcRenderer.on('drive:update', () => callback());
  },
  onDriveMetadataUpdated: (callback: (driveId: string) => void) => {
    ipcRenderer.on('drive:metadata-updated', (_, driveId) => callback(driveId));
  },
  onSyncComplete: (callback: () => void) => {
    ipcRenderer.on('sync:completed', () => callback());
  },
  onFileStateChanged: (callback: (data: { fileId: string; syncStatus?: string; syncPreference?: string }) => void) => {
    ipcRenderer.on('sync:file-state-changed', (_, data) => callback(data));
  },
  removeFileStateChangedListener: () => {
    ipcRenderer.removeAllListeners('sync:file-state-changed');
  },
  removeDriveUpdateListener: () => {
    ipcRenderer.removeAllListeners('drive:update');
  },
  removeDriveMetadataUpdatedListener: () => {
    ipcRenderer.removeAllListeners('drive:metadata-updated');
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;