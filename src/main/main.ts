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
          const primaryColor = rootStyle.getPropertyValue('--ardrive-primary');
          console.log('CSS Primary color:', primaryColor);
          console.log('Document stylesheets count:', document.styleSheets.length);
          for (let i = 0; i < document.styleSheets.length; i++) {
            const sheet = document.styleSheets[i];
            console.log('Stylesheet', i, ':', sheet.href || 'inline');
          }
        `);
      });
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });
    
    // Refresh wallet info when window regains focus (useful after Turbo payments)
    this.mainWindow.on('focus', async () => {
      try {
        const walletInfo = await this.walletManager.getWalletInfo();
        if (walletInfo) {
          // Send updated wallet info to renderer
          this.mainWindow?.webContents.send('wallet-info-updated', walletInfo);
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

    // Update tray menu every 30 seconds to show current status
    setInterval(() => {
      this.updateTrayMenu();
    }, 30000);
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
      const walletInfo = await this.walletManager.getWalletInfo();
      
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

    ipcMain.handle('wallet:get-info', safeIpcHandler(async () => {
      return await this.walletManager.getWalletInfo();
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
      
      // Get drive information with retry logic
      let selectedDrive = null;
      let retries = 3;
      
      while (retries > 0 && !selectedDrive) {
        const drives = await this.walletManager.listDrives();
        console.log('Available drives:', drives);
        
        // Get the first (and only) drive
        if (drives.length > 0) {
          selectedDrive = drives[0];
          break;
        }
        
        if (retries > 1) {
          console.log(`No drives found, retrying... (${retries - 1} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          retries--;
        } else {
          break;
        }
      }
      
      console.log('Selected drive:', selectedDrive);
      
      if (!selectedDrive) {
        throw new Error(`No drives found. Please create a drive first.`);
      }
      
      // Set ArDrive instance and start sync with drive name
      this.syncManager.setArDrive(arDrive);
      return await this.syncManager.startSync(selectedDrive.id, selectedDrive.rootFolderId, selectedDrive.name);
    }));

    ipcMain.handle('sync:stop', safeIpcHandler(async () => {
      return await this.syncManager.stopSync();
    }));

    ipcMain.handle('sync:status', safeIpcHandler(async () => {
      return await this.syncManager.getStatus();
    }));

    ipcMain.handle('sync:getFolder', safeIpcHandler(async () => {
      const config = await configManager.getConfig();
      return config.syncFolder;
    }));

    ipcMain.handle('sync:setFolder', safeIpcHandler(async (_, folderPath: string) => {
      await configManager.setSyncFolder(folderPath);
      this.syncManager.setSyncFolder(folderPath);
      return true;
    }));


    ipcMain.handle('files:get-uploads-by-mapping', async (_, mappingId: string) => {
      try {
        return await databaseManager.getUploadsByMapping(mappingId);
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

    // Upload approval queue operations
    ipcMain.handle('uploads:get-pending', async () => {
      return await databaseManager.getPendingUploads();
    });

    ipcMain.handle('uploads:approve', async (_, uploadId: string, uploadMethod?: 'ar' | 'turbo') => {
      // Move from pending to actual upload queue
      const pendingUploads = await databaseManager.getPendingUploads();
      const pendingUpload = pendingUploads.find(u => u.id === uploadId);
      
      if (!pendingUpload) {
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
        mappingId: pendingUpload.mappingId,
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
      
      // Route to appropriate sync manager based on mapping ID
      if (pendingUpload.mappingId) {
        // Multi-drive: add to specific sync engine
        // Upload will be handled by sync manager
      } else {
        // Legacy single-drive: add to sync manager
        this.syncManager.addToUploadQueue(upload);
      }
      
      return true;
    });

    ipcMain.handle('uploads:reject', async (_, uploadId: string) => {
      await databaseManager.updatePendingUploadStatus(uploadId, 'rejected');
      return true;
    });

    ipcMain.handle('uploads:approve-all', async () => {
      const pendingUploads = await databaseManager.getPendingUploads();
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
            mappingId: pendingUpload.mappingId,
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
          
          // Route to appropriate sync manager
          if (pendingUpload.mappingId) {
            // Upload will be handled by sync manager
          } else {
            this.syncManager.addToUploadQueue(upload);
          }
          
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