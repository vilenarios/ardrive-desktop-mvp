import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } from 'electron';

// E2E smoke-test hook (INFRA-12 / D-021): redirect userData to a disposable
// directory so UI tests never touch a real profile. This MUST run here —
// between the electron import and the manager imports below — because
// config-manager and profile-manager capture app.getPath('userData') in
// module-level singleton constructors at require time. Fails closed: packaged
// builds ignore the variable entirely.
if (process.env.ARDRIVE_TEST_USERDATA && !app.isPackaged) {
  app.setPath('userData', process.env.ARDRIVE_TEST_USERDATA);
  console.log('[TEST] userData redirected to', process.env.ARDRIVE_TEST_USERDATA);
}

import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { SecureWalletManager } from './wallet-manager-secure';
import { configManager } from './config-manager';
import { SyncManager } from './sync-manager';
import { databaseManager } from './database-manager';
import { turboManager } from './turbo-manager';
import { FileUpload, PendingUpload } from '../types';
import { IpcResult } from '../types/ipc';
import { arnsService } from './arns-service';
import { profileManager } from './profile-manager';
import InputValidator, { ValidationError } from './input-validator';
import { driveKeyManager } from './drive-key-manager';
import { readDevEnv } from './utils/dev-env';
import { applySyncFolderChange } from './utils/sync-folder-change';
import { isRetryAllowed } from './utils/upload-retry-guard';
import { TURBO_FREE_SIZE_LIMIT } from '../utils/turbo-utils';
import { retryWithBackoff } from './sync/retry';
import { TraySyncSnapshot, trayTooltipFor, trayMenuLabelFor } from './tray-status';

// Load .env file in development
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
}

// MONEY-7: the exact URL the Turbo/Stripe hosted checkout redirects to on a
// completed payment. Source of truth is the Turbo payment service
// (ardriveapp/turbo-payment-service — constants.ts:
// `defaultTopUpCheckoutSuccessUrl = "https://app.ardrive.io"`), which the
// turbo-sdk's getCheckout never overrides. Success is detected by matching a
// navigation/redirect against this EXACT origin+path — never a substring or a
// timer. If the payment service ever changes its default success URL, update
// this constant in lockstep.
const PAYMENT_SUCCESS_URL = 'https://app.ardrive.io';

// Utility function to safely wrap IPC handlers with error handling.
//
// NOTE (UX-3): safeIpcHandler only try/catches and RE-THROWS — it does NOT
// produce the D-005 envelope. It is retained for the handlers not yet migrated
// off it. New/migrated handlers use `envelopeHandler` below, which resolves to
// `{ success, data?, error? }` instead of rejecting.
function safeIpcHandler<T extends any[], R>(
  handler: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error('IPC handler error:', error);

      // Ensure we always throw a proper Error object for consistent handling
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`IPC handler failed: ${String(error)}`);
      }
    }
  };
}

// UX-3 / D-005: wrap an IPC handler so it ALWAYS resolves to the single
// response envelope — `{ success: true, data }` on success, `{ success: false,
// error }` on any thrown error (including InputValidator ValidationErrors and
// business-rule throws). The inner handler returns its raw payload (or throws);
// this wrapper is the sole place the envelope is constructed for migrated
// handlers, so preload can type the corresponding method as
// `Promise<IpcResult<R>>` and the compiler enforces `.success`/`.data` at every
// renderer call site.
function envelopeHandler<T extends any[], R>(
  handler: (...args: T) => Promise<R>
): (...args: T) => Promise<IpcResult<R>> {
  return async (...args: T): Promise<IpcResult<R>> => {
    try {
      const data = await handler(...args);
      return { success: true, data };
    } catch (error) {
      console.error('IPC handler error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `IPC handler failed: ${String(error)}`,
      };
    }
  };
}

// Enable verbose logging for debugging
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}
process.env.DEBUG = 'ardrive*';
process.env.ARDRIVE_DEBUG = 'true';

// Global error handlers for unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
  
  // In development, we want to see these errors clearly
  if (process.env.NODE_ENV === 'development') {
    console.error('Full rejection details:', {
      reason: reason,
      stack: reason instanceof Error ? reason.stack : 'No stack trace available',
      promise: promise
    });
  }
  
  // Don't exit the process in production - just log and continue
  // This prevents the entire app from crashing due to unhandled rejections
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  if (process.env.NODE_ENV === 'development') {
    console.error('Full exception details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
  }
  
  // For uncaught exceptions, we should gracefully shutdown
  // as the process state may be corrupted
  console.error('Application will exit due to uncaught exception');
  process.exit(1);
});

class ArDriveApp {
  private mainWindow: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private walletManager: SecureWalletManager;
  private syncManager: SyncManager;
  public isQuitting = false;
  
  // Cache for wallet info to reduce API calls
  private lastWalletFetch: number = 0;
  private cachedWalletInfo: any = null;

  // UX-30: fallback poll so the tray never goes stale for more than this long
  // even for state changes that don't flow through an explicit refreshTray()
  // call site (e.g. a profile switch, or background upload progress).
  private trayRefreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.walletManager = new SecureWalletManager();
    this.syncManager = new SyncManager(databaseManager);
  }

  async initialize() {
    await databaseManager.initialize();
    await configManager.initialize();
    await profileManager.initialize();
    
    // Try to restore sync state on startup
    await this.restoreSyncState();
    
    this.setupIpcHandlers();
  }

  private async restoreSyncState() {
    console.log('🔵 [AUTO-SYNC] restoreSyncState() called');
    try {
      // Check if we have an active profile and set up database isolation
      const activeProfile = await profileManager.getActiveProfile();
      if (activeProfile) {
        console.log('🔵 [AUTO-SYNC] Setting up database for active profile:', activeProfile.id);
        await databaseManager.setActiveProfile(activeProfile.id);
      }
      
      const config = await configManager.getConfig();
      
      // If we have a stored wallet, try to auto-load it
      if (!config.isFirstRun && await this.walletManager.hasStoredWallet()) {
        console.log('Attempting to restore wallet state...');
        const loaded = await this.walletManager.attemptAutoLoad();
        if (loaded) {
          console.log('Wallet auto-loaded successfully');
          
          const arDrive = this.walletManager.getArDrive();
          if (arDrive) {
            // Get private key data for private drive operations
            const privateKeyData = await driveKeyManager.getPrivateKeyData();
            // Set ArDrive for sync manager
            this.syncManager.setArDrive(arDrive, privateKeyData);
          }
          
          // Legacy migration removed - no longer needed
        } else {
          console.log('Wallet auto-load failed - will need manual re-import');
        }
      }
      
      // Sync folder will be restored when needed
      console.log('Sync folder loaded:', config.syncFolder || 'None');
      
      // UX-21: respect the user's persisted Auto-Sync choice (the
      // DriveAndSyncSetup toggle, or a later sync:pause/sync:resume — see
      // ConfigManager.getAutoSyncEnabled). Previously this check was
      // unconditional, so the toggle was decorative and every boot started
      // sync regardless of the user's choice — same fabricated-setting class
      // as the already-fixed MONEY-4/MONEY-11.
      const autoSyncEnabled = config.autoSyncEnabled !== false;

      // Auto-start sync for returning users if we have everything needed
      if (config.syncFolder && this.walletManager.isWalletLoaded() && autoSyncEnabled) {
        console.log('🔵 [AUTO-SYNC] Conditions met for auto-sync:', {
          hasSyncFolder: !!config.syncFolder,
          isWalletLoaded: this.walletManager.isWalletLoaded(),
          timestamp: new Date().toISOString()
        });
        try {
          // Get drive mappings to start sync
          const driveMappings = await databaseManager.getDriveMappings();
          const primaryMapping = driveMappings.find(m => m.isActive) || driveMappings[0];
          
          if (primaryMapping) {
            console.log('🔵 [AUTO-SYNC] Found primary drive mapping:', {
              driveId: primaryMapping.driveId,
              driveName: primaryMapping.driveName,
              timestamp: new Date().toISOString()
            });
            // SYNC-7: the mapping's folder is the source of truth at boot too
            this.syncManager.setSyncFolder(primaryMapping.localFolderPath || config.syncFolder);
            console.log('🔵 [AUTO-SYNC] About to call startSync with silent=true');
            await this.syncManager.startSync(
              primaryMapping.driveId,
              primaryMapping.rootFolderId,
              primaryMapping.driveName,
              true // silent = true for auto-sync
            );
            console.log('🔵 [AUTO-SYNC] startSync completed successfully');
          } else {
            console.log('No drive mappings found, skipping auto-sync');
          }
        } catch (syncError) {
          console.error('Failed to auto-start sync:', syncError);
          // SYNC-9: this is no longer a SILENT no-op. Before re-throwing here,
          // SyncManager.startSync already recorded a visible degraded/offline
          // health state (surfaced via sync:status -> the persistent header
          // indicator), fired the OS notification (UX-29), and — when the
          // failure is offline — armed the auto-resume watchdog. Swallowing the
          // re-thrown error at boot is safe: the user can also manually retry,
          // and the app can never look healthy while this sync is actually
          // broken/offline.
        }
      } else if (config.syncFolder && this.walletManager.isWalletLoaded() && !autoSyncEnabled) {
        console.log('🔵 [AUTO-SYNC] Auto-Sync is disabled for this profile — not starting sync automatically.');
      }

    } catch (error) {
      console.error('Failed to restore sync state:', error);
    }
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: true  // Re-enabled for security
      },
      icon: path.join(__dirname, '../../assets/favicon.png'),
      show: false,
      autoHideMenuBar: true, // Hide menu bar
      titleBarStyle: 'default'
    });

    // Check if we should load from webpack dev server or built files
    // Only use dev server if explicitly enabled with WEBPACK_DEV_SERVER=true
    const useDevServer = process.env.WEBPACK_DEV_SERVER === 'true';
    console.log('Loading renderer - useDevServer:', useDevServer, 'isPackaged:', app.isPackaged, 'NODE_ENV:', process.env.NODE_ENV, 'WEBPACK_DEV_SERVER:', process.env.WEBPACK_DEV_SERVER);
    
    if (useDevServer) {
      // Development mode - load from webpack dev server
      this.mainWindow.loadURL('http://localhost:3000');
      
      // Open DevTools in development
      this.mainWindow.webContents.openDevTools();
    } else {
      // Production mode - load from built files
      const rendererPath = path.join(__dirname, '../renderer/index.html');
      console.log('Loading from file:', rendererPath);
      this.mainWindow.loadFile(rendererPath);
      
      // Open DevTools in development (even when not using dev server)
      if (process.env.NODE_ENV === 'development' || process.env.OPEN_DEVTOOLS === 'true') {
        this.mainWindow.webContents.openDevTools();
      }
      
      // Add debugging for resource loading
      this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load resource:', validatedURL, 'Error:', errorDescription);
      });
      
      this.mainWindow.webContents.on('did-finish-load', () => {
        console.log('Page finished loading');
        // Check if CSS was loaded by testing a known CSS variable
        this.mainWindow?.webContents.executeJavaScript(`
          const rootStyle = getComputedStyle(document.documentElement);
        `);
      });
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    // MONEY-7: the old focus-based wallet refresh matched the main window's
    // URL against 'turbo'/'payment'/'checkout' — strings the renderer URL
    // (index.html / localhost dev server) never contains, so it was dead code.
    // Wallet balance now refreshes on the actual payment-completion event in
    // the payment:open-window handler below.

    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.mainWindow?.hide();
      }
    });
  }

  async createTray() {
    const iconPath = path.join(__dirname, '../../assets/favicon.png');
    const trayIcon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

    await this.updateTrayMenu();

    this.tray.on('click', () => {
      this.mainWindow?.show();
    });

    // Removed 30-second interval to reduce wallet balance checks
    // Tray will update only on specific events
    //
    // UX-30: re-added as a modest fallback poll for the ambient status
    // center — event-driven refreshTray() calls (sync:start/stop,
    // wallet:logout, tray's own pause/resume/sign-out actions) cover the
    // common transitions immediately; this interval is just the backstop so
    // the "N files syncing" count and paused/up-to-date state can't drift for
    // more than ~15s if a state change happens through a path that doesn't
    // call refreshTray(). getStatus()/getUploads() are already cheap local DB
    // reads (no network calls), so this is not a balance-check-style cost.
    this.trayRefreshTimer = setInterval(() => {
      this.updateTrayMenu();
    }, 15000);
  }

  async updateTrayMenu() {
    if (!this.tray) return;

    try {
      // Check if user is authenticated
      const isAuthenticated = await this.walletManager.isWalletLoaded();
      
      // For unauthenticated users, show minimal menu
      if (!isAuthenticated) {
        const signedOutSnapshot: TraySyncSnapshot = {
          isAuthenticated: false,
          isActive: false,
          pendingCount: 0
        };
        const contextMenu = Menu.buildFromTemplate([
          {
            label: 'ArDrive Desktop',
            enabled: false
          },
          { type: 'separator' },
          {
            label: trayMenuLabelFor(signedOutSnapshot),
            enabled: false
          },
          { type: 'separator' },
          {
            label: '🖥 Open ArDrive',
            click: () => {
              this.mainWindow?.show();
              this.mainWindow?.focus();
            }
          },
          {
            label: '❌ Quit ArDrive',
            click: () => {
              this.isQuitting = true;
              app.quit();
            }
          }
        ]);

        this.tray.setContextMenu(contextMenu);
        this.tray.setToolTip(`ArDrive Desktop - ${trayTooltipFor(signedOutSnapshot)}`);
        return;
      }

      // Get current status for authenticated users
      const config = await configManager.getConfig();
      const globalStatus = await this.syncManager.getStatus();

      // SYNC-7: the active mapping's folder is the single source of truth for
      // "the folder actually being watched" — config.syncFolder is a legacy
      // mirror that can lag behind once multiple drives exist.
      const driveMappings = await databaseManager.getDriveMappings().catch(() => []);
      const activeMapping = driveMappings.find((m) => m.isActive) || driveMappings[0];
      const syncFolderPath = activeMapping?.localFolderPath || config.syncFolder;

      // Use cached wallet info for tray menu to avoid frequent balance checks
      let walletInfo = null;
      try {
        // Only fetch if not recently fetched (simple in-memory cache)
        const now = Date.now();
        if (!this.lastWalletFetch || (now - this.lastWalletFetch) > 300000) { // 5 minutes
          walletInfo = await this.walletManager.getWalletInfo();
          this.lastWalletFetch = now;
          this.cachedWalletInfo = walletInfo;
        } else {
          walletInfo = this.cachedWalletInfo;
        }
      } catch (error) {
        console.error('Failed to get wallet info for tray:', error);
        walletInfo = this.cachedWalletInfo; // Use cached version on error
      }

      // UX-30: same pendingCount math the tray always used (totalFiles minus
      // uploadedFiles), just reduced to one of the four named ambient states
      // through the pure helper so tooltip and menu label can't drift apart.
      const pendingCount = Math.max(0, (globalStatus?.totalFiles ?? 0) - (globalStatus?.uploadedFiles ?? 0));
      const statusSnapshot: TraySyncSnapshot = {
        isAuthenticated: true,
        isActive: !!globalStatus?.isActive,
        pendingCount
      };
      const syncStatusLabel = trayMenuLabelFor(statusSnapshot);

      // UX-30: recent activity — last few completed uploads, shown as
      // disabled entries (cheap: one already-existing DB read, capped to 3).
      let recentActivityItems: { label: string; enabled: false }[] = [];
      try {
        const uploads = await databaseManager.getUploads();
        recentActivityItems = uploads
          .filter((u) => u.status === 'completed')
          .slice(0, 3)
          .map((u) => {
            const name = u.fileName.length > 34 ? `${u.fileName.slice(0, 31)}...` : u.fileName;
            return { label: `   ⬆ ${name}`, enabled: false as const };
          });
      } catch (error) {
        console.error('Failed to load recent activity for tray:', error);
      }

      // Build dynamic menu
      const menuTemplate: any[] = [
        {
          label: 'ArDrive Desktop',
          enabled: false
        },
        { type: 'separator' },
        
        // Sync Status & Controls
        {
          label: syncStatusLabel,
          enabled: false
        },
        {
          label: globalStatus?.isActive ? '⏸ Pause Sync' : '▶️ Resume Sync',
          click: async () => {
            try {
              if (globalStatus?.isActive) {
                await this.syncManager.stopSync();
              } else {
                // SYNC-7 (qa-gate FAIL reason): resume the ACTIVE mapping's
                // drive with ITS folder — restarting drives[0] re-created the
                // audited watch-A-upload-B divergence in two tray clicks.
                const mappings = await databaseManager.getDriveMappings();
                const activeMapping = mappings.find((m: any) => m.isActive) || mappings[0];
                if (activeMapping) {
                  if (activeMapping.localFolderPath) {
                    this.syncManager.setSyncFolder(activeMapping.localFolderPath);
                  }
                  await this.syncManager.startSync(
                    activeMapping.driveId,
                    activeMapping.rootFolderId,
                    activeMapping.driveName
                  );
                }
              }
            } catch (trayError) {
              // PRIV-5 (qa-gate finding): a locked drive here was an
              // unhandled rejection in main
              console.error('Tray sync toggle failed:', trayError);
            }
            setTimeout(() => this.updateTrayMenu(), 1000);
          }
        },
        { type: 'separator' },

        // Balance Info
        {
          label: walletInfo ? `💰 Balance: ${parseFloat(walletInfo.balance).toFixed(2)} AR` : '💰 Loading balance...',
          enabled: false
        },

        // UX-30: recent activity (last few completed uploads), if any
        ...(recentActivityItems.length > 0
          ? [
              { type: 'separator' as const },
              { label: 'Recent Activity', enabled: false },
              ...recentActivityItems
            ]
          : []),
        { type: 'separator' },

        // Quick Actions
        {
          // UX-30: was config.syncFolder (a legacy mirror); now the active
          // drive mapping's folder, matching what sync:start actually watches.
          label: '📁 Open Sync Folder',
          click: async () => {
            if (syncFolderPath) {
              shell.openPath(syncFolderPath);
            }
          },
          enabled: !!syncFolderPath
        },
        {
          label: '📤 Upload Files...',
          click: async () => {
            this.mainWindow?.show();
            // Could implement quick upload dialog here
          }
        },
        { type: 'separator' },


        // App Controls
        {
          label: '🖥 Show ArDrive',
          click: () => {
            this.mainWindow?.show();
            this.mainWindow?.focus();
          }
        },
        {
          label: '⚙️ Settings',
          click: () => {
            this.mainWindow?.show();
            this.mainWindow?.focus();
            // Could send IPC to navigate to settings
          }
        },
        { type: 'separator' },
        {
          // UX-30: mirrors the wallet:logout IPC handler (stop sync + drop
          // wallet-bearing state, SEC-3), then shows and reloads the window so
          // the renderer re-runs its normal boot path and lands on
          // wallet-setup/profile-management — the same place a real app
          // restart after logout would land. No new logout engine invented.
          label: '🚪 Sign Out',
          click: async () => {
            try {
              await this.syncManager.stopAndClearAllState();
              await this.walletManager.logout();
            } catch (trayError) {
              console.error('Tray sign-out failed:', trayError);
            }
            this.mainWindow?.show();
            this.mainWindow?.focus();
            this.mainWindow?.webContents.reload();
            await this.updateTrayMenu();
          }
        },
        { type: 'separator' },
        {
          label: '❌ Quit ArDrive',
          click: () => {
            this.isQuitting = true;
            app.quit();
          }
        }
      ];

      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      this.tray.setContextMenu(contextMenu);
      
      // Update tooltip with current status — reuses the same statusSnapshot
      // (and therefore the same trayMenuLabelFor()) as the menu label above,
      // so the two can never disagree.
      let tooltip = `ArDrive Desktop\n${trayMenuLabelFor(statusSnapshot)}`;

      if (walletInfo) {
        tooltip += `\n💰 ${parseFloat(walletInfo.balance).toFixed(2)} AR`;
      }

      this.tray.setToolTip(tooltip);

    } catch (error) {
      console.error('Failed to update tray menu:', error);
      // Fallback to basic menu
      const basicMenu = Menu.buildFromTemplate([
        {
          label: 'Show ArDrive',
          click: () => this.mainWindow?.show()
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            this.isQuitting = true;
            app.quit();
          }
        }
      ]);
      this.tray.setContextMenu(basicMenu);
    }
  }

  // Public method to update tray from external events
  public refreshTray() {
    this.updateTrayMenu();
  }
  
  // Method to clear wallet cache and refresh
  public async refreshWalletAndTray() {
    console.log('Refreshing wallet info and tray menu');
    this.lastWalletFetch = 0;
    this.cachedWalletInfo = null;
    await this.updateTrayMenu();
  }

  // UX-22: shared body for "start the continuous sync engine for the active
  // drive mapping" — extracted from the old sync:start handler so sync:start
  // (generic orchestration: onboarding, profile switch, private-drive
  // unlock) and sync:resume (UX-21/UX-22's persisted pause/resume control)
  // run through exactly one implementation. Throws on any precondition
  // failure (no wallet, no mapping, drive not accessible, locked private
  // drive, missing/nonexistent sync folder) — envelopeHandler turns that into
  // { success: false, error } for both callers.
  private async startSyncEngine(): Promise<boolean> {
    console.log('IPC: sync:start called');
    const config = await configManager.getConfig();
    console.log('Config for sync:', config);

    // SYNC-7: the folder is set AFTER the active mapping is resolved below —
    // the mapping's localFolderPath is the source of truth, config.syncFolder
    // is a legacy mirror.

    // Ensure ArDrive instance is available
    let arDrive = this.walletManager.getArDrive();
    if (!arDrive) {
      console.log('ArDrive instance not available, checking if wallet is loaded...');

      // Try to get wallet info to see if wallet is loaded
      const walletInfo = await this.walletManager.getWalletInfo();
      if (!walletInfo) {
        throw new Error('Wallet not loaded. Please restart the app and ensure wallet is imported.');
      }

      arDrive = this.walletManager.getArDrive();
      if (!arDrive) {
        throw new Error('Failed to get ArDrive instance after wallet check');
      }
    }

    // Get drive mapping instead of querying Arweave
    const driveMappings = await databaseManager.getDriveMappings();
    console.log('Available drive mappings:', driveMappings);

    // Get the primary (active) drive mapping
    const primaryMapping = driveMappings.find(m => m.isActive) || driveMappings[0];

    if (!primaryMapping) {
      throw new Error('No drive mappings found. Please complete setup first.');
    }

    console.log('Using drive mapping:', primaryMapping);

    // Validate drive is accessible.
    // SYNC-20: right after create, the new drive tx may not be indexed yet —
    // a bare listDrives() 404s and setup dies on "Starting sync engine…".
    // Retry with backoff so the index catches up; read-only, no spend.
    const drives = await retryWithBackoff(() => this.walletManager.listDrives(), {
      label: 'sync:start drive validation',
      timeoutMs: 20000,
    });
    const targetDrive = drives.find(d => d.id === primaryMapping.driveId);

    if (!targetDrive) {
      throw new Error(`Drive ${primaryMapping.driveName} (${primaryMapping.driveId}) not found or not accessible`);
    }

    // For private drives, check if it's unlocked
    if (primaryMapping.drivePrivacy === 'private' && !driveKeyManager.isUnlocked(primaryMapping.driveId)) {
      throw new Error(`Private drive "${primaryMapping.driveName}" is locked. Please unlock it before starting sync.`);
    }

    // SYNC-7: single source of truth — watch the active mapping's folder
    const syncFolderSource = primaryMapping.localFolderPath || config.syncFolder;
    if (!syncFolderSource) {
      throw new Error('No sync folder configured. Please set up sync first.');
    }

    // Validate sync folder exists
    try {
      await fs.access(syncFolderSource);
    } catch (error) {
      throw new Error(`Sync folder "${syncFolderSource}" does not exist or is not accessible`);
    }

    this.syncManager.setSyncFolder(syncFolderSource);

    // Heal the legacy config mirror so every config.syncFolder reader
    // (Overview/Storage tabs, Settings) agrees with what is actually watched
    if (config.syncFolder !== syncFolderSource) {
      await configManager.setSyncFolder(syncFolderSource);
    }

    // Get private key data for private drive operations
    const privateKeyData = await driveKeyManager.getPrivateKeyData();

    // Set ArDrive instance and start sync with drive mapping
    this.syncManager.setArDrive(arDrive, privateKeyData);
    const startResult = await this.syncManager.startSync(
      primaryMapping.driveId,
      primaryMapping.rootFolderId,
      primaryMapping.driveName
    );
    this.refreshTray(); // UX-30: reflect the now-active/syncing state immediately
    return startResult;
  }

  // UX-22: shared body for "stop the continuous sync engine" — extracted
  // alongside startSyncEngine for the same reason (sync:stop and sync:pause
  // both delegate here).
  private async stopSyncEngine(): Promise<boolean> {
    const stopResult = await this.syncManager.stopSync();
    this.refreshTray(); // UX-30: reflect the now-paused state immediately
    return stopResult;
  }

  private setupIpcHandlers() {
    // Wallet operations
    ipcMain.handle('wallet:import', envelopeHandler(async (_, walletPath: string, password: string) => {
      try {
        console.log('Main process - wallet:import called');

        // Validate inputs with comprehensive validation
        const validatedPath = InputValidator.validateFilePath(walletPath, 'walletPath');
        const validatedPassword = InputValidator.validatePassword(password, 'password');

        console.log('Wallet path:', InputValidator.sanitizeForLogging(validatedPath));
        console.log('Password validation passed');

        return await this.walletManager.importWallet(validatedPath, validatedPassword);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Wallet import validation failed:', error.message);
          throw error;
        }
        console.error('Main process - wallet:import error:', error);
        throw error;
      }
    }));

    ipcMain.handle('wallet:get-info', envelopeHandler(async (_, forceRefresh?: boolean) => {
      // If forceRefresh is true, clear the cache to get fresh data
      if (forceRefresh) {
        console.log('Force refreshing wallet balance');
        this.lastWalletFetch = 0; // Clear cache timestamp
        this.cachedWalletInfo = null;
      }
      
      const walletInfo = await this.walletManager.getWalletInfo();
      
      // Update cache for tray menu
      if (walletInfo) {
        this.lastWalletFetch = Date.now();
        this.cachedWalletInfo = walletInfo;
        
        // Send update to renderer
        this.mainWindow?.webContents.send('wallet-info-updated', walletInfo);
      }
      
      return walletInfo;
    }));

    ipcMain.handle('wallet:ensure-loaded', envelopeHandler(async () => {
      // Check if wallet is loaded, if not try to auto-load
      if (!this.walletManager.isWalletLoaded()) {
        return await this.walletManager.attemptAutoLoad();
      }
      return true;
    }));

    ipcMain.handle('wallet:is-loaded', envelopeHandler(async () => {
      return this.walletManager.isWalletLoaded();
    }));

    ipcMain.handle('wallet:has-stored', envelopeHandler(async () => {
      return await this.walletManager.hasStoredWallet();
    }));

    // UX-7: the specific reason the last password-based profiles:switch
    // attempt failed (e.g. "Invalid password" vs a corrupted/IO wallet-file
    // failure), so the login UI can tell them apart. profiles:switch itself
    // keeps returning a plain boolean for backward compatibility.
    // UX-3: return the raw auth-error payload; envelopeHandler supplies the
    // single {success,data} wrapper (previously this hand-rolled the envelope
    // under safeIpcHandler, so callers see the same {success,data} shape).
    ipcMain.handle('wallet:get-last-auth-error', envelopeHandler(async () => {
      return this.walletManager.getLastAuthError();
    }));

    ipcMain.handle('wallet:clear-stored', envelopeHandler(async () => {
      // SEC-3: stop the watcher and drop wallet-bearing sync state before the
      // wallet session and database are torn down.
      await this.syncManager.stopAndClearAllState();
      await this.walletManager.logout();
      this.refreshTray(); // UX-30: reflect "Not signed in" immediately
      return true;
    }));

    ipcMain.handle('wallet:logout', envelopeHandler(async () => {
      // SEC-3: stop the watcher and drop wallet-bearing sync state before the
      // wallet session and database are torn down.
      await this.syncManager.stopAndClearAllState();
      await this.walletManager.logout();
      this.refreshTray(); // UX-30: reflect "Not signed in" immediately
      return true;
    }));

    ipcMain.handle('wallet:import-from-seed-phrase', envelopeHandler(async (_, seedPhrase: string, password: string) => {
      try {
        console.log('Main process - wallet:import-from-seed-phrase called');
        
        // Validate inputs with comprehensive validation
        const validatedSeedPhrase = InputValidator.validateSeedPhrase(seedPhrase, 'seedPhrase');
        const validatedPassword = InputValidator.validatePassword(password, 'password');
        
        console.log('Seed phrase word count:', validatedSeedPhrase.trim().split(/\s+/).length);
        console.log('Password validation passed');
        
        return await this.walletManager.importFromSeedPhrase(validatedSeedPhrase, validatedPassword);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Seed phrase import validation failed:', error.message);
          throw error;
        }
        console.error('Main process - wallet:import-from-seed-phrase error:', error);
        throw error;
      }
    }));

    ipcMain.handle('wallet:create-new', envelopeHandler(async (_, password: string) => {
      try {
        console.log('Main process - wallet:create-new called');
        
        // Validate password input
        const validatedPassword = InputValidator.validatePassword(password, 'password');
        console.log('Password validation passed');
        
        return await this.walletManager.generateNewWallet(validatedPassword);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Wallet create validation failed:', error.message);
          throw error;
        }
        console.error('Main process - wallet:create-new error:', error);
        throw error;
      }
    }));

    // UX-20: Finalize a newly-created account only after the user confirms
    // they've saved the recovery phrase. This is where the profile + encrypted
    // wallet are actually persisted (deferred from wallet:create-new, which now
    // only prepares the account in memory).
    // UX-3: envelopeHandler now supplies the {success,data}/{success,error}
    // wrapper (the hand-rolled envelope was removed); return the raw payload.
    ipcMain.handle('wallet:complete-setup', envelopeHandler(async () => {
      console.log('Main process - wallet:complete-setup called');
      return await this.walletManager.completeGeneratedWalletSetup();
    }));


    // Ethereum wallet operations (TODO: Implement when ardrive-core-js supports Ethereum)
    ipcMain.handle('wallet:import-ethereum-from-file', envelopeHandler(async (_, walletPath: string, password: string) => {
      try {
        console.log('Main process - wallet:import-ethereum-from-file called');
        console.log('Wallet path:', walletPath);
        console.log('Password length:', password?.length);
        
        if (!walletPath || typeof walletPath !== 'string') {
          throw new Error('Invalid wallet path provided');
        }
        
        if (!password || typeof password !== 'string') {
          throw new Error('Invalid password provided');
        }
        
        // TODO: Implement when ardrive-core-js supports Ethereum
        throw new Error('Ethereum wallet support is coming soon! ArDrive Core is being updated to support Ethereum wallets.');
      } catch (error) {
        console.error('Main process - wallet:import-ethereum-from-file error:', error);
        throw error;
      }
    }));


    // Wallet export operations
    // UX-3: enveloped — resolves to IpcResult<ExportResult>. The inner
    // ExportResult keeps its own success/data/error/warning (business-level
    // export outcome); the outer envelope only turns false on a thrown setup
    // error (e.g. no active profile). Callers unwrap outer, then read inner.
    ipcMain.handle('wallet:export', envelopeHandler(async (_, options: {
      format: 'jwk-encrypted' | 'jwk-plain' | 'seed-phrase' | 'private-key';
      password: string;
      newPassword?: string;
    }) => {
      try {
        const { initializeWalletExportManager } = await import('./wallet-export-manager');
        const exportManager = initializeWalletExportManager(this.walletManager);
        const activeProfile = await profileManager.getActiveProfile();

        if (!activeProfile) {
          throw new Error('No active profile');
        }

        const result = await exportManager.exportWallet(options, activeProfile.id);
        return result;
      } catch (error) {
        console.error('Failed to export wallet:', error);
        throw error;
      }
    }));

    // ArNS operations (UX-3: migrated to the IpcResult envelope). ArNS data is
    // non-critical, so validation/lookup failures degrade to a null profile
    // (still a success envelope) rather than surfacing an error to the user.
    ipcMain.handle('arns:get-profile', envelopeHandler(async (_, address: string) => {
      try {
        // Validate input
        const validatedAddress = InputValidator.validateArweaveAddress(address, 'address');

        return await arnsService.getArNSProfile(validatedAddress);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('ArNS profile validation failed:', error.message);
          return { name: null, avatar: null };
        }
        console.error('Failed to get ArNS profile:', error);
        return { name: null, avatar: null };
      }
    }));

    // Keychain/Security operations
    ipcMain.handle('security:is-keychain-available', envelopeHandler(async () => {
      return this.walletManager.isKeychainAvailable();
    }));

    ipcMain.handle('security:get-method', envelopeHandler(async () => {
      return this.walletManager.getSecurityMethod();
    }));

    // SEC-4: "remember me on this device" — read/toggle the per-profile consent
    // that gates whether the session credential is persisted to the OS keychain.
    ipcMain.handle('security:get-keychain-consent', envelopeHandler(async () => {
      return await this.walletManager.getKeychainConsent();
    }));

    // SEC-4: enabling persists the current session credential to the keychain;
    // disabling (revocation) durably clears it (keychain entry removed). Returns
    // the effective consent state. Validate the flag strictly so a truthy value
    // can never silently opt a user in.
    ipcMain.handle('security:set-keychain-consent', envelopeHandler(async (_, consent: boolean) => {
      const validatedConsent = InputValidator.validateBoolean(consent, 'consent');
      return await this.walletManager.setKeychainConsent(validatedConsent);
    }));

    // Profile operations
    ipcMain.handle('profiles:list', envelopeHandler(async () => {
      try {
        return await profileManager.getProfiles();
      } catch (error) {
        console.error('Failed to list profiles:', error);
        throw error;
      }
    }));

    ipcMain.handle('profiles:get-active', envelopeHandler(async () => {
      try {
        return await profileManager.getActiveProfile();
      } catch (error) {
        console.error('Failed to get active profile:', error);
        return null;
      }
    }));

    ipcMain.handle('profiles:switch', envelopeHandler(async (_, profileId: string, password?: string) => {
      try {
        // Validate inputs
        const validatedProfileId = InputValidator.validateProfileId(profileId, 'profileId');
        let validatedPassword: string | undefined;
        if (password) {
          validatedPassword = InputValidator.validatePassword(password, 'password');
        }
        
        // SEC-3: profile A's sync engine must never survive into profile B.
        // Stop before the switch attempt — switchProfile re-points the DB and
        // clears the in-memory wallet mid-flight, and the engine's own
        // ArDrive/watcher would otherwise keep running against the new
        // profile's database. (No-op switches to the already-active profile
        // keep sync running.)
        const activeProfileId = await profileManager.getActiveProfileId();
        if (activeProfileId !== validatedProfileId) {
          await this.syncManager.stopAndClearAllState();
        }
        
        return await this.walletManager.switchProfile(validatedProfileId, validatedPassword);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Profile switch validation failed:', error.message);
          throw error;
        }
        console.error('Failed to switch profile:', error);
        throw error;
      }
    }));

    ipcMain.handle('profiles:update', envelopeHandler(async (_, profileId: string, updates: any) => {
      try {
        // Validate inputs
        const validatedProfileId = InputValidator.validateProfileId(profileId, 'profileId');
        
        // Validate updates object
        if (!updates || typeof updates !== 'object') {
          throw new ValidationError('Updates must be a valid object', 'updates');
        }
        
        // Validate name if provided
        if (updates.name !== undefined) {
          updates.name = InputValidator.validateProfileName(updates.name, 'name');
        }
        
        await profileManager.updateProfile(validatedProfileId, updates);
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Profile update validation failed:', error.message);
          throw error;
        }
        console.error('Failed to update profile:', error);
        throw error;
      }
    }));

    ipcMain.handle('profiles:delete', envelopeHandler(async (_, profileId: string) => {
      try {
        // Validate input
        const validatedProfileId = InputValidator.validateProfileId(profileId, 'profileId');

        await profileManager.deleteProfile(validatedProfileId);
        // SEC-4: the profile directory (config + wallet) is gone, but the OS
        // keychain lives outside it — forget any remembered credential too so
        // it isn't orphaned across profiles.
        await this.walletManager.forgetDeviceForProfile(validatedProfileId);
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Profile delete validation failed:', error.message);
          throw error;
        }
        console.error('Failed to delete profile:', error);
        throw error;
      }
    }));

    // Drive operations
    // SYNC-20: a transient gateway 404 (fresh tx not yet indexed, momentary
    // blip) must not fail the whole boot/import — retry with backoff so it
    // self-heals, and cap each attempt so a hung request can't stall the UI.
    // Read-only (getAllDrivesForAddress), so retrying can't spend or double-create.
    ipcMain.handle('drive:list', envelopeHandler(async () => {
      return await retryWithBackoff(() => this.walletManager.listDrives(), {
        label: 'drive:list',
        timeoutMs: 20000,
      });
    }));

    ipcMain.handle('drive:create', envelopeHandler(async (_, name: string, privacy: 'private' | 'public' = 'private') => {
      // Validate inputs
      const validatedName = InputValidator.validateDriveName(name, 'name');
      const validatedPrivacy = InputValidator.validateDrivePrivacy(privacy, 'privacy');
      
      // Ensure profile is set in config manager before creating drive
      const activeProfile = await profileManager.getActiveProfile();
      if (activeProfile) {
        await configManager.setActiveProfile(activeProfile.id);
      }
      return await this.walletManager.createDrive(validatedName, validatedPrivacy);
    }));

    // Private drive operations
    ipcMain.handle('drive:create-private', envelopeHandler(async (_, name: string, password: string) => {
      const validatedName = InputValidator.validateDriveName(name, 'name');
      const validatedPassword = InputValidator.validatePassword(password, 'password');

      // Ensure active profile is set
      const activeProfile = await profileManager.getActiveProfile();
      if (activeProfile) {
        await configManager.setActiveProfile(activeProfile.id);
      }

      return await this.walletManager.createPrivateDrive(validatedName, validatedPassword);
    }));

    ipcMain.handle('drive:unlock', envelopeHandler(async (_, driveId: string, password: string, persistKey?: boolean) => {
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      // PRIV-7: unlocking an EXISTING private drive must accept whatever
      // password the user provides (drives from other ArDrive clients may use
      // a password shorter than our 8-char NEW-password minimum). Do NOT run
      // the new-password strength validator here; wrong passwords are still
      // rejected by trial decryption in unlockPrivateDrive (PRIV-2).
      const validatedPassword = InputValidator.validateExistingPassword(password, 'password');
      // PRIV-4: opt-in "remember this drive". Coerce to a strict boolean so a
      // stray truthy value can never silently enable persistence.
      const shouldPersist = persistKey === true;

      const unlockResult = await this.walletManager.unlockPrivateDrive(validatedDriveId, validatedPassword, shouldPersist);

      if (!unlockResult.success) {
        // Wrong password OR verification (network/gateway) failure — unlockPrivateDrive
        // already distinguishes them (PRIV-2). Throw so the envelope carries the
        // SPECIFIC reason to the modal (UX-3: no more hardcoded 'Invalid password').
        throw new Error(unlockResult.error || 'Invalid password. Please check your password and try again.');
      }

      // Update the ArDrive instance in sync manager with the new private key data
      const arDrive = this.walletManager.getArDrive();
      if (arDrive) {
        const privateKeyData = await driveKeyManager.getPrivateKeyData();
        this.syncManager.setArDrive(arDrive, privateKeyData);
        console.log('Updated sync manager with refreshed ArDrive instance after unlock');
      }

      // Small delay to ensure drive key is fully propagated
      await new Promise(resolve => setTimeout(resolve, 100));

      // After successful unlock, get the updated drive info with decrypted name
      const drives = await this.walletManager.listDrivesWithStatus();
      const unlockedDrive = drives.find(d => d.id === validatedDriveId);

      // Return the decrypted drive info as the envelope payload (D-005 `data`).
      return unlockedDrive;
    }));

    ipcMain.handle('drive:lock', envelopeHandler(async (_, driveId: string) => {
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      await this.walletManager.lockPrivateDrive(validatedDriveId);
    }));

    ipcMain.handle('drive:isUnlocked', envelopeHandler(async (_, driveId: string) => {
      try {
        const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');

        // Check if the drive key manager has the key for this drive
        return await this.walletManager.isDriveUnlocked(validatedDriveId);
      } catch (error) {
        // Preserve prior semantics: a lookup failure reads as "not unlocked"
        // rather than a hard error the caller must handle.
        console.error('Failed to check drive unlock status:', error);
        return false;
      }
    }));

    // PRIV-4: whether a drive's key is remembered (persisted) across sessions.
    ipcMain.handle('drive:is-persisted', envelopeHandler(async (_, driveId: string) => {
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      return this.walletManager.isDrivePersisted(validatedDriveId);
    }));

    // PRIV-4 settings toggle: opt a drive in/out of key persistence. Enabling
    // requires the drive to be unlocked and a session password (to encrypt the
    // keys file at rest); returns false when either is missing.
    ipcMain.handle('drive:set-persistence', envelopeHandler(async (_, driveId: string, persist: boolean) => {
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      return await this.walletManager.setDrivePersistence(validatedDriveId, persist === true);
    }));

    ipcMain.handle('drive:listWithStatus', envelopeHandler(async () => {
      // SYNC-20: same transient-gateway resilience as drive:list. This is the
      // call handleWalletImported() awaits on import; without a retry a single
      // 404 made an existing (18-drive) wallet look empty and got routed into
      // create-drive. Read-only, so retrying is safe.
      return await retryWithBackoff(() => this.walletManager.listDrivesWithStatus(), {
        label: 'drive:listWithStatus',
        timeoutMs: 20000,
      });
    }));

    ipcMain.handle('drive:rename', envelopeHandler(async (_, driveId: string, newName: string) => {
      // Validate inputs
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      const validatedName = InputValidator.validateDriveName(newName, 'newName');
      
      // Get ArDrive instance
      const arDrive = this.walletManager.getArDrive();
      if (!arDrive) {
        throw new Error('ArDrive instance not initialized');
      }
      
      // Get drive info to check if it's public or private
      const walletInfo = await this.walletManager.getWalletInfo();
      if (!walletInfo) {
        throw new Error('Wallet not loaded');
      }
      // Import needed types
      const { ArweaveAddress, PrivateKeyData } = await import('ardrive-core-js');
      
      // For public drives, we need to create a stub for privateKeyData
      const privateKeyData = new PrivateKeyData({});
      const drives = await arDrive.getAllDrivesForAddress({ 
        address: new ArweaveAddress(walletInfo.address),
        privateKeyData: privateKeyData  // Use empty PrivateKeyData for public drives
      });
      const drive = drives.find((d: any) => d.driveId === validatedDriveId);
      
      if (!drive) {
        throw new Error('Drive not found');
      }
      
      // Check if Turbo is available for small metadata transactions
      let usedTurbo = false;
      try {
        if (turboManager.isInitialized()) {
          // Rename operations are small metadata updates (<1KB) so they qualify for Turbo Free
          console.log('Using Turbo for drive rename (free under the Turbo free-tier limit)');
          
          // ArDrive will automatically use Turbo if available
          // The ardrive-core-js library handles Turbo configuration internally
          usedTurbo = true;
        }
      } catch (err) {
        console.log('Turbo not available, will use AR tokens:', err);
      }
      
      // Rename the drive based on its privacy setting
      if (drive.drivePrivacy === 'public') {
        const { EntityID } = await import('ardrive-core-js');
        const result = await arDrive.renamePublicDrive({
          driveId: new EntityID(validatedDriveId),
          newName: validatedName
        });
        
        console.log(`Drive renamed successfully using ${usedTurbo ? 'Turbo (FREE)' : 'AR tokens'}`);
      } else {
        // For private drives, we would need the drive key
        // For MVP, we only support public drives
        throw new Error('Private drive renaming not supported in MVP');
      }
      
      // Update the drive name in local database
      const mappings = await databaseManager.getDriveMappings();
      const mapping = mappings.find(m => m.driveId === validatedDriveId);
      
      if (mapping) {
        await databaseManager.updateDriveMapping(mapping.id, {
          driveName: validatedName
        });
      }
      
      return { newName: validatedName, usedTurbo };
    }));

    ipcMain.handle('drive:select', envelopeHandler(async (_, driveId: string) => {
      // Validate drive ID
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      
      // Ensure profile is set in config manager before selecting drive
      const activeProfile = await profileManager.getActiveProfile();
      if (activeProfile) {
        await configManager.setActiveProfile(activeProfile.id);
      }
      
      // Return the drive info instead of trying to set it
      // The frontend will handle creating the mapping after folder selection
      const drives = await this.walletManager.listDrives();
      const selectedDrive = drives.find(d => d.id === validatedDriveId);
      if (!selectedDrive) {
        throw new Error('Drive not found');
      }
      
      return selectedDrive;
    }));

    // Get permaweb files for a drive
    ipcMain.handle('drive:get-permaweb-files', envelopeHandler(async (_, driveId: string, forceRefresh: boolean = false) => {
      console.log('Getting permaweb files for drive:', driveId, 'Force refresh:', forceRefresh);
      
      // Validate drive ID
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      
      // Get the drive mapping for this drive
      const driveMappings = await databaseManager.getDriveMappings();
      console.log('Available drive mappings:', driveMappings.map((m: any) => ({ 
        id: m.id, 
        driveId: m.driveId, 
        driveName: m.driveName,
        isActive: m.isActive 
      })));
      
      const driveMapping = driveMappings.find((m: any) => m.driveId === validatedDriveId);
      
      if (!driveMapping) {
        console.error('Drive mapping not found for driveId:', validatedDriveId);
        console.error('Available drive IDs:', driveMappings.map((m: any) => m.driveId));
        
        // Return empty array for now - the drive exists but mapping is temporarily missing
        console.log('Drive exists but mapping is missing, returning empty array');
        return [];
        
        throw new Error(`Drive mapping not found for drive ID: ${validatedDriveId}`);
      }
      
      // Check if metadata was recently synced
      const METADATA_FRESH_DURATION = 60 * 1000; // 1 minute
      const lastSyncTime = driveMapping.lastMetadataSyncAt;
      const isMetadataFresh = lastSyncTime && 
        (Date.now() - new Date(lastSyncTime).getTime()) < METADATA_FRESH_DURATION;
      
      // First, try to get from local cache unless force refresh
      if (!forceRefresh) {
        console.log('Checking local cache for drive metadata...');
        
        // If metadata is fresh from sync, always use cache
        if (isMetadataFresh) {
          console.log('Metadata was recently synced, using fresh cache');
        }
        
        let cachedMetadata = await databaseManager.getDriveMetadata(driveMapping.id);
        
        // Use cache if we have data OR if metadata was just synced
        if ((cachedMetadata && cachedMetadata.length > 0) || isMetadataFresh) {
          // If sync just completed but cache is empty, wait briefly
          if (!cachedMetadata || cachedMetadata.length === 0) {
            console.log('Waiting for cache to populate after sync...');
            await new Promise(resolve => setTimeout(resolve, 500));
            const refreshedCache = await databaseManager.getDriveMetadata(driveMapping.id);
            if (refreshedCache && refreshedCache.length > 0) {
              console.log(`Found ${refreshedCache.length} items after waiting`);
              cachedMetadata = refreshedCache;
            }
          }
          
          if (cachedMetadata && cachedMetadata.length > 0) {
            console.log(`Using ${cachedMetadata.length} items from ${isMetadataFresh ? 'fresh' : 'existing'} cache`);
          
          // Log a sample of the raw data to debug sync status
          if (cachedMetadata.length > 0) {
            console.log('Sample cached metadata item:', {
              fileId: cachedMetadata[0].fileId,
              name: cachedMetadata[0].name,
              syncStatus: cachedMetadata[0].syncStatus,
              localFileExists: cachedMetadata[0].localFileExists,
              type: cachedMetadata[0].type
            });
          }
          
          // Transform cached data to match expected format
          const fileItems = cachedMetadata.map((item: any) => ({
            id: item.fileId,
            name: item.name,
            type: item.type,
            size: item.type === 'file' && item.size !== '[object Object]' ? item.size : undefined,
            modifiedAt: item.lastModifiedDate && item.lastModifiedDate !== '[object Object]'
              ? new Date(item.lastModifiedDate) // Already in milliseconds due to our patch
              : item.createdAt 
                ? new Date(item.createdAt)
                : item.uploadedDate
                  ? new Date(item.uploadedDate)
                  : new Date(Date.now() - 86400000), // Default to 1 day ago instead of current time
            isDownloaded: item.localFileExists === 1,
            isUploaded: true,
            status: item.syncStatus || 'pending',
            path: item.path,
            parentId: item.parentFolderId || '',
            ardriveUrl: item.type === 'file' ? `https://app.ardrive.io/#/file/${item.fileId}/view` : undefined,
            dataTxId: item.dataTxId,
            metadataTxId: item.metadataTxId,
            contentType: item.contentType,
            // SYNC-5: hidden state persisted locally (integer boolean from sqlite)
            isHidden: item.isHidden === 1
          }));
          
          // Log a sample of the transformed data
          if (fileItems.length > 0) {
            console.log('Sample transformed file item:', {
              id: fileItems[0].id,
              name: fileItems[0].name,
              status: fileItems[0].status,
              isDownloaded: fileItems[0].isDownloaded,
              type: fileItems[0].type
            });
          }
          
          console.log(`Returning ${fileItems.length} files from cache`);
          return fileItems;
          }
          console.log('No cached data found, will query ArDrive API');
        }
      }
      
      // If no cache or force refresh, query ArDrive API
      const drives = await this.walletManager.listDrives();
      const drive = drives.find(d => d.id === validatedDriveId);
      
      if (!drive) {
        throw new Error('Drive not found');
      }
      
      if (!drive.rootFolderId) {
        throw new Error('Drive has no root folder ID');
      }
      
      const arDrive = this.walletManager.getArDrive();
      if (!arDrive) {
        throw new Error('ArDrive not initialized');
      }
      
      try {
        // Import needed types
        const { EntityID } = await import('ardrive-core-js');
        
        // Check if private drive is unlocked
        if (drive.privacy === 'private') {
          const isUnlocked = await driveKeyManager.isUnlocked(drive.id);
          if (!isUnlocked) {
            console.log('Private drive is locked, cannot fetch permaweb files');
            // UX-3: renderer consumers expect a flat array; normalize the
            // legacy `{ files, folders }` empty shape to `[]`.
            return [];
          }
        }
        
        // For newly created drives, the root folder might not be immediately available
        // Add a retry mechanism with delay
        let entities: any[] = [];
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            // List folder contents based on drive privacy
            if (drive.privacy === 'private') {
              // Get the drive key for private folder listing
              const driveKey = driveKeyManager.getDriveKey(drive.id);
              if (!driveKey) {
                console.log('Drive key not found for private drive');
                // UX-3: normalize legacy empty `{ files, folders }` to `[]`.
                return [];
              }
              
              console.log('Attempting to list private folder with drive key');

              // core-js 4.1.0 (CORE-6) skips incomplete/invalid entities and lists
              // the rest instead of aborting the whole private listing, so the old
              // "Invalid file state -> return empty list" workaround is obsolete.
              // List directly like the public path; the outer catch below still
              // handles not-yet-propagated ("not found") drives and real errors.
              entities = await arDrive.listPrivateFolder({
                folderId: new EntityID(drive.rootFolderId),
                driveKey: driveKey,
                maxDepth: 10,
                includeRoot: false,
                withKeys: true
              });
              console.log(`Successfully listed ${entities?.length || 0} entities from private folder`);
            } else {
              // List public folder contents
              entities = await arDrive.listPublicFolder({
                folderId: new EntityID(drive.rootFolderId),
                maxDepth: 10, // Get full hierarchy
                includeRoot: false // Don't include root folder itself
              });
            }
            break; // Success, exit retry loop
          } catch (error: any) {
            if (error.message?.includes('not found') && retryCount < maxRetries - 1) {
              console.log(`Root folder not found, retrying in 2 seconds... (attempt ${retryCount + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              retryCount++;
            } else {
              // Final attempt failed or different error
              if (error.message?.includes('not found')) {
                console.log('Drive might be newly created and not yet propagated. Returning empty list.');
                return []; // Return empty array for new drives
              }
              throw error; // Re-throw other errors
            }
          }
        }
        
        // Check if entities was successfully loaded
        if (!entities) {
          console.log('No entities loaded, returning empty array');
          return [];
        }
        
        console.log(`Found ${entities.length} entities in drive ${drive.name}`);
        
        // Transform to our FileItem format with ArDrive sharing links
        const fileItems = entities.map((entity: any) => {
          const isFile = entity.entityType === 'file';
          // Use the appropriate ID based on entity type
          const entityId = isFile ? entity.fileId : entity.folderId;
          
          // Debug all entity data to understand what's available
          console.log(`Entity data for ${entity.name}:`, {
            entityType: entity.entityType,
            size: entity.size,
            sizeValue: entity.size?.valueOf(),
            lastModifiedDate: entity.lastModifiedDate,
            createdAt: entity.createdAt,
            uploadedDate: entity.uploadedDate,
            dataTxId: entity.dataTxId,
            metadataTxId: entity.metadataTxId
          });
          
          // Generate proper ArDrive URL with file key for private files
          let ardriveUrl: string | undefined;
          if (isFile) {
            const baseUrl = `https://app.ardrive.io/#/file/${entityId}/view`;
            // For private files, include the file key in the URL
            if (drive.privacy === 'private' && entity.fileKey) {
              ardriveUrl = `${baseUrl}?fileKey=${entity.fileKey}`;
            } else {
              ardriveUrl = baseUrl;
            }
          }
          
          return {
            id: entityId?.toString() || '',
            name: entity.name || 'Unnamed',
            type: isFile ? 'file' : 'folder',
            size: isFile && entity.size !== undefined ? entity.size.valueOf() : undefined,
            modifiedAt: (() => {
              // Try different date fields in order of preference
              const dateValue = entity.lastModifiedDate || entity.createdAt || entity.uploadedDate;
              if (dateValue && dateValue > 0) {
                return new Date(dateValue);
              }
              // For folders without dates, use current time minus 1 day
              return new Date(Date.now() - 86400000);
            })(),
            isDownloaded: false, // Not relevant for permaweb view
            isUploaded: true, // Everything in permaweb is uploaded
            status: 'synced' as const,
            // SYNC-5: ArFS hidden state (core surfaces isHidden on the entity).
            // The item is HIDDEN on Arweave, not erased — permanent storage
            // cannot delete. Consumers filter/label; core just reports it.
            isHidden: entity.isHidden === true,
            path: entity.path || '/',
            parentId: entity.parentFolderId?.toString() || '',
            // ArDrive sharing links with file keys for private files
            ardriveUrl,
            // Also include transaction IDs for direct Arweave access if needed
            dataTxId: entity.dataTxId?.toString() || '',
            metadataTxId: (entity.metadataTxId || entity.metaDataTxId)?.toString() || '',
            // Additional metadata that might be useful
            contentType: isFile ? entity.dataContentType : undefined,
            driveId: drive.id,
            privacy: drive.privacy,
            // Include file key for private files
            fileKey: drive.privacy === 'private' && isFile ? entity.fileKey : undefined
          };
        });
        
        // Check local database for actual sync status of these files
        const localMetadata = await databaseManager.getDriveMetadata(driveMapping.id);
        const localStatusMap = new Map(localMetadata.map((item: any) => [item.fileId, item]));
        
        // Merge local sync status with ArDrive data
        const mergedItems = fileItems.map((item: any) => {
          const localData = localStatusMap.get(item.id);
          if (localData) {
            return {
              ...item,
              isDownloaded: localData.localFileExists,
              status: localData.syncStatus || (localData.localFileExists ? 'synced' : 'cloud_only'),
              localPath: localData.localPath,
              syncPreference: localData.syncPreference
            };
          }
          // No local data means it's cloud-only
          return {
            ...item,
            isDownloaded: false,
            status: 'cloud_only'
          };
        });
        
        return mergedItems;
      } catch (error) {
        console.error('Failed to fetch drive entities:', error);
        throw error;
      }
    }));

    // Create Arweave manifest for a folder
    ipcMain.handle('drive:create-manifest', envelopeHandler(async (_, params: {
      driveId: string;
      folderId: string;
      manifestName?: string;
    }) => {
      console.log('Creating manifest for folder:', params.folderId);
      
      // Validate inputs
      const validatedDriveId = InputValidator.validateDriveId(params.driveId, 'driveId');
      const validatedFolderId = InputValidator.validateEntityId(params.folderId, 'folderId');
      
      // Get ArDrive instance
      const arDrive = this.walletManager.getArDrive();
      if (!arDrive) {
        throw new Error('ArDrive not initialized');
      }
      
      // Import needed types
      const { EntityID } = await import('ardrive-core-js');
      
      // Check if this is a private drive
      const drives = await this.walletManager.listDrives();
      const drive = drives.find(d => d.rootFolderId === validatedFolderId || d.id === validatedFolderId);
      
      // List all files in the folder to check count
      let entities;
      if (drive && drive.privacy === 'private') {
        const driveKey = driveKeyManager.getDriveKey(drive.id);
        if (!driveKey) {
          throw new Error('Private drive is locked');
        }
        
        entities = await arDrive.listPrivateFolder({
          folderId: new EntityID(validatedFolderId),
          driveKey: driveKey,
          maxDepth: Number.MAX_SAFE_INTEGER,
          includeRoot: false
        });
      } else {
        entities = await arDrive.listPublicFolder({
          folderId: new EntityID(validatedFolderId),
          maxDepth: Number.MAX_SAFE_INTEGER,
          includeRoot: false
        });
      }
      
      // Filter to only files (not folders)
      const files = entities.filter(e => e.entityType === 'file');
      
      // Validate file count
      if (files.length === 0) {
        throw new Error('No files found in the selected folder');
      }
      
      if (files.length > 20000) {
        throw new Error(`Folder contains ${files.length} files, which exceeds the 20,000 file limit for manifests`);
      }
      
      // Set manifest name
      const manifestName = params.manifestName || 'DriveManifest.json';
      
      console.log(`Creating manifest "${manifestName}" for ${files.length} files`);
      
      // Create manifest with upsert behavior (updates existing manifest with same name)
      const result = await arDrive.uploadPublicManifest({
        folderId: new EntityID(validatedFolderId),
        destManifestName: manifestName,
        conflictResolution: 'upsert'
      });
      
      // Add manifest creation to upload history
      const manifestUpload: FileUpload = {
        id: uuidv4(),
        driveId: validatedDriveId,
        localPath: path.join(validatedFolderId, manifestName), // Virtual path
        fileName: manifestName,
        fileSize: JSON.stringify(result.manifest).length,
        status: 'completed',
        progress: 100,
        uploadMethod: 'turbo', // Manifests use Turbo Credits (free for small files)
        dataTxId: result.created[0].dataTxId?.toString(),
        metadataTxId: result.created[0].metadataTxId?.toString(),
        transactionId: result.created[0].dataTxId?.toString(),
        completedAt: new Date(),
        createdAt: new Date()
      };
      
      await databaseManager.addUpload(manifestUpload);
      console.log('Added manifest to upload history:', manifestUpload.fileName);
      
      // Emit event to refresh UI
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('drive:metadata-updated', validatedDriveId);
        this.mainWindow.webContents.send('drive:update');
        console.log('Emitted metadata update event for drive:', validatedDriveId);
      }
      
      return {
        manifestUrl: result.links[0],
        fileUrls: result.links.slice(1),
        fees: result.fees,
        txId: result.created[0].dataTxId,
        fileCount: files.length,
        manifestName: manifestName
      };
    }));

    // Count files in folder for manifest estimation
    ipcMain.handle('drive:count-folder-files', envelopeHandler(async (_, driveId: string, folderId: string) => {
      console.log('Counting files in folder:', folderId);
      
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      const validatedFolderId = InputValidator.validateEntityId(folderId, 'folderId');
      
      // Try to count from cache first
      const driveMapping = await databaseManager.getDriveMappings()
        .then(mappings => mappings.find(m => m.driveId === validatedDriveId));
        
      if (driveMapping) {
        const cachedMetadata = await databaseManager.getDriveMetadata(driveMapping.id);
        if (cachedMetadata && cachedMetadata.length > 0) {
          // Count files that belong to this folder (including subfolders)
          const folderFiles = cachedMetadata.filter(item => {
            if (item.type !== 'file') return false;
            
            // Check if file is in this folder or a subfolder
            if (item.parentFolderId === validatedFolderId) return true;
            
            // Check if file is in a subfolder by traversing up the tree
            let parentId = item.parentFolderId;
            const maxDepth = 10;
            let depth = 0;
            
            while (parentId && depth < maxDepth) {
              if (parentId === validatedFolderId) return true;
              const parent = cachedMetadata.find(m => m.fileId === parentId && m.type === 'folder');
              parentId = parent?.parentFolderId;
              depth++;
            }
            
            return false;
          });
          
          return {
            fileCount: folderFiles.length,
            estimatedCost: 0.000001 // Manifest creation has minimal cost
          };
        }
      }
      
      // If no cache, estimate based on typical folder
      return {
        fileCount: 0,
        estimatedCost: 0.000001
      };
    }));

    // Get folder tree for manifest creation
    const walletManager = this.walletManager;
    ipcMain.handle('drive:get-folder-tree', envelopeHandler(async (_, driveId: string) => {
      console.log('Getting folder tree for drive:', driveId);
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      
      // First try to get from local database cache
      const driveMapping = await databaseManager.getDriveMappings()
        .then(mappings => mappings.find(m => m.driveId === validatedDriveId));
      
      if (driveMapping) {
        console.log('Found drive mapping, checking metadata cache...');
        const cachedMetadata = await databaseManager.getDriveMetadata(driveMapping.id);
        
        if (cachedMetadata && cachedMetadata.length > 0) {
          console.log(`Found ${cachedMetadata.length} cached items`);
          // Debug: log first few items to see the structure
          console.log('Sample cached items:', cachedMetadata.slice(0, 3).map(item => ({
            type: item.type,
            fileId: item.fileId,
            parentFolderId: item.parentFolderId,
            name: item.name
          })));
          
          // Filter only folders from cached data
          const folders = cachedMetadata
            .filter(item => item.type === 'folder')
            .map(folder => ({
              id: folder.fileId,
              name: folder.name,
              parentId: folder.parentFolderId || '',
              path: folder.path || '/'
            }));
          
          // Always add the root folder if it's not already in the list
          const hasRootFolder = folders.some(f => f.id === driveMapping.rootFolderId);
          if (!hasRootFolder && driveMapping.rootFolderId) {
            console.log('Adding root folder to folder list');
            folders.unshift({
              id: driveMapping.rootFolderId,
              name: driveMapping.driveName || 'Root',
              parentId: '',
              path: '/'
            });
          }
          
          console.log(`Returning ${folders.length} folders from cache`);
          return folders;
        }
      }
      
      // If no cache, fetch from ArDrive API
      console.log('No cache found, fetching from ArDrive API...');
      const arDrive = walletManager.getArDrive();
      if (!arDrive) {
        throw new Error('ArDrive not initialized');
      }
      
      // Import needed types
      const { EntityID } = await import('ardrive-core-js');
      
      // Get drive info
      const drives = await walletManager.listDrives();
      const drive = drives.find(d => d.id === validatedDriveId);
      
      if (!drive) {
        throw new Error('Drive not found');
      }
      
      if (!drive.rootFolderId) {
        throw new Error('Drive has no root folder ID');
      }
      
      console.log('Fetching folder structure from ArDrive...');
      // Get folder structure based on drive privacy
      let entities: any[];
      if (drive.privacy === 'private') {
        const driveKey = driveKeyManager.getDriveKey(drive.id);
        if (!driveKey) {
          console.log('Drive key not found for private drive');
          return [];
        }
        
        entities = await arDrive.listPrivateFolder({
          folderId: new EntityID(drive.rootFolderId),
          driveKey: driveKey,
          maxDepth: 10,
          includeRoot: true
        });
      } else {
        entities = await arDrive.listPublicFolder({
          folderId: new EntityID(drive.rootFolderId),
          maxDepth: 10,
          includeRoot: true
        });
      }
      
      console.log(`Got ${entities.length} entities from ArDrive`);
      
      // Build hierarchical structure - only folders
      const folders = entities.filter(e => e.entityType === 'folder');
      console.log(`Filtered to ${folders.length} folders`);
      
      // Always include the root folder
      const folderList = folders.map(folder => ({
        id: folder.entityId,
        name: folder.name,
        parentId: folder.parentFolderId || '',
        path: folder.path || '/'
      }));
      
      // If no folders found, add the root folder manually
      if (folderList.length === 0) {
        console.log('No folders found, adding root folder');
        folderList.push({
          id: drive.rootFolderId,
          name: drive.name,
          parentId: '',
          path: '/'
        } as any);  // Cast to any since frontend expects string IDs
      }
      
      return folderList;
    }));

    // New drive management handlers
    ipcMain.handle('drive:getAll', envelopeHandler(async () => {
      return await this.walletManager.listDrives();
    }));

    ipcMain.handle('drive:getMapped', envelopeHandler(async () => {
      // Get all drives from wallet
      const allDrives = await this.walletManager.listDrives();
      
      // Get drive mappings to filter only added drives
      const mappings = await databaseManager.getDriveMappings();
      const mappedDriveIds = mappings.map((m: any) => m.driveId);
      
      // Return only drives that have been added to this device
      return allDrives.filter(drive => mappedDriveIds.includes(drive.id));
    }));

    ipcMain.handle('drive:setActive', envelopeHandler(async (_, driveId: string, mappingId?: string) => {
      // Validate inputs
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      
      // Verify drive exists and is accessible
      const drives = await this.walletManager.listDrives();
      const targetDrive = drives.find(d => d.id === validatedDriveId);
      
      if (!targetDrive) {
        throw new Error('Drive not found or not accessible');
      }
      
      // Check if drive has been added to this device
      const mappings = await databaseManager.getDriveMappings();
      const driveMapping = mappings.find((m: any) => m.driveId === validatedDriveId);
      
      if (!driveMapping) {
        throw new Error(`Drive "${targetDrive.name}" has not been added to this device yet`);
      }
      
      // For private drives, check if it's unlocked
      if (targetDrive.privacy === 'private' && !driveKeyManager.isUnlocked(validatedDriveId)) {
        throw new Error(`Private drive "${targetDrive.name}" is locked. Please unlock it first.`);
      }
      
      // Set active drive in config
      await configManager.setActiveDrive(validatedDriveId, mappingId || driveMapping.id);
    }));

    ipcMain.handle('drive:getActive', envelopeHandler(async () => {
      return await configManager.getActiveDrive();
    }));

    ipcMain.handle('drive:switchTo', envelopeHandler(async (_, driveId: string) => {
      // Validate inputs
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      
      // Get drive info
      const drives = await this.walletManager.listDrives();
      const targetDrive = drives.find(d => d.id === validatedDriveId);
      
      if (!targetDrive) {
        throw new Error('Drive not found');
      }
      
      // Check if drive has a mapping (has been added to the local system)
      const mappings = await databaseManager.getDriveMappings();
      const driveMapping = mappings.find((m: any) => m.driveId === validatedDriveId);
      
      if (!driveMapping) {
        throw new Error(`Drive "${targetDrive.name}" has not been added to this device yet. Please use "Add Existing Drive" first.`);
      }
      
      // For private drives, check if it's unlocked
      if (targetDrive.privacy === 'private' && !driveKeyManager.isUnlocked(validatedDriveId)) {
        throw new Error(`Cannot switch to locked private drive "${targetDrive.name}". Please unlock it first.`);
      }
      
      // Validate the sync folder exists
      const syncFolder = driveMapping.localFolderPath;
      try {
        await fs.access(syncFolder);
      } catch (error) {
        throw new Error(`Sync folder "${syncFolder}" does not exist or is not accessible`);
      }
      
      // Switch the drive in sync manager (switchDrive re-points the watcher
      // at the new mapping's folder — SYNC-7)
      const switched = await this.syncManager.switchDrive(validatedDriveId, targetDrive.rootFolderId);

      if (!switched) {
        // UX-3: a failed switch is an error, not a `success: true` envelope
        // carrying an inner `success: false`. Throw so the envelope reports it.
        throw new Error(`Failed to switch to drive "${targetDrive.name}".`);
      }

      // Update active drive in config
      await configManager.setActiveDrive(validatedDriveId, driveMapping.id);
      // SYNC-7: heal the legacy config mirror so UI folder displays agree
      await configManager.setSyncFolder(driveMapping.localFolderPath);

      // The switched-to drive info is the envelope payload (D-005 `data`).
      return targetDrive;
    }));

    // Sync operations
    ipcMain.handle('sync:set-folder', envelopeHandler(async (_, driveId: string, folderPath: string) => {
      // Validate inputs
      const validatedFolderPath = InputValidator.validateFilePath(folderPath, 'folderPath');

      // Handle the case where driveId is provided (from combined setup)
      if (driveId) {
        InputValidator.validateDriveId(driveId, 'driveId');
        // Drive selection now handled by drive mappings
      }

      // Sync folder now handled by drive mappings
      this.syncManager.setSyncFolder(validatedFolderPath);
      return true;
    }));

    // Get recent uploads for Activity tab
    ipcMain.handle('sync:get-uploads', envelopeHandler(async () => {
      console.log('Getting recent uploads from database');
      const uploads = await databaseManager.getUploads();
      
      // Filter to last 30 days and limit to reasonable amount
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentUploads = uploads
        .filter(upload => {
          const createdAt = new Date(upload.createdAt);
          return createdAt >= thirtyDaysAgo;
        })
        .slice(0, 100); // Limit to 100 most recent
      
      console.log(`Found ${recentUploads.length} uploads from last 30 days`);
      return recentUploads;
    }));

    ipcMain.handle('sync:start', envelopeHandler(async () => {
      return await this.startSyncEngine();
    }));

    ipcMain.handle('sync:stop', envelopeHandler(async () => {
      return await this.stopSyncEngine();
    }));

    // UX-21/UX-22: dedicated pause/resume — distinct from the generic
    // sync:start/sync:stop above, which are ALSO called for internal
    // orchestration (profile switch, private-drive unlock, sync-folder
    // change) where flipping the user's saved Auto-Sync preference would
    // misrepresent their actual choice. These two are the only handlers that
    // persist ConfigManager's autoSyncEnabled flag, so a pause/resume from
    // the Dashboard is honored on the NEXT boot too (restoreSyncState above),
    // not just for the rest of the current session. Reuses the exact same
    // SyncManager.startSync()/stopSync() path the UX-30 tray's pause/resume
    // menu item already calls — no new sync engine.
    ipcMain.handle('sync:pause', envelopeHandler(async () => {
      const result = await this.stopSyncEngine();
      await configManager.setAutoSyncEnabled(false);
      return result;
    }));

    ipcMain.handle('sync:resume', envelopeHandler(async () => {
      const result = await this.startSyncEngine();
      await configManager.setAutoSyncEnabled(true);
      return result;
    }));

    ipcMain.handle('sync:status', envelopeHandler(async () => {
      return await this.syncManager.getStatus();
    }));

    // DEBUG: Sync state handlers
    ipcMain.handle('sync:get-state', envelopeHandler(async () => {
      return this.syncManager.getCurrentSyncState();
    }));

    ipcMain.handle('sync:force-monitoring', envelopeHandler(async () => {
      console.log('🔧 Force starting file monitoring via IPC');
      await this.syncManager.forceStartFileMonitoring();
      return true;
    }));

    ipcMain.handle('sync:getFolder', envelopeHandler(async () => {
      const config = await configManager.getConfig();
      return config.syncFolder;
    }));

    ipcMain.handle('sync:setFolder', envelopeHandler(async (_, folderPath: string, options?: { updateActiveMapping?: boolean }) => {
      const validatedFolderPath = InputValidator.validateFilePath(folderPath, 'folderPath');
      // UX-2/SYNC-7: persist to config, then update the running SyncManager.
      // Settings passes updateActiveMapping: true to also re-point the ACTIVE
      // drive mapping (what sync:start validates); onboarding flows don't —
      // they create their own mapping afterwards (see utils/sync-folder-change.ts).
      await applySyncFolderChange(validatedFolderPath, {
        setConfigSyncFolder: (p) => configManager.setSyncFolder(p),
        getDriveMappings: () => databaseManager.getDriveMappings(),
        updateDriveMapping: (id, updates) => databaseManager.updateDriveMapping(id, updates),
        setSyncManagerFolder: (p) => this.syncManager.setSyncFolder(p),
      }, { updateActiveMapping: options?.updateActiveMapping === true });
      return true;
    }));


    ipcMain.handle('files:get-uploads-by-mapping', envelopeHandler(async (_, mappingId: string) => {
      return await databaseManager.getUploadsByDrive(mappingId); // TODO: Rename parameter from mappingId to driveId
    }));

    // File operations
    ipcMain.handle('files:get-uploads', envelopeHandler(async () => {
      return await databaseManager.getUploads();
    }));

    ipcMain.handle('files:get-downloads', envelopeHandler(async () => {
      return await databaseManager.getDownloads();
    }));

    ipcMain.handle('files:redownload-all', envelopeHandler(async () => {
      console.log('Manual re-download requested');
      // Trigger a manual download of existing drive files
      await this.syncManager.forceDownloadExistingFiles();
    }));

    // FEAT-6: permanent version history. Returns every recorded ArFS revision
    // of a file (newest-first, scoped to the active profile by
    // getFileVersions) so the renderer can list them and view/download any
    // prior version from the configured gateway. Read-only — this handler
    // never uploads or spends. Wraps databaseManager.getFileVersions.
    ipcMain.handle('files:get-versions', envelopeHandler(async (_, filePath: string) => {
      const validatedPath = InputValidator.validateFilePath(filePath);
      return await databaseManager.getFileVersions(validatedPath);
    }));

    // Sync preference operations
    ipcMain.handle('sync:set-file-preference', envelopeHandler(async (_, fileId: string, preference: 'auto' | 'cloud_only') => {
      await databaseManager.updateFileSyncPreference(fileId, preference);

      // If setting to cloud_only, delete the local file and update sync status
      if (preference === 'cloud_only') {
          // Get file metadata to find local path
          const mappings = await databaseManager.getDriveMappings();
          const activeMapping = mappings.find((m: any) => m.isActive);
          if (activeMapping) {
            const allMetadata = await databaseManager.getDriveMetadata(activeMapping.id);
            const fileData = allMetadata.find((item: any) => item.fileId === fileId);
            
            if (fileData) {
              // Construct local path if not stored
              let localPath = fileData.localPath;
              if (!localPath) {
                // Try to construct local path from sync folder
                const config = await configManager.getConfig();
                if (config.syncFolder) {
                  const path = await import('path');
                  const filePath = fileData.path || '';
                  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
                  localPath = path.join(config.syncFolder, cleanPath, fileData.name);
                }
              }
              
              if (localPath) {
                // Delete the local file
                try {
                  const fs = (await import('fs')).promises;
                  await fs.unlink(localPath);
                  console.log(`Deleted local file: ${localPath}`);
                } catch (err) {
                  console.warn(`Could not delete local file: ${localPath}`, err);
                }
              }
            }
          }
          
          // Update sync status to cloud_only and mark as not existing locally
          await databaseManager.updateFileSyncStatus(fileId, 'cloud_only');
          await databaseManager.updateDriveMetadataStatus(fileId, 'cloud_only', false);
        }

      // Emit file state change event
      if (this.mainWindow) {
        this.mainWindow.webContents.send('sync:file-state-changed', {
          fileId,
          syncPreference: preference,
          syncStatus: preference === 'cloud_only' ? 'cloud_only' : undefined
        });
      }
    }));

    ipcMain.handle('sync:queue-download', envelopeHandler(async (_, fileId: string, priority?: number) => {
      // Get file metadata
      const mappings = await databaseManager.getDriveMappings();
      const activeMapping = mappings.find(m => m.isActive);
      if (!activeMapping) {
        throw new Error('No active drive mapping found');
      }

      const allMetadata = await databaseManager.getDriveMetadata(activeMapping.id);
      const fileData = allMetadata.find(item => item.fileId === fileId);
      if (!fileData) {
        throw new Error('File not found in metadata');
      }

      // Queue the download
      await this.syncManager.queueDownload(fileData, priority || 0);
    }));

    ipcMain.handle('sync:cancel-download', envelopeHandler(async (_, fileId: string) => {
      await this.syncManager.cancelDownload(fileId);

      // Emit file state change event
      if (this.mainWindow) {
        this.mainWindow.webContents.send('sync:file-state-changed', { fileId, syncStatus: 'cloud_only' });
      }
    }));

    ipcMain.handle('sync:get-queue-status', envelopeHandler(async () => {
      return await this.syncManager.getQueueStatus();
    }));

    ipcMain.handle('sync:get-queued-downloads', envelopeHandler(async (_, limit?: number) => {
      return await this.syncManager.getQueuedDownloads(limit);
    }));

    // Manual sync operation (different from background sync monitoring)
    ipcMain.handle('sync:manual', envelopeHandler(async () => {
      console.log('Manual sync requested from UI');
      try {
        // Let the sync operations emit their own progress events
        // This prevents duplicate progress modals
        await this.syncManager.forceDownloadExistingFiles();

        // Emit sync completed event to trigger UI updates
        if (this.mainWindow) {
          this.mainWindow.webContents.send('sync:completed');
          console.log('📤 Emitted sync:completed event to trigger Permaweb refresh');
        }
      } catch (error) {
        console.error('Manual sync failed:', error);

        // Emit error state, then rethrow so the envelope reports { success: false }
        if (this.mainWindow) {
          this.mainWindow.webContents.send('sync:progress', {
            phase: 'complete',
            description: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: true
          });
        }

        throw error instanceof Error ? error : new Error('Manual sync failed');
      }
    }));

    // Upload approval queue operations
    ipcMain.handle('uploads:get-pending', envelopeHandler(async () => {
      return await databaseManager.getPendingUploads();
    }));

    ipcMain.handle('uploads:approve', envelopeHandler(async (_, uploadId: string) => {
      // Move from pending to actual upload queue
      const pendingUploads = await databaseManager.getPendingUploads();
      const pendingUpload = pendingUploads.find(u => u.id === uploadId);
      
      if (!pendingUpload) {
        // Check if already uploaded
        const existingUploads = await databaseManager.getUploads();
        const alreadyUploaded = existingUploads.find(u => u.id === uploadId);
        if (alreadyUploaded) {
          console.log(`Upload ${uploadId} already processed, status: ${alreadyUploaded.status}`);
          return { alreadyProcessed: true, status: alreadyUploaded.status };
        }
        throw new Error('Pending upload not found');
      }
      
      // Check if this is a metadata-only operation (move, rename, hide, etc.)
      const isMetadataOperation = pendingUpload.operationType && 
        ['move', 'rename', 'hide', 'unhide', 'delete'].includes(pendingUpload.operationType);
      
      if (isMetadataOperation) {
        // Handle metadata operations immediately
        console.log(`Processing ${pendingUpload.operationType} operation for: ${pendingUpload.fileName}`);
        
        try {
          const result = await this.syncManager.executeMetadataOperation(pendingUpload);
          
          // Create an upload record for activity tracking
          const activityRecord: FileUpload = {
            id: pendingUpload.id,
            driveId: pendingUpload.driveId,
            localPath: pendingUpload.localPath,
            fileName: pendingUpload.fileName,
            fileSize: pendingUpload.fileSize,
            status: 'completed',
            progress: 100,
            uploadMethod: 'turbo', // Metadata operations use Turbo
            dataTxId: result?.created?.[0]?.dataTxId?.toString(),
            metadataTxId: result?.created?.[0]?.metadataTxId?.toString(),
            fileId: pendingUpload.arfsFileId,
            createdAt: new Date(),
            completedAt: new Date()
          };
          
          // Add to upload history for activity tracking
          await databaseManager.addUpload(activityRecord);
          
          // Remove from pending uploads
          await databaseManager.removePendingUpload(uploadId);
          
          // Notify UI of completion
          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:pending-uploads-updated');
            mainWindow.webContents.send('sync:upload-completed', {
              fileName: pendingUpload.fileName,
              operationType: pendingUpload.operationType
            });
            mainWindow.webContents.send('drive:update');
          }
          
          return { success: true, operationType: pendingUpload.operationType };
        } catch (error) {
          console.error(`Failed to execute ${pendingUpload.operationType} operation:`, error);
          throw error;
        }
      }
      
      // Regular upload handling. Uploads execute via Turbo only (D-010,
      // MONEY-1) — ardrive-core is configured with turboSettings at factory
      // time, so 'turbo' is the only method that can actually run. The old
      // 'ar' fallback recorded a payment rail that never existed.

      // Validate Turbo balance unless the file is free-tier. Approval of a
      // row whose known cost exceeds the balance is BLOCKED (throws) rather
      // than letting a certain-to-charge-later upload through unfunded.
      const isFreeWithTurbo = pendingUpload.fileSize <= TURBO_FREE_SIZE_LIMIT;

      if (turboManager.isInitialized() && !isFreeWithTurbo) {
        try {
          const balance = await turboManager.getBalance();
          const turboCosts = await turboManager.getUploadCosts(pendingUpload.fileSize);
          
          const balanceInWinc = parseFloat(balance.winc);
          const requiredWinc = parseFloat(turboCosts.winc);
          
          if (balanceInWinc < requiredWinc) {
            throw new Error(`Insufficient Turbo Credits. Required: ${(requiredWinc/1e12).toFixed(6)} Credits, Available: ${balance.ar} Credits`);
          }
        } catch (balanceError) {
          if (balanceError instanceof Error && balanceError.message.includes('Insufficient Turbo Credits')) {
            throw balanceError;
          }
          throw new Error('Failed to verify Turbo Credits balance. Please try again.');
        }
      }
      
      // Create actual upload entry
      const upload: FileUpload = {
        id: pendingUpload.id,
        driveId: pendingUpload.driveId,
        localPath: pendingUpload.localPath,
        fileName: pendingUpload.fileName,
        fileSize: pendingUpload.fileSize,
        status: 'pending',
        progress: 0,
        uploadMethod: 'turbo', // truthful: execution is always Turbo (D-010)
        dataTxId: undefined,
        metadataTxId: undefined,
        transactionId: undefined,
        // SYNC-26: carry the revision target through to the upload engine so an
        // edit reuses its existing fileId (ArFS revision) instead of minting a
        // new file. Undefined for genuinely new files.
        existingArfsFileId: pendingUpload.arfsFileId,
        error: undefined,
        completedAt: undefined,
        createdAt: new Date()
      };

      await databaseManager.addUpload(upload);
      await databaseManager.removePendingUpload(uploadId);

      // Add to sync manager
      this.syncManager.addToUploadQueue(upload);

      return true;
    }));

    ipcMain.handle('uploads:reject', envelopeHandler(async (_, uploadId: string) => {
      await databaseManager.updatePendingUploadStatus(uploadId, 'rejected');
      return true;
    }));

    // SYNC-5: queue an ArFS "unhide" operation for a previously-hidden entity.
    // Routed through the approval queue like hide (it also writes a paid
    // metadata revision), then executed by syncManager.executeMetadataOperation.
    // Returns the D-005 envelope explicitly (safeIpcHandler doesn't wrap yet).
    ipcMain.handle('sync:unhide-entity', envelopeHandler(async (_, params: {
      driveId: string;
      entityId: string;
      entityType: 'file' | 'folder';
      name?: string;
    }) => {
      {
        const validatedDriveId = InputValidator.validateDriveId(params?.driveId, 'driveId');
        const validatedEntityId = InputValidator.validateEntityId(params?.entityId, 'entityId');
        const entityType = params?.entityType === 'folder' ? 'folder' : 'file';

        // Guard against queuing a duplicate unhide for the same entity.
        const existingPending = await databaseManager.getPendingUploads();
        const alreadyQueued = existingPending.some((p) =>
          p.operationType === 'unhide' &&
          (p.arfsFileId === validatedEntityId || p.arfsFolderId === validatedEntityId)
        );
        if (alreadyQueued) {
          throw new Error('An unhide operation is already pending for this item.');
        }

        const unhideOperation: Omit<PendingUpload, 'createdAt'> = {
          id: uuidv4(),
          driveId: validatedDriveId,
          localPath: params?.name || validatedEntityId,
          fileName: params?.name || validatedEntityId,
          fileSize: 0,
          mimeType: entityType === 'folder' ? 'folder' : 'application/octet-stream',
          estimatedCost: 0,
          estimatedTurboCost: 0,
          recommendedMethod: 'turbo',
          hasSufficientTurboBalance: true,
          conflictType: 'none',
          status: 'awaiting_approval',
          operationType: 'unhide',
          arfsFileId: entityType === 'file' ? validatedEntityId : undefined,
          arfsFolderId: entityType === 'folder' ? validatedEntityId : undefined,
          metadata: { isHidden: false }
        };

        await databaseManager.addPendingUpload(unhideOperation);
        this.mainWindow?.webContents.send('sync:pending-uploads-updated');

        return { id: unhideOperation.id };
      }
    }));

    ipcMain.handle('uploads:approve-all', envelopeHandler(async () => {
      const pendingUploads = await databaseManager.getPendingUploads();

      // Uploads are signed with the wallet — require one to be loaded.
      // NOTE: no AR-denominated balance gate here (MONEY-1): uploads execute
      // via Turbo only (D-010), so AR balance is irrelevant to approval.
      const walletInfo = await this.walletManager.getWalletInfo();

      if (!walletInfo) {
        throw new Error('Wallet not loaded');
      }

      let approvedCount = 0;
      const errors: string[] = [];

      // Get current Turbo balance
      let turboBalanceWinc = 0;

      if (turboManager.isInitialized()) {
        try {
          const turboBalance = await turboManager.getBalance();
          turboBalanceWinc = parseFloat(turboBalance.winc);
        } catch (e) {
          console.error('Failed to get Turbo balance:', e);
        }
      }
      
      for (const pendingUpload of pendingUploads) {
        try {
          // Check if this is a metadata-only operation (move, rename, hide, etc.)
          const isMetadataOperation = pendingUpload.operationType && 
            ['move', 'rename', 'hide', 'unhide', 'delete'].includes(pendingUpload.operationType);
          
          if (isMetadataOperation) {
            // Handle metadata operations immediately
            console.log(`Processing ${pendingUpload.operationType} operation for: ${pendingUpload.fileName}`);
            
            try {
              const result = await this.syncManager.executeMetadataOperation(pendingUpload);
              
              // Create an upload record for activity tracking
              const activityRecord: FileUpload = {
                id: pendingUpload.id,
                driveId: pendingUpload.driveId,
                localPath: pendingUpload.localPath,
                fileName: pendingUpload.fileName,
                fileSize: pendingUpload.fileSize,
                status: 'completed',
                progress: 100,
                uploadMethod: 'turbo', // Metadata operations use Turbo
                dataTxId: result?.created?.[0]?.dataTxId?.toString(),
                metadataTxId: result?.created?.[0]?.metadataTxId?.toString(),
                fileId: pendingUpload.arfsFileId,
                createdAt: new Date(),
                completedAt: new Date()
              };
              
              // Add to upload history for activity tracking
              await databaseManager.addUpload(activityRecord);
              
              // Remove from pending uploads
              await databaseManager.removePendingUpload(pendingUpload.id);
              
              // Notify UI to refresh - metadata operations complete immediately
              const mainWindow = BrowserWindow.getAllWindows()[0];
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('drive:update');
                mainWindow.webContents.send('activity:update');
              }
              
              approvedCount++;
              continue; // Skip to next upload
            } catch (error) {
              console.error(`Failed to execute ${pendingUpload.operationType} operation:`, error);
              errors.push(`${pendingUpload.fileName}: ${error instanceof Error ? error.message : 'Failed to execute operation'}`);
              continue;
            }
          }
          
          // Turbo-only (D-010, MONEY-1): every upload executes via Turbo.
          // Rows whose known Turbo cost exceeds the remaining balance are
          // SKIPPED with a per-file reason in `errors` (surfaced to the
          // user); free-tier rows and rows without a quote pass through.
          const isFreeWithTurbo = pendingUpload.fileSize <= TURBO_FREE_SIZE_LIMIT;

          if (!isFreeWithTurbo && turboManager.isInitialized()) {
            const turboCosts = await turboManager.getUploadCosts(pendingUpload.fileSize);
            const requiredWinc = parseFloat(turboCosts.winc);

            if (turboBalanceWinc < requiredWinc) {
              errors.push(`${pendingUpload.fileName}: Insufficient Turbo Credits (need ${(requiredWinc/1e12).toFixed(6)} Credits)`);
              continue; // Skip this file
            }

            // Deduct from running balance to check if we can afford all files
            turboBalanceWinc -= requiredWinc;
          }

          // Create upload entry
          const upload: FileUpload = {
            id: pendingUpload.id,
            driveId: pendingUpload.driveId,
            localPath: pendingUpload.localPath,
            fileName: pendingUpload.fileName,
            fileSize: pendingUpload.fileSize,
            status: 'pending',
            progress: 0,
            uploadMethod: 'turbo', // truthful: execution is always Turbo (D-010)
            dataTxId: undefined,
            metadataTxId: undefined,
            transactionId: undefined,
            // SYNC-26: carry the revision target so an approved-all edit also
            // reuses its existing fileId (ArFS revision) rather than a new file.
            existingArfsFileId: pendingUpload.arfsFileId,
            error: undefined,
            completedAt: undefined,
            createdAt: new Date()
          };
          
          await databaseManager.addUpload(upload);
          await databaseManager.removePendingUpload(pendingUpload.id);
          
          // Add to sync manager
          this.syncManager.addToUploadQueue(upload);
          
          approvedCount++;
        } catch (error) {
          console.error(`Failed to approve upload ${pendingUpload.fileName}:`, error);
          errors.push(`${pendingUpload.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      // Notify UI to refresh if any operations completed
      if (approvedCount > 0) {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('drive:update');
        }
      }
      
      // Return summary of what was approved and any errors
      return {
        approvedCount,
        totalCount: pendingUploads.length,
        errors: errors.length > 0 ? errors : undefined
      };
    }));

    ipcMain.handle('uploads:reject-all', envelopeHandler(async () => {
      await databaseManager.clearAllPendingUploads();
      return true;
    }));
    
    ipcMain.handle('uploads:cancel', envelopeHandler(async (_, uploadId: string) => {
      try {
        // MONEY-2: cancel in the queue FIRST — pending items are removed
        // before any spend; in-flight items get a cancellation request
        // honored at every spend checkpoint and at completion.
        const result = this.syncManager
          ? this.syncManager.cancelUpload(uploadId)
          : { cancelled: false, wasInFlight: false };
        
        if (!result.cancelled) {
          // The queue doesn't know this id — consult the (fresh) DB truth and
          // never rewrite charged history (qa-gate FAIL reason 4: the old
          // snapshot-then-write flipped just-completed rows to 'failed').
          const uploads = await databaseManager.getUploads();
          const dbUpload = uploads.find(u => u.id === uploadId);
          if (!dbUpload) {
            return false;
          }
          if (dbUpload.status === 'completed') {
            console.warn(`Refusing to cancel upload ${uploadId}: already completed (stored and charged)`);
            return false;
          }
          if (dbUpload.status === 'failed') {
            return true; // already terminal — idempotent success
          }
          // Stale transient row with no live queue entry (mid-session orphan)
        }
        
        const message = result.wasInFlight
          ? 'Cancellation requested — the upload was already in flight; the final state will reflect whether it completed on Arweave'
          : 'Cancelled by user';
        
        // Update database status
        await databaseManager.updateUpload(uploadId, { status: 'failed', error: message });
        
        // Emit progress event
        if (this.mainWindow) {
          this.mainWindow.webContents.send('upload:progress', {
            uploadId,
            progress: 0,
            status: 'failed',
            error: message
          });
        }
        
        return true;
      } catch (error) {
        console.error('Failed to cancel upload:', error);
        throw error;
      }
    }));

    ipcMain.handle('uploads:retry', envelopeHandler(async (_, uploadId: string) => {
      try {
        // Get the upload from database
        const uploads = await databaseManager.getUploads();
        const upload = uploads.find(u => u.id === uploadId);
        
        if (!upload) {
          throw new Error('Upload not found');
        }
        
        // MONEY-2: only terminal failures may be retried — re-queueing an
        // in-flight upload paid for the same file twice (audit §1.2).
        const guard = isRetryAllowed({
          dbStatus: upload.status,
          queueStatus: this.syncManager?.getQueueEntryStatus(uploadId),
          cancellationPending: this.syncManager?.isUploadCancellationPending(uploadId) ?? false,
          hasChargeEvidence: !!(upload.dataTxId || upload.fileId)
        });
        if (!guard.allowed) {
          console.warn(`Refusing retry of upload ${uploadId}: ${guard.reason}`);
          return false;
        }
        
        // Reset status to pending
        await databaseManager.updateUpload(uploadId, {
          status: 'pending',
          progress: 0,
          error: undefined
        });
        
        // Update local copy
        upload.status = 'pending';
        upload.progress = 0;
        upload.error = undefined;
        
        // Add back to sync manager queue
        if (this.syncManager) {
          this.syncManager.addToUploadQueue(upload);
        }
        
        return true;
      } catch (error) {
        console.error('Failed to retry upload:', error);
        throw error;
      }
    }));

    ipcMain.handle('uploads:retry-all', envelopeHandler(async () => {
      try {
        // Get all failed uploads that pass retry admission (MONEY-2)
        const uploads = await databaseManager.getUploads();
        const failedUploads = uploads.filter(u =>
          isRetryAllowed({
            dbStatus: u.status,
            queueStatus: this.syncManager?.getQueueEntryStatus(u.id),
            cancellationPending: this.syncManager?.isUploadCancellationPending(u.id) ?? false,
            hasChargeEvidence: !!(u.dataTxId || u.fileId)
          }).allowed
        );
        
        for (const upload of failedUploads) {
          // Reset status
          await databaseManager.updateUpload(upload.id, {
            status: 'pending',
            progress: 0,
            error: undefined
          });
          
          // Update local copy
          upload.status = 'pending';
          upload.progress = 0;
          upload.error = undefined;
          
          // Add back to sync manager queue
          if (this.syncManager) {
            this.syncManager.addToUploadQueue(upload);
          }
        }
        
        return failedUploads.length;
      } catch (error) {
        console.error('Failed to retry all uploads:', error);
        throw error;
      }
    }));

    // Config operations
    ipcMain.handle('config:get', envelopeHandler(async () => {
      return await configManager.getConfig();
    }));

    ipcMain.handle('config:mark-first-run-complete', envelopeHandler(async () => {
      return await configManager.markFirstRunComplete();
    }));

    // DESIGN-2: persist the ThemeProvider's manual light/dark/system override.
    // UX-3: envelopeHandler supplies the {success}/{success,error} wrapper;
    // return void (no payload) instead of the old hand-rolled {success:true}.
    ipcMain.handle('config:set-theme', envelopeHandler(async (_, theme: unknown) => {
      const validated = InputValidator.validateThemePreference(theme);
      await configManager.setThemePreference(validated);
    }));

    // SYNC-17: override the Arweave gateway host (device/app-level global config).
    // Defaults to turbo-gateway.com when unset (see src/main/gateway.ts). Lets a
    // user whose default gateway is rate-limited (429) point the app elsewhere.
    ipcMain.handle('config:set-gateway', envelopeHandler(async (_, host: unknown) => {
      const validated = InputValidator.validateGatewayHost(host);
      await configManager.setGatewayHost(validated);
    }));

    // SYNC-23: set the ordered DATA-fetch fallback gateway list (device/app-level
    // global config). Tried in order after the primary (`config:set-gateway`)
    // when a by-txid data fetch persistently fails; defaults to
    // [perma.online, arweave.net] when unset (see src/main/gateway.ts). DATA
    // fetches only — metadata/GraphQL never fails over across gateways.
    ipcMain.handle('config:set-gateway-fallbacks', envelopeHandler(async (_, hosts: unknown) => {
      const validated = InputValidator.validateGatewayHosts(hosts);
      await configManager.setGatewayFallbacks(validated);
    }));

    // UX-29: native desktop notifications opt-out (device/app-level global
    // config, like `theme`/`gatewayHost`). Defaults to true — see
    // ConfigManager.getNotificationsEnabled. Read is synchronous on the
    // manager but wrapped async here to match every other config handler's
    // shape.
    ipcMain.handle('config:get-notifications-enabled', envelopeHandler(async () => {
      return configManager.getNotificationsEnabled();
    }));

    ipcMain.handle('config:set-notifications-enabled', envelopeHandler(async (_, enabled: unknown) => {
      const validated = InputValidator.validateBoolean(enabled, 'enabled');
      await configManager.setNotificationsEnabled(validated);
      return validated;
    }));

    // UX-21/UX-22: per-profile Auto-Sync preference — set from
    // DriveAndSyncSetup's "Enable Auto Sync" toggle and from the
    // sync:pause/sync:resume handlers above. Defaults to true — see
    // ConfigManager.getAutoSyncEnabled.
    ipcMain.handle('config:get-auto-sync-enabled', envelopeHandler(async () => {
      return await configManager.getAutoSyncEnabled();
    }));

    ipcMain.handle('config:set-auto-sync-enabled', envelopeHandler(async (_, enabled: unknown) => {
      const validated = InputValidator.validateBoolean(enabled, 'enabled');
      await configManager.setAutoSyncEnabled(validated);
      return validated;
    }));

    ipcMain.handle('config:clear-drive', envelopeHandler(async () => {
      // Clear sync folder
      await configManager.setSyncFolder('');

      // Also stop sync if active
      if (this.syncManager) {
        await this.syncManager.stopSync();
      }
      if (this.syncManager) {
        await this.syncManager.stopSync();
      }
      return true;
    }));

    // Turbo operations (UX-3: migrated to the IpcResult envelope; payload
    // semantics unchanged — cost/estimate/top-up logic is untouched)
    ipcMain.handle('turbo:get-balance', envelopeHandler(async () => {
      try {
        if (!turboManager.isInitialized()) {
          throw new Error('Turbo not initialized');
        }
        return await turboManager.getBalance();
      } catch (error) {
        console.error('Failed to get Turbo balance:', error);
        throw error;
      }
    }));

    ipcMain.handle('turbo:get-upload-costs', envelopeHandler(async (_, bytes: number) => {
      try {
        // Validate input
        const validatedBytes = InputValidator.validatePositiveNumber(bytes, 'bytes', {
          min: 1,
          max: 1024 * 1024 * 1024 * 10, // Max 10GB
          integer: true
        });
        
        return await turboManager.getUploadCosts(validatedBytes);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Turbo upload costs validation failed:', error.message);
          throw error;
        }
        console.error('Failed to get Turbo upload costs:', error);
        throw error;
      }
    }));

    ipcMain.handle('turbo:get-fiat-estimate', envelopeHandler(async (_, byteCount: number, currency: string = 'usd') => {
      try {
        // Validate inputs
        const validatedByteCount = InputValidator.validatePositiveNumber(byteCount, 'byteCount', {
          min: 1,
          max: 1024 * 1024 * 1024 * 10, // Max 10GB
          integer: true
        });
        const validatedCurrency = InputValidator.validateString(currency, 'currency', {
          required: true,
          minLength: 3,
          maxLength: 3,
          pattern: /^[a-zA-Z]{3}$/
        });
        
        return await turboManager.getFiatEstimate(validatedByteCount, validatedCurrency.toLowerCase());
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Turbo fiat estimate validation failed:', error.message);
          throw error;
        }
        console.error('Failed to get fiat estimate:', error);
        throw error;
      }
    }));

    ipcMain.handle('turbo:create-checkout-session', envelopeHandler(async (_, amount: number, currency?: string) => {
      try {
        console.log('IPC create-checkout-session called');
        
        // Validate inputs
        const validatedAmount = InputValidator.validateTurboAmount(amount, 'amount');
        const validatedCurrency = InputValidator.validateString(currency || 'USD', 'currency', {
          required: true,
          minLength: 3,
          maxLength: 3,
          pattern: /^[A-Z]{3}$/
        });
        
        if (!turboManager.isInitialized()) {
          throw new Error('Turbo not initialized');
        }
        
        console.log('Using validated amount:', validatedAmount, 'currency:', validatedCurrency);
        
        return await turboManager.createCheckoutSession(validatedAmount, validatedCurrency);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Turbo checkout validation failed:', error.message);
          throw error;
        }
        console.error('Failed to create checkout session:', error);
        throw error;
      }
    }));

    ipcMain.handle('turbo:top-up-with-tokens', envelopeHandler(async (_, tokenAmount: number, feeMultiplier: number = 1.0) => {
      try {
        // Validate inputs
        const validatedTokenAmount = InputValidator.validateTurboAmount(tokenAmount, 'tokenAmount');
        const validatedFeeMultiplier = InputValidator.validatePositiveNumber(feeMultiplier, 'feeMultiplier', {
          min: 0.1,
          max: 10.0
        });
        
        if (!turboManager.isInitialized()) {
          throw new Error('Turbo not initialized');
        }
        return await turboManager.topUpWithTokens(validatedTokenAmount, validatedFeeMultiplier);
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Turbo top-up validation failed:', error.message);
          throw error;
        }
        console.error('Failed to top up with tokens:', error);
        throw error;
      }
    }));

    ipcMain.handle('turbo:is-initialized', envelopeHandler(async () => {
      return turboManager.isInitialized();
    }));

    ipcMain.handle('turbo:get-status', envelopeHandler(async () => {
      let hasBalance = false;
      let balance = null;
      let error = null;
      
      try {
        if (turboManager.isInitialized()) {
          balance = await turboManager.getBalance();
          hasBalance = balance && parseFloat(balance.ar) > 0;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';
      }
      
      return {
        isInitialized: turboManager.isInitialized(),
        hasBalance,
        balance,
        error
      };
    }));

    ipcMain.handle('config:clear-folder', envelopeHandler(async () => {
      // Clear sync folder
      await configManager.setSyncFolder('');

      // Also stop sync if active
      if (this.syncManager) {
        await this.syncManager.stopSync();
      }
      if (this.syncManager) {
        await this.syncManager.stopSync();
      }
      return true;
    }));

    // Dialog operations (UX-3: migrated to the IpcResult envelope)
    ipcMain.handle('dialog:select-folder', envelopeHandler(async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    }));

    ipcMain.handle('dialog:select-wallet', envelopeHandler(async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
      return result.canceled ? null : result.filePaths[0];
    }));

    // Shell operations (UX-3: migrated to the IpcResult envelope)
    ipcMain.handle('shell:open-external', envelopeHandler(async (_, url: string) => {
      try {
        // Validate URL
        const validatedUrl = InputValidator.validateString(url, 'url', {
          required: true,
          minLength: 1,
          maxLength: 2048
        });
        
        // Basic URL validation - must start with http/https
        if (!validatedUrl.startsWith('http://') && !validatedUrl.startsWith('https://')) {
          throw new ValidationError('URL must start with http:// or https://', 'url');
        }
        
        await shell.openExternal(validatedUrl);
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Shell open external validation failed:', error.message);
          throw error;
        }
        console.error('Failed to open external URL:', error);
        throw error;
      }
    }));

    ipcMain.handle('shell:open-path', envelopeHandler(async (_, path: string) => {
      try {
        // Validate the path
        const validatedPath = InputValidator.validateFilePath(path);
        
        // Check if this is a file path, and if so, get its directory
        const fs = (await import('fs')).promises;
        const pathModule = await import('path');
        
        let targetPath = validatedPath;
        try {
          const stats = await fs.stat(validatedPath);
          if (stats.isFile()) {
            // If it's a file, get the directory
            targetPath = pathModule.dirname(validatedPath);
            console.log(`Opening containing folder for file: ${validatedPath} -> ${targetPath}`);
          }
        } catch (err) {
          // If stat fails, assume it's already a directory or doesn't exist
          console.log(`Path stat failed, assuming directory: ${validatedPath}`);
        }
        
        // Open the path (file or folder)
        const result = await shell.openPath(targetPath);
        
        // openPath returns an error string if it fails, empty string on success
        if (result) {
          throw new Error(`Failed to open path: ${result}`);
        }
        
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Shell open path validation failed:', error.message);
          throw error;
        }
        console.error('Failed to open path:', error);
        throw error;
      }
    }));

    // Open file directly with default application
    ipcMain.handle('shell:open-file', envelopeHandler(async (_, filePath: string) => {
      try {
        // Validate the file path
        const validatedPath = InputValidator.validateFilePath(filePath);
        
        // Check if the file exists
        const fs = (await import('fs')).promises;
        try {
          const stats = await fs.stat(validatedPath);
          if (!stats.isFile()) {
            throw new Error('Path is not a file');
          }
        } catch (err) {
          throw new Error(`File does not exist: ${validatedPath}`);
        }
        
        console.log(`Opening file directly: ${validatedPath}`);
        const result = await shell.openPath(validatedPath);
        
        // openPath returns an error string if it fails, empty string on success
        if (result) {
          throw new Error(`Failed to open file: ${result}`);
        }
        
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Shell open file validation failed:', error.message);
          throw error;
        }
        console.error('Failed to open file:', error);
        throw error;
      }
    }));

    // Open the Turbo/Stripe checkout in a hardened child window (MONEY-7).
    // Guarantees:
    //  - host pinning: only the exact checkout host may load/navigate;
    //  - success detection: exact-URL match on will-navigate/will-redirect
    //    (never a substring or a timer);
    //  - exactly one accurate event: completing → one 'payment-completed';
    //    closing without completing → one 'payment-cancelled'; never both,
    //    never zero, never a success on a mere close (settled/once guard);
    //  - balance refresh on the success path only.
    // UX-3: normalized to the IpcResult envelope. Validation/creation failures
    // now RESOLVE { success:false, error } (via envelopeHandler) instead of the
    // hand-rolled shape; the success path returns void → { success:true }. All
    // MONEY-7 guarantees (host pinning, exactly-one-event, once-guard,
    // success-only balance refresh) are unchanged — only the outer envelope is.
    ipcMain.handle('payment:open-window', envelopeHandler(async (_, url: string) => {
        // Validate URL
        const validatedUrl = InputValidator.validateString(url, 'url', {
          required: true,
          minLength: 1,
          maxLength: 2048
        });

        // Payment URLs must use HTTPS.
        if (!validatedUrl.startsWith('https://')) {
          throw new ValidationError('Payment URL must use HTTPS', 'url');
        }

        // Host pinning: the only host the payment window may load or navigate
        // to is the exact host of the checkout URL the trusted Turbo SDK
        // handed us (Stripe hosted checkout → checkout.stripe.com). Any
        // navigation to a different origin is blocked — the sole exception is
        // the exact success redirect, handled below.
        let checkoutHost: string;
        try {
          checkoutHost = new URL(validatedUrl).host;
        } catch {
          throw new ValidationError('Payment URL is not a valid URL', 'url');
        }

        const paymentWindow = new BrowserWindow({
          width: 600,
          height: 700,
          parent: this.mainWindow || undefined,
          modal: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          },
          autoHideMenuBar: true,
          title: 'Complete Your Payment'
        });

        // Deny any popup / new-window request originating from the checkout
        // page — the payment flow is single-window.
        paymentWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

        // Exactly-one-event invariant. The first of {success, cancel} to
        // settle wins; the loser (e.g. the 'closed' our own close() fires
        // after a success) becomes a no-op.
        let settled = false;

        const settleSuccess = () => {
          if (settled) return;
          settled = true;
          // Exactly one success event; the renderer refreshes its Turbo
          // balance on this.
          this.mainWindow?.webContents.send('payment-completed');
          if (!paymentWindow.isDestroyed()) {
            paymentWindow.close();
          }
          // Balance refresh on completion (success path only). Best-effort:
          // a refresh failure must not suppress the success event.
          this.walletManager.getWalletInfo()
            .then((walletInfo) => {
              if (walletInfo) {
                this.mainWindow?.webContents.send('wallet-info-updated', walletInfo);
              }
            })
            .catch((refreshError) => {
              console.error('[payment] Failed to refresh wallet info after payment:', refreshError);
            });
        };

        const settleCancel = () => {
          if (settled) return;
          settled = true;
          // Exactly one cancel event: the user closed the window without
          // completing checkout.
          this.mainWindow?.webContents.send('payment-cancelled');
        };

        // Exact success-URL match: same origin AND same (trailing-slash
        // normalized) path, ignoring query/hash. Not a substring test.
        const isSuccessUrl = (candidate: string): boolean => {
          try {
            const u = new URL(candidate);
            const s = new URL(PAYMENT_SUCCESS_URL);
            const normPath = (p: string) => p.replace(/\/+$/, '');
            return u.origin === s.origin && normPath(u.pathname) === normPath(s.pathname);
          } catch {
            return false;
          }
        };

        // Guard every top-level navigation and server redirect.
        const handleNav = (event: { preventDefault(): void }, navUrl: string) => {
          if (isSuccessUrl(navUrl)) {
            // Don't render the success page — settle and close instead.
            event.preventDefault();
            settleSuccess();
            return;
          }
          let host: string | null = null;
          try {
            host = new URL(navUrl).host;
          } catch {
            host = null;
          }
          if (host !== checkoutHost) {
            // Never log navUrl — the checkout URL carries the session id.
            console.warn('[payment] Blocked navigation to a non-checkout host');
            event.preventDefault();
          }
        };

        paymentWindow.webContents.on('will-navigate', handleNav);
        paymentWindow.webContents.on('will-redirect', handleNav);
        // Belt: catch a success arrived-at without a cancelable pre-event.
        paymentWindow.webContents.on('did-navigate', (_event, navUrl) => {
          if (isSuccessUrl(navUrl)) {
            settleSuccess();
          }
        });

        // User closed the window (X / OS) → cancel, unless already settled.
        paymentWindow.on('closed', () => {
          settleCancel();
        });

        // Do not await: loadURL rejects (ERR_ABORTED) whenever we intercept a
        // redirect, and its message embeds the checkout URL — never surface it.
        paymentWindow.loadURL(validatedUrl).catch(() => {
          console.error('[payment] Payment window failed to load the checkout URL');
        });
    }));

    // Drive mappings handlers
    ipcMain.handle('drive-mappings:add', envelopeHandler(async (_, driveMapping: any) => {
      console.log('Adding drive mapping:', driveMapping);
      
      // PRIV-3: a mapping without its local folder leaves sync dead on
      // arrival — create the folder alongside the mapping.
      if (driveMapping?.localFolderPath) {
        const validatedFolderPath = InputValidator.validateFilePath(driveMapping.localFolderPath, 'localFolderPath');
        await fs.mkdir(validatedFolderPath, { recursive: true });
      }
      
      await databaseManager.addDriveMapping(driveMapping);
      return true;
    }));

    ipcMain.handle('drive-mappings:list', envelopeHandler(async () => {
      return await databaseManager.getDriveMappings();
    }));

    ipcMain.handle('drive-mappings:update', envelopeHandler(async (_, mappingId: string, updates: any) => {
      await databaseManager.updateDriveMapping(mappingId, updates);
      return true;
    }));

    ipcMain.handle('drive-mappings:remove', envelopeHandler(async (_, mappingId: string) => {
      await databaseManager.removeDriveMapping(mappingId);
      return true;
    }));

    ipcMain.handle('drive-mappings:get-by-id', envelopeHandler(async (_, mappingId: string) => {
      return await databaseManager.getDriveMappingById(mappingId);
    }));

    ipcMain.handle('drive-mappings:get-primary', envelopeHandler(async () => {
      const mappings = await databaseManager.getDriveMappings();
      return mappings.find(m => m.isActive) || mappings[0] || null;
    }));

    // System operations (UX-3: migrated to the IpcResult envelope)
    ipcMain.handle('system:get-env', envelopeHandler(async (_, key: string) => {
      // SEC-2: dev-only variables, gated behind dev mode. Packaged builds and
      // non-dev runs expose nothing (fails closed to undefined).
      return readDevEnv(key, { isPackaged: app.isPackaged, env: process.env });
    }));

    // Error reporting handler (UX-3: migrated to the IpcResult envelope)
    ipcMain.handle('error:report', envelopeHandler(async (_, errorData: {
      message: string;
      stack?: string;
      componentStack?: string;
      timestamp: string;
    }) => {
      try {
        // Validate error data
        if (!errorData || typeof errorData !== 'object') {
          throw new ValidationError('Error data must be a valid object', 'errorData');
        }
        
        const validatedMessage = InputValidator.validateString(errorData.message, 'message', {
          required: true,
          minLength: 1,
          maxLength: 2000
        });
        
        const validatedTimestamp = InputValidator.validateString(errorData.timestamp, 'timestamp', {
          required: true,
          minLength: 1,
          maxLength: 100
        });
        
        let validatedStack: string | undefined;
        if (errorData.stack) {
          validatedStack = InputValidator.validateString(errorData.stack, 'stack', {
            required: false,
            maxLength: 10000
          });
        }
        
        let validatedComponentStack: string | undefined;
        if (errorData.componentStack) {
          validatedComponentStack = InputValidator.validateString(errorData.componentStack, 'componentStack', {
            required: false,
            maxLength: 10000
          });
        }
        
        console.error('Frontend Error Report:', {
          timestamp: validatedTimestamp,
          message: validatedMessage,
          stack: validatedStack,
          componentStack: validatedComponentStack
        });
        
        // In production, you could send this to a logging service
        // For now, we'll just log it to the console and potentially write to a file
        
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Error report validation failed:', error.message);
          return false;
        }
        console.error('Failed to process error report:', error);
        return false;
      }
    }));
  }

  async shutdown(): Promise<void> {
    console.log('ArDriveApp - Starting graceful shutdown...');

    // UX-30: stop the tray's fallback poll so it doesn't keep firing (and
    // touching a torn-down DB/syncManager) after the app starts quitting.
    if (this.trayRefreshTimer) {
      clearInterval(this.trayRefreshTimer);
      this.trayRefreshTimer = null;
    }

    try {
      // Stop legacy sync manager
      if (this.syncManager) {
        await this.syncManager.stopSync();
      }
      
      // Stop multi-drive sync manager
      if (this.syncManager) {
        await this.syncManager.stopSync();
      }
      
      console.log('ArDriveApp - Graceful shutdown completed');
    } catch (error) {
      console.error('ArDriveApp - Error during shutdown:', error);
      throw error;
    }
  }
}

// Disable GPU hardware acceleration to prevent crashes on WSL2/Windows
app.disableHardwareAcceleration();

// Disable renderer backing store to reduce GPU usage
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

const ardriveApp = new ArDriveApp();

app.whenReady().then(async () => {
  // Disable application menu completely
  Menu.setApplicationMenu(null);
  
  await ardriveApp.initialize();
  ardriveApp.createWindow();
  await ardriveApp.createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ardriveApp.createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  ardriveApp.isQuitting = true;
  
  // Graceful shutdown of sync managers
  try {
    await ardriveApp.shutdown();
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
  }
});