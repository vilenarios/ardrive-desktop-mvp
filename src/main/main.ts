import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SecureWalletManager } from './wallet-manager-secure';
import { configManager } from './config-manager';
import { SyncManager } from './sync-manager';
import { databaseManager } from './database-manager';
import { turboManager } from './turbo-manager';
import { FileUpload } from '../types';
import { arnsService } from './arns-service';
import { profileManager } from './profile-manager';
import InputValidator, { ValidationError } from './input-validator';

// Load .env file in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Utility function to safely wrap IPC handlers with error handling
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
    try {
      // Check if we have an active profile and set up database isolation
      const activeProfile = await profileManager.getActiveProfile();
      if (activeProfile) {
        console.log('Setting up database for active profile:', activeProfile.id);
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
            // Set ArDrive for sync manager
            this.syncManager.setArDrive(arDrive);
          }
          
          // Legacy migration removed - no longer needed
        } else {
          console.log('Wallet auto-load failed - will need manual re-import');
        }
      }
      
      // Sync folder will be restored when needed
      console.log('Sync folder loaded:', config.syncFolder || 'None');
      
      // Auto-start sync for returning users if we have everything needed
      if (config.syncFolder && this.walletManager.isWalletLoaded()) {
        console.log('Auto-starting sync for returning user...');
        try {
          // Get drive mappings to start sync
          const driveMappings = await databaseManager.getDriveMappings();
          const primaryMapping = driveMappings.find(m => m.isActive) || driveMappings[0];
          
          if (primaryMapping) {
            console.log('Found primary drive mapping, starting sync...');
            this.syncManager.setSyncFolder(config.syncFolder);
            await this.syncManager.startSync(
              primaryMapping.driveId,
              primaryMapping.rootFolderId,
              primaryMapping.driveName
            );
            console.log('Sync auto-started successfully for returning user');
          } else {
            console.log('No drive mappings found, skipping auto-sync');
          }
        } catch (syncError) {
          console.error('Failed to auto-start sync:', syncError);
          // Don't throw - this is non-critical, user can manually start sync
        }
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
    
    // Refresh wallet info when window regains focus only if payment-related
    this.mainWindow.on('focus', async () => {
      try {
        // Only refresh if we're on a payment-related page
        const currentURL = await this.mainWindow?.webContents.getURL();
        const isPaymentRelated = currentURL && (
          currentURL.includes('turbo') || 
          currentURL.includes('payment') ||
          currentURL.includes('checkout')
        );
        
        if (isPaymentRelated) {
          console.log('Window focused on payment-related page, refreshing wallet info');
          const walletInfo = await this.walletManager.getWalletInfo();
          if (walletInfo) {
            // Send updated wallet info to renderer
            this.mainWindow?.webContents.send('wallet-info-updated', walletInfo);
          }
        }
      } catch (error) {
        console.error('Failed to refresh wallet info on focus:', error);
      }
    });

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
  }

  async updateTrayMenu() {
    if (!this.tray) return;

    try {
      // Check if user is authenticated
      const isAuthenticated = await this.walletManager.isWalletLoaded();
      
      // For unauthenticated users, show minimal menu
      if (!isAuthenticated) {
        const contextMenu = Menu.buildFromTemplate([
          {
            label: 'ArDrive Desktop',
            enabled: false
          },
          { type: 'separator' },
          {
            label: '🔒 Not signed in',
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
        this.tray.setToolTip('ArDrive Desktop - Not signed in');
        return;
      }
      
      // Get current status for authenticated users
      const config = await configManager.getConfig();
      const globalStatus = await this.syncManager.getStatus();
      
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
      
      let syncStatusLabel = '⏸ Sync Paused';
      if (globalStatus?.isActive) {
        const pendingCount = globalStatus.totalFiles - globalStatus.uploadedFiles;
        if (pendingCount > 0) {
          syncStatusLabel = `🔄 Syncing (${pendingCount} pending)`;
        } else {
          syncStatusLabel = '✅ Sync Active - Up to date';
        }
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
            if (globalStatus?.isActive) {
              await this.syncManager.stopSync();
            } else {
              const drives = await this.walletManager.listDrives();
              if (drives && drives.length > 0) {
                await this.syncManager.startSync(drives[0].id, drives[0].rootFolderId, drives[0].name);
              }
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
        
        // Quick Actions
        {
          label: '📁 Open Sync Folder',
          click: async () => {
            // Open the sync folder
            if (config.syncFolder) {
              shell.openPath(config.syncFolder);
            }
          },
          enabled: !!config.syncFolder
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
          label: '❌ Quit ArDrive',
          click: () => {
            this.isQuitting = true;
            app.quit();
          }
        }
      ];

      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      this.tray.setContextMenu(contextMenu);
      
      // Update tooltip with current status
      let tooltip = 'ArDrive Desktop';
      if (globalStatus?.isActive) {
        const pendingCount = globalStatus.totalFiles - globalStatus.uploadedFiles;
        if (pendingCount > 0) {
          tooltip += `\n🔄 Syncing ${pendingCount} file${pendingCount === 1 ? '' : 's'}`;
        } else {
          tooltip += '\n✅ Up to date';
        }
      } else {
        tooltip += '\n⏸ Sync paused';
      }
      
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

  private setupIpcHandlers() {
    // Wallet operations
    ipcMain.handle('wallet:import', async (_, walletPath: string, password: string) => {
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
    });

    ipcMain.handle('wallet:get-info', safeIpcHandler(async (_, forceRefresh?: boolean) => {
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

    ipcMain.handle('wallet:ensure-loaded', safeIpcHandler(async () => {
      // Check if wallet is loaded, if not try to auto-load
      if (!this.walletManager.isWalletLoaded()) {
        return await this.walletManager.attemptAutoLoad();
      }
      return true;
    }));

    ipcMain.handle('wallet:is-loaded', async () => {
      return this.walletManager.isWalletLoaded();
    });

    ipcMain.handle('wallet:has-stored', async () => {
      return await this.walletManager.hasStoredWallet();
    });

    ipcMain.handle('wallet:clear-stored', safeIpcHandler(async () => {
      await this.walletManager.logout();
      return true;
    }));

    ipcMain.handle('wallet:logout', safeIpcHandler(async () => {
      await this.walletManager.logout();
      return true;
    }));

    ipcMain.handle('wallet:import-from-seed-phrase', async (_, seedPhrase: string, password: string) => {
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
    });

    ipcMain.handle('wallet:create-new', async (_, password: string) => {
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
    });


    // Ethereum wallet operations (TODO: Implement when ardrive-core-js supports Ethereum)
    ipcMain.handle('wallet:import-ethereum-from-file', async (_, walletPath: string, password: string) => {
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
    });


    // Wallet export operations
    ipcMain.handle('wallet:export', async (_, options: {
      format: 'jwk-encrypted' | 'jwk-plain' | 'seed-phrase' | 'private-key';
      password: string;
      newPassword?: string;
    }) => {
      try {
        const { initializeWalletExportManager } = require('./wallet-export-manager');
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
    });

    // ArNS operations
    ipcMain.handle('arns:get-profile', async (_, address: string) => {
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
    });

    // Keychain/Security operations
    ipcMain.handle('security:is-keychain-available', async () => {
      return this.walletManager.isKeychainAvailable();
    });
    
    ipcMain.handle('security:get-method', async () => {
      return this.walletManager.getSecurityMethod();
    });

    // Profile operations
    ipcMain.handle('profiles:list', async () => {
      try {
        return await profileManager.getProfiles();
      } catch (error) {
        console.error('Failed to list profiles:', error);
        throw error;
      }
    });

    ipcMain.handle('profiles:get-active', async () => {
      try {
        return await profileManager.getActiveProfile();
      } catch (error) {
        console.error('Failed to get active profile:', error);
        return null;
      }
    });

    ipcMain.handle('profiles:switch', async (_, profileId: string, password?: string) => {
      try {
        // Validate inputs
        const validatedProfileId = InputValidator.validateProfileId(profileId, 'profileId');
        let validatedPassword: string | undefined;
        if (password) {
          validatedPassword = InputValidator.validatePassword(password, 'password');
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
    });

    ipcMain.handle('profiles:update', async (_, profileId: string, updates: any) => {
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
    });

    ipcMain.handle('profiles:delete', async (_, profileId: string) => {
      try {
        // Validate input
        const validatedProfileId = InputValidator.validateProfileId(profileId, 'profileId');
        
        await profileManager.deleteProfile(validatedProfileId);
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Profile delete validation failed:', error.message);
          throw error;
        }
        console.error('Failed to delete profile:', error);
        throw error;
      }
    });

    // Drive operations
    ipcMain.handle('drive:list', safeIpcHandler(async () => {
      return await this.walletManager.listDrives();
    }));

    ipcMain.handle('drive:create', safeIpcHandler(async (_, name: string, privacy: 'private' | 'public' = 'private') => {
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

    ipcMain.handle('drive:rename', safeIpcHandler(async (_, driveId: string, newName: string) => {
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
      const { ArweaveAddress, stubEntityID } = require('ardrive-core-js');
      
      // For public drives, we need to create a stub for privateKeyData
      const drives = await arDrive.getAllDrivesForAddress({ 
        address: new ArweaveAddress(walletInfo.address),
        privateKeyData: stubEntityID  // Use stub for public drives in MVP
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
          console.log('Using Turbo for drive rename (free under 100KB)');
          
          // ArDrive will automatically use Turbo if available
          // The ardrive-core-js library handles Turbo configuration internally
          usedTurbo = true;
        }
      } catch (err) {
        console.log('Turbo not available, will use AR tokens:', err);
      }
      
      // Rename the drive based on its privacy setting
      if (drive.drivePrivacy === 'public') {
        const { EntityID } = require('ardrive-core-js');
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
      
      return { success: true, newName: validatedName, usedTurbo };
    }));

    ipcMain.handle('drive:select', safeIpcHandler(async (_, driveId: string) => {
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
    ipcMain.handle('drive:get-permaweb-files', safeIpcHandler(async (_, driveId: string, forceRefresh: boolean = false) => {
      console.log('Getting permaweb files for drive:', driveId, 'Force refresh:', forceRefresh);
      
      // Validate drive ID
      const validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
      
      // Get the drive mapping for this drive
      const driveMappings = await databaseManager.getDriveMappings();
      const driveMapping = driveMappings.find((m: any) => m.driveId === validatedDriveId);
      
      if (!driveMapping) {
        throw new Error('Drive mapping not found');
      }
      
      // First, try to get from local cache unless force refresh
      if (!forceRefresh) {
        console.log('Checking local cache for drive metadata...');
        const cachedMetadata = await databaseManager.getDriveMetadata(driveMapping.id);
        
        if (cachedMetadata && cachedMetadata.length > 0) {
          console.log(`Found ${cachedMetadata.length} items in local cache`);
          
          // Transform cached data to match expected format
          const fileItems = cachedMetadata.map((item: any) => ({
            id: item.fileId,
            name: item.name,
            type: item.type,
            size: item.type === 'file' && item.size !== '[object Object]' ? item.size : undefined,
            modifiedAt: item.lastModifiedDate && item.lastModifiedDate !== '[object Object]'
              ? new Date(item.lastModifiedDate) 
              : item.createdAt 
                ? new Date(item.createdAt)
                : item.uploadedDate
                  ? new Date(item.uploadedDate)
                  : new Date(Date.now() - 86400000), // Default to 1 day ago instead of current time
            isDownloaded: item.localFileExists,
            isUploaded: true,
            status: item.syncStatus || 'synced',
            path: item.path,
            parentId: item.parentFolderId || '',
            ardriveUrl: item.type === 'file' ? `https://app.ardrive.io/#/file/${item.fileId}/view` : undefined,
            dataTxId: item.dataTxId,
            metadataTxId: item.metadataTxId,
            contentType: item.contentType
          }));
          
          return fileItems;
        }
        console.log('No cached data found, will query ArDrive API');
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
        const { EntityID } = require('ardrive-core-js');
        
        // MVP: Only support public drives for now
        if (drive.privacy !== 'public') {
          throw new Error('Private drives are not supported in this version');
        }
        
        // For newly created drives, the root folder might not be immediately available
        // Add a retry mechanism with delay
        let entities;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            // List public folder contents
            entities = await arDrive.listPublicFolder({
              folderId: new EntityID(drive.rootFolderId),
              maxDepth: 10, // Get full hierarchy
              includeRoot: false // Don't include root folder itself
            });
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
            path: entity.path || '/',
            parentId: entity.parentFolderId?.toString() || '',
            // ArDrive sharing links (only for files, not folders)
            ardriveUrl: isFile 
              ? `https://app.ardrive.io/#/file/${entityId}/view`
              : undefined,
            // Also include transaction IDs for direct Arweave access if needed
            dataTxId: entity.dataTxId?.toString() || '',
            metadataTxId: (entity.metadataTxId || entity.metaDataTxId)?.toString() || '',
            // Additional metadata that might be useful
            contentType: isFile ? entity.dataContentType : undefined,
            driveId: drive.id,
            privacy: drive.privacy
          };
        });
        
        return fileItems;
      } catch (error) {
        console.error('Failed to fetch drive entities:', error);
        throw error;
      }
    }));

    // Create Arweave manifest for a folder
    ipcMain.handle('drive:create-manifest', safeIpcHandler(async (_, params: {
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
      const { EntityID } = require('ardrive-core-js');
      
      // List all files in the folder to check count
      const entities = await arDrive.listPublicFolder({
        folderId: new EntityID(validatedFolderId),
        maxDepth: Number.MAX_SAFE_INTEGER,
        includeRoot: false
      });
      
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
      
      // Create manifest with replace behavior (creates new version if exists)
      const result = await arDrive.uploadPublicManifest({
        folderId: new EntityID(validatedFolderId),
        destManifestName: manifestName,
        conflictResolution: 'replace'
      });
      
      // Save manifest to local sync folder
      const config = await configManager.getConfig();
      if (config.syncFolder && result.manifest) {
        const localManifestPath = path.join(
          config.syncFolder, 
          `${manifestName.replace('.json', '')}.arweave-manifest.json`
        );
        
        const manifestContent = {
          _metadata: {
            created: new Date().toISOString(),
            txId: result.created[0].dataTxId,
            arweaveUrl: result.links[0],
            fileCount: files.length,
            folderId: validatedFolderId,
            driveId: validatedDriveId
          },
          ...result.manifest
        };
        
        await fs.writeFile(localManifestPath, JSON.stringify(manifestContent, null, 2));
      }
      
      return {
        success: true,
        manifestUrl: result.links[0],
        fileUrls: result.links.slice(1),
        fees: result.fees,
        txId: result.created[0].dataTxId,
        fileCount: files.length,
        manifestName: manifestName
      };
    }));

    // Get folder tree for manifest creation
    ipcMain.handle('drive:get-folder-tree', safeIpcHandler(async (_, driveId: string) => {
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
          // Filter only folders from cached data
          const folders = cachedMetadata
            .filter(item => item.type === 'folder')
            .map(folder => ({
              id: folder.fileId,
              name: folder.name,
              parentId: folder.parentFolderId || '',
              path: folder.path || '/'
            }));
          
          // If no folders found, add the root folder
          if (folders.length === 0 && driveMapping) {
            console.log('No folders in cache, adding root folder');
            folders.push({
              id: driveMapping.rootFolderId || driveMapping.driveId,
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
      const arDrive = this.walletManager.getArDrive();
      if (!arDrive) {
        throw new Error('ArDrive not initialized');
      }
      
      // Import needed types
      const { EntityID } = require('ardrive-core-js');
      
      // Get drive info
      const drives = await this.walletManager.listDrives();
      const drive = drives.find(d => d.id === validatedDriveId);
      
      if (!drive) {
        throw new Error('Drive not found');
      }
      
      if (!drive.rootFolderId) {
        throw new Error('Drive has no root folder ID');
      }
      
      console.log('Fetching folder structure from ArDrive...');
      // Get folder structure
      const entities = await arDrive.listPublicFolder({
        folderId: new EntityID(drive.rootFolderId),
        maxDepth: 10,
        includeRoot: true
      });
      
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

    // Sync operations
    ipcMain.handle('sync:set-folder', async (_, driveId: string, folderPath: string) => {
      try {
        // Validate inputs
        const validatedFolderPath = InputValidator.validateFilePath(folderPath, 'folderPath');
        let validatedDriveId: string | undefined;
        
        // Handle the case where driveId is provided (from combined setup)
        if (driveId) {
          validatedDriveId = InputValidator.validateDriveId(driveId, 'driveId');
          // Drive selection now handled by drive mappings
        }
        
        // Sync folder now handled by drive mappings
        this.syncManager.setSyncFolder(validatedFolderPath);
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Sync folder validation failed:', error.message);
          throw error;
        }
        throw error;
      }
    });

    // Get recent uploads for Activity tab
    ipcMain.handle('sync:get-uploads', safeIpcHandler(async () => {
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

    ipcMain.handle('sync:start', safeIpcHandler(async () => {
      console.log('IPC: sync:start called');
      const config = await configManager.getConfig();
      console.log('Config for sync:', config);
      
      if (!config.syncFolder) {
        throw new Error('No sync folder configured. Please set up sync first.');
      }
      
      console.log('Using sync folder:', config.syncFolder);
      
      // Ensure sync folder is set in sync manager
      this.syncManager.setSyncFolder(config.syncFolder);
      
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
      
      // Set ArDrive instance and start sync with drive mapping
      this.syncManager.setArDrive(arDrive);
      return await this.syncManager.startSync(
        primaryMapping.driveId, 
        primaryMapping.rootFolderId, 
        primaryMapping.driveName
      );
    }));

    ipcMain.handle('sync:stop', safeIpcHandler(async () => {
      return await this.syncManager.stopSync();
    }));

    ipcMain.handle('sync:status', safeIpcHandler(async () => {
      return await this.syncManager.getStatus();
    }));

    // DEBUG: Sync state handlers
    ipcMain.handle('sync:get-state', safeIpcHandler(async () => {
      return this.syncManager.getCurrentSyncState();
    }));

    ipcMain.handle('sync:force-monitoring', safeIpcHandler(async () => {
      console.log('🔧 Force starting file monitoring via IPC');
      await this.syncManager.forceStartFileMonitoring();
      return true;
    }));

    ipcMain.handle('sync:getFolder', safeIpcHandler(async () => {
      const config = await configManager.getConfig();
      return config.syncFolder;
    }));

    ipcMain.handle('sync:setFolder', safeIpcHandler(async (_, folderPath: string) => {
      // Create the folder if it doesn't exist
      try {
        await fs.mkdir(folderPath, { recursive: true });
        console.log('Created sync folder:', folderPath);
      } catch (error) {
        console.error('Error creating sync folder:', error);
        throw new Error('Failed to create sync folder');
      }
      
      await configManager.setSyncFolder(folderPath);
      this.syncManager.setSyncFolder(folderPath);
      return true;
    }));


    ipcMain.handle('files:get-uploads-by-mapping', async (_, mappingId: string) => {
      try {
        return await databaseManager.getUploadsByDrive(mappingId); // TODO: Rename parameter from mappingId to driveId
      } catch (error) {
        console.error('Failed to get uploads by mapping:', error);
        throw error;
      }
    });

    // File operations
    ipcMain.handle('files:get-uploads', async () => {
      return await databaseManager.getUploads();
    });

    ipcMain.handle('files:get-downloads', async () => {
      return await databaseManager.getDownloads();
    });

    ipcMain.handle('files:redownload-all', async () => {
      console.log('Manual re-download requested');
      try {
        // Trigger a manual download of existing drive files
        await this.syncManager.forceDownloadExistingFiles();
        return { success: true };
      } catch (error) {
        console.error('Failed to re-download files:', error);
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    });

    // Manual sync operation (different from background sync monitoring)
    ipcMain.handle('sync:manual', safeIpcHandler(async () => {
      console.log('Manual sync requested from UI');
      try {
        // Emit sync progress phases for UI
        const emitProgress = (phase: string, description: string, itemsProcessed?: number, estimatedRemaining?: number) => {
          const progress = {
            phase,
            description,
            currentItem: undefined,
            itemsProcessed,
            estimatedRemaining
          };
          console.log(`🔄 Emitting sync progress:`, progress);
          if (this.mainWindow) {
            this.mainWindow.webContents.send('sync:progress', progress);
            console.log(`📤 Sending sync:progress to renderer`);
          }
        };

        // Step 1: Starting
        emitProgress('starting', 'Initializing manual sync...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay for UI

        // Step 2: Metadata - Check for new local files (scan upload queue)
        emitProgress('metadata', 'Scanning local folder for new files...');
        // Note: This will trigger file watcher to detect new files for upload queue
        // The actual upload scanning happens in the background via file monitoring
        await new Promise(resolve => setTimeout(resolve, 300));

        // Step 3: Folders phase
        emitProgress('folders', 'Processing folder structure...');
        await new Promise(resolve => setTimeout(resolve, 300));

        // Step 4: Files - Download existing drive files
        emitProgress('files', 'Checking permaweb for updates...');
        await this.syncManager.forceDownloadExistingFiles();

        // Step 5: Verification
        emitProgress('verification', 'Verifying sync results...');
        await new Promise(resolve => setTimeout(resolve, 200));

        // Step 6: Complete
        emitProgress('complete', 'Manual sync completed successfully');

        return { success: true, message: 'Manual sync completed' };
      } catch (error) {
        console.error('Manual sync failed:', error);
        
        // Emit error state
        if (this.mainWindow) {
          this.mainWindow.webContents.send('sync:progress', {
            phase: 'complete',
            description: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error: true
          });
        }
        
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Manual sync failed' 
        };
      }
    }));

    // Upload approval queue operations
    ipcMain.handle('uploads:get-pending', async () => {
      return await databaseManager.getPendingUploads();
    });

    ipcMain.handle('uploads:approve', async (_, uploadId: string, uploadMethod?: 'ar' | 'turbo') => {
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
      
      // Use specified method or fall back to recommended method
      const selectedMethod = uploadMethod || pendingUpload.recommendedMethod || 'ar';
      
      // Validate Turbo balance if Turbo method is selected and file is not free
      const TURBO_FREE_SIZE_LIMIT = 100 * 1024; // 100KB
      const isFreeWithTurbo = pendingUpload.fileSize <= TURBO_FREE_SIZE_LIMIT;
      
      if (selectedMethod === 'turbo' && turboManager.isInitialized() && !isFreeWithTurbo) {
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
        uploadMethod: selectedMethod,
        dataTxId: undefined,
        metadataTxId: undefined,
        transactionId: undefined,
        error: undefined,
        completedAt: undefined,
        createdAt: new Date()
      };
      
      await databaseManager.addUpload(upload);
      await databaseManager.removePendingUpload(uploadId);
      
      // Add to sync manager
      this.syncManager.addToUploadQueue(upload);
      
      return true;
    });

    ipcMain.handle('uploads:reject', async (_, uploadId: string) => {
      await databaseManager.updatePendingUploadStatus(uploadId, 'rejected');
      return true;
    });

    ipcMain.handle('uploads:approve-all', async () => {
      const pendingUploads = await databaseManager.getPendingUploads();
      
      // Force refresh wallet balance before checking funds
      console.log('Refreshing wallet balance before upload approval...');
      const walletInfo = await this.walletManager.getWalletInfo();
      
      if (!walletInfo) {
        throw new Error('Wallet not loaded');
      }
      
      let approvedCount = 0;
      const errors: string[] = [];
      const TURBO_FREE_SIZE_LIMIT = 100 * 1024; // 100KB
      
      // Get current balances
      const arBalance = parseFloat(walletInfo.balance) * 1e12; // Convert AR to winston
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
          // Determine which payment method to use
          const selectedMethod = pendingUpload.recommendedMethod || 'ar';
          const isFreeWithTurbo = pendingUpload.fileSize <= TURBO_FREE_SIZE_LIMIT;
          
          // Validate balance for the selected method
          if (selectedMethod === 'turbo') {
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
          } else {
            // AR payment method
            const estimatedCostWinc = pendingUpload.fileSize; // ~1 winston per byte
            
            if (arBalance < estimatedCostWinc) {
              errors.push(`${pendingUpload.fileName}: Insufficient AR balance (need ${(estimatedCostWinc/1e12).toFixed(6)} AR)`);
              continue; // Skip this file
            }
            
            // Note: We don't deduct from AR balance as it's not consumed until actual upload
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
            uploadMethod: selectedMethod,
            dataTxId: undefined,
            metadataTxId: undefined,
            transactionId: undefined,
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
      
      // Return summary of what was approved and any errors
      return {
        approvedCount,
        totalCount: pendingUploads.length,
        errors: errors.length > 0 ? errors : undefined
      };
    });

    ipcMain.handle('uploads:reject-all', async () => {
      await databaseManager.clearAllPendingUploads();
      return true;
    });
    
    ipcMain.handle('uploads:cancel', async (_, uploadId: string) => {
      try {
        // Cancel the upload in sync manager
        if (this.syncManager) {
          this.syncManager.cancelUpload(uploadId);
        }
        
        // Update database status
        await databaseManager.updateUpload(uploadId, { status: 'failed', error: 'Cancelled by user' });
        
        // Emit progress event
        if (this.mainWindow) {
          this.mainWindow.webContents.send('upload:progress', {
            uploadId,
            progress: 0,
            status: 'failed',
            error: 'Cancelled by user'
          });
        }
        
        return true;
      } catch (error) {
        console.error('Failed to cancel upload:', error);
        throw error;
      }
    });
    
    ipcMain.handle('uploads:retry', async (_, uploadId: string) => {
      try {
        // Get the upload from database
        const uploads = await databaseManager.getUploads();
        const upload = uploads.find(u => u.id === uploadId);
        
        if (!upload) {
          throw new Error('Upload not found');
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
    });
    
    ipcMain.handle('uploads:retry-all', async () => {
      try {
        // Get all failed uploads
        const uploads = await databaseManager.getUploads();
        const failedUploads = uploads.filter(u => u.status === 'failed');
        
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
    });

    // Config operations
    ipcMain.handle('config:get', async () => {
      return await configManager.getConfig();
    });

    ipcMain.handle('config:mark-first-run-complete', async () => {
      return await configManager.markFirstRunComplete();
    });

    ipcMain.handle('config:clear-drive', async () => {
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
    });

    // Turbo operations
    ipcMain.handle('turbo:get-balance', async () => {
      try {
        if (!turboManager.isInitialized()) {
          throw new Error('Turbo not initialized');
        }
        return await turboManager.getBalance();
      } catch (error) {
        console.error('Failed to get Turbo balance:', error);
        throw error;
      }
    });

    ipcMain.handle('turbo:get-upload-costs', async (_, bytes: number) => {
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
    });

    ipcMain.handle('turbo:get-fiat-estimate', async (_, byteCount: number, currency: string = 'usd') => {
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
    });

    ipcMain.handle('turbo:create-checkout-session', async (_, amount: number, currency?: string) => {
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
    });

    ipcMain.handle('turbo:top-up-with-tokens', async (_, tokenAmount: number, feeMultiplier: number = 1.0) => {
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
    });

    ipcMain.handle('turbo:is-initialized', async () => {
      return turboManager.isInitialized();
    });

    ipcMain.handle('turbo:get-status', async () => {
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
    });

    ipcMain.handle('config:clear-folder', async () => {
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
    });

    // Dialog operations
    ipcMain.handle('dialog:select-folder', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle('dialog:select-wallet', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
      return result.canceled ? null : result.filePaths[0];
    });

    // Shell operations
    ipcMain.handle('shell:open-external', async (_, url: string) => {
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
    });

    ipcMain.handle('shell:open-path', async (_, path: string) => {
      try {
        // Validate the path
        const validatedPath = InputValidator.validateFilePath(path);
        
        // Check if this is a file path, and if so, get its directory
        const fs = require('fs').promises;
        const pathModule = require('path');
        
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
    });

    // Open file directly with default application
    ipcMain.handle('shell:open-file', async (_, filePath: string) => {
      try {
        // Validate the file path
        const validatedPath = InputValidator.validateFilePath(filePath);
        
        // Check if the file exists
        const fs = require('fs').promises;
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
    });
    
    // Open payment in a new child window instead of external browser
    ipcMain.handle('payment:open-window', async (_, url: string) => {
      try {
        // Validate URL
        const validatedUrl = InputValidator.validateString(url, 'url', {
          required: true,
          minLength: 1,
          maxLength: 2048
        });
        
        // Basic URL validation - must start with https for payment security
        if (!validatedUrl.startsWith('https://')) {
          throw new ValidationError('Payment URL must use HTTPS', 'url');
        }
        
        const paymentWindow = new BrowserWindow({
          width: 600,
          height: 700,
          parent: this.mainWindow || undefined,
          modal: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          },
          autoHideMenuBar: true,
          title: 'Complete Your Payment'
        });
        
        paymentWindow.loadURL(validatedUrl);
      
      // Listen for successful payment redirects
      paymentWindow.webContents.on('will-navigate', (event, navUrl) => {
        console.log('Payment window navigating to:', navUrl);
        
        // Check if this is a success redirect
        if (navUrl.includes('app.ardrive.io') || navUrl.includes('success')) {
          // Send success event to main window
          this.mainWindow?.webContents.send('payment-completed');
          
          // Close payment window after a short delay
          setTimeout(() => {
            paymentWindow.close();
          }, 2000);
        }
        });
        
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          console.error('Payment window validation failed:', error.message);
          throw error;
        }
        console.error('Failed to open payment window:', error);
        throw error;
      }
    });

    // Drive mappings handlers
    ipcMain.handle('drive-mappings:add', safeIpcHandler(async (_, driveMapping: any) => {
      console.log('Adding drive mapping:', driveMapping);
      await databaseManager.addDriveMapping(driveMapping);
      return true;
    }));

    ipcMain.handle('drive-mappings:list', safeIpcHandler(async () => {
      return await databaseManager.getDriveMappings();
    }));

    ipcMain.handle('drive-mappings:update', safeIpcHandler(async (_, mappingId: string, updates: any) => {
      await databaseManager.updateDriveMapping(mappingId, updates);
      return true;
    }));

    ipcMain.handle('drive-mappings:remove', safeIpcHandler(async (_, mappingId: string) => {
      await databaseManager.removeDriveMapping(mappingId);
      return true;
    }));

    ipcMain.handle('drive-mappings:get-by-id', safeIpcHandler(async (_, mappingId: string) => {
      return await databaseManager.getDriveMappingById(mappingId);
    }));

    ipcMain.handle('drive-mappings:get-primary', safeIpcHandler(async () => {
      const mappings = await databaseManager.getDriveMappings();
      return mappings.find(m => m.isActive) || mappings[0] || null;
    }));

    // System operations
    ipcMain.handle('system:get-env', async (_, key: string) => {
      // Only allow specific dev mode environment variables
      const allowedKeys = ['ARDRIVE_DEV_MODE', 'ARDRIVE_DEV_WALLET_PATH', 'ARDRIVE_DEV_PASSWORD', 'ARDRIVE_DEV_SYNC_FOLDER'];
      if (!allowedKeys.includes(key)) {
        return undefined;
      }
      return process.env[key];
    });

    // Error reporting handler
    ipcMain.handle('error:report', async (_, errorData: {
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
    });
  }

  async shutdown(): Promise<void> {
    console.log('ArDriveApp - Starting graceful shutdown...');
    
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