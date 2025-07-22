import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig, DriveSyncMapping } from '../types';
import { profileManager } from './profile-manager';
import { databaseManager } from './database-manager';
import * as crypto from 'crypto';

export class ConfigManager {
  private globalConfigPath: string;
  private globalConfig: AppConfig;
  private currentProfileId: string | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.globalConfigPath = path.join(userDataPath, 'config.json');
    this.globalConfig = {
      isFirstRun: true
    };
  }

  private getProfileConfigPath(): string {
    if (!this.currentProfileId) {
      throw new Error('No active profile for config');
    }
    return profileManager.getProfileStoragePath(this.currentProfileId, 'config.json');
  }

  async initialize() {
    
    // Load global config
    try {
      const configData = await fs.readFile(this.globalConfigPath, 'utf8');
      this.globalConfig = JSON.parse(configData);
    } catch (error) {
      await this.saveGlobalConfig();
    }
    
    // Set current profile if available
    const activeProfile = await profileManager.getActiveProfile();
    if (activeProfile) {
      this.currentProfileId = activeProfile.id;
    }
  }

  async getConfig(): Promise<AppConfig> {
    // If no profile is active, return global config
    if (!this.currentProfileId) {
      return { ...this.globalConfig };
    }
    
    // Try to load profile-specific config
    try {
      const profileConfigPath = this.getProfileConfigPath();
      const configData = await fs.readFile(profileConfigPath, 'utf8');
      const profileConfig = JSON.parse(configData);
      
      // Get drive mappings from database
      const driveMappings = await databaseManager.getDriveMappings();
      
      const config = { 
        ...this.globalConfig, 
        ...profileConfig, 
        isFirstRun: false,
        driveMappings 
      };
      
      // Migration removed - legacy fields no longer supported
      
      return config;
    } catch (error) {
      // No profile config yet, return defaults with global config
      return { 
        ...this.globalConfig, 
        isFirstRun: false
      };
    }
  }

  async setWalletPath(walletPath: string) {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    await this.updateProfileConfig({ walletPath, isFirstRun: false });
  }

  async setSyncFolder(folderPath: string) {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    await this.updateProfileConfig({ syncFolder: folderPath });
  }

  // Drive management
  async markFirstRunComplete() {
    console.log('ConfigManager - markFirstRunComplete called');
    this.globalConfig.isFirstRun = false;
    await this.saveGlobalConfig();
    console.log('ConfigManager - global config saved successfully');
    return true;
  }

  // Legacy clear methods removed - use removeDriveMapping instead

  // Migration removed - legacy fields no longer supported

  async setActiveProfile(profileId: string) {
    this.currentProfileId = profileId;
  }

  private async saveGlobalConfig() {
    try {
      await fs.writeFile(this.globalConfigPath, JSON.stringify(this.globalConfig, null, 2));
    } catch (error) {
      console.error('Failed to save global config:', error);
      throw error;
    }
  }

  private async updateProfileConfig(updates: Partial<AppConfig>) {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    
    try {
      const profileConfigPath = this.getProfileConfigPath();
      let profileConfig: Partial<AppConfig> = {};
      
      // Try to load existing profile config
      try {
        const configData = await fs.readFile(profileConfigPath, 'utf8');
        profileConfig = JSON.parse(configData);
      } catch (error) {
        // No existing config, start fresh
      }
      
      // Update with new values
      profileConfig = { ...profileConfig, ...updates };
      
      // Remove undefined values
      Object.keys(profileConfig).forEach(key => {
        if (profileConfig[key as keyof AppConfig] === undefined) {
          delete profileConfig[key as keyof AppConfig];
        }
      });
      
      // Save updated config
      await fs.writeFile(profileConfigPath, JSON.stringify(profileConfig, null, 2));
    } catch (error) {
      console.error('Failed to save profile config:', error);
      throw error;
    }
  }
}

export const configManager = new ConfigManager();