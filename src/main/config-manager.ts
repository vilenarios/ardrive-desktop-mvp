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

  // DESIGN-2: theme preference lives on the global config (device/app-level,
  // not per-profile) so it applies before any profile is active (onboarding).
  async setThemePreference(theme: 'light' | 'dark' | 'system'): Promise<void> {
    this.globalConfig.theme = theme;
    await this.saveGlobalConfig();
  }

  // SYNC-17: the Arweave gateway host lives on the global config (device/app-level,
  // like theme) so it applies before any profile is active — wallet ops during
  // onboarding must be able to reach a non-rate-limited gateway. Returns the raw
  // configured value (may be undefined); the default (turbo-gateway.com) is
  // applied by src/main/gateway.ts, the single resolution point. Synchronous so
  // it can be read from the many synchronous Arweave.init() call sites.
  getGatewayHost(): string | undefined {
    return this.globalConfig.gatewayHost;
  }

  async setGatewayHost(host: string): Promise<void> {
    this.globalConfig.gatewayHost = host;
    await this.saveGlobalConfig();
  }

  // SYNC-23: ordered DATA-fetch fallback gateways (device/app-level global
  // config, like `gatewayHost`). Tried in order AFTER the primary when a
  // by-txid data fetch persistently fails. Returns the raw configured value
  // (may be undefined); the default order (perma.online, arweave.net) is
  // applied by src/main/gateway.ts (getGatewayHosts), the single resolution
  // point. Synchronous so it can be read alongside getGatewayHost(). NOTE: this
  // is for DATA fetches only — metadata/GraphQL must not fail over (see
  // gateway-failover.ts).
  getGatewayFallbacks(): string[] | undefined {
    return this.globalConfig.gatewayFallbacks;
  }

  async setGatewayFallbacks(hosts: string[]): Promise<void> {
    this.globalConfig.gatewayFallbacks = hosts;
    await this.saveGlobalConfig();
  }

  // CORE-10: the GraphQL page size (`first:` argument) ardrive-core-js uses
  // for every paged GraphQL walk (transaction listing, incremental sync,
  // snapshot listing). Device/app-level global config, like `gatewayHost` —
  // applies before any profile is active. Returns the raw configured value
  // (may be undefined); the default (1000, the ar.io gateway max) and the
  // bridge into core-js's OWN setGqlPageSize/getGqlPageSize are handled by
  // src/main/gql-page-size.ts, the single resolution point. Named
  // getConfiguredGqlPageSize/setConfiguredGqlPageSize (not getGqlPageSize/
  // setGqlPageSize) so this never collides with core-js's same-named exports.
  getConfiguredGqlPageSize(): number | undefined {
    return this.globalConfig.gqlPageSize;
  }

  async setConfiguredGqlPageSize(pageSize: number): Promise<void> {
    this.globalConfig.gqlPageSize = pageSize;
    await this.saveGlobalConfig();
  }

  // Legacy clear methods removed - use removeDriveMapping instead

  // Migration removed - legacy fields no longer supported

  async setActiveDrive(driveId: string, mappingId?: string): Promise<void> {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    await this.updateProfileConfig({
      lastActiveDriveId: driveId,
      lastActiveDriveMappingId: mappingId
    });
  }

  async getActiveDrive(): Promise<{ driveId: string; mappingId?: string } | null> {
    const config = await this.getConfig();
    if (config.lastActiveDriveId) {
      return {
        driveId: config.lastActiveDriveId,
        mappingId: config.lastActiveDriveMappingId
      };
    }
    return null;
  }

  async setActiveProfile(profileId: string) {
    this.currentProfileId = profileId;
  }

  // SEC-4: per-profile "remember me on this device" consent. Read straight
  // from the profile config file (no DB round-trip) so it can be consulted on
  // the hot session-credential path. Defaults to false (opt-in) whenever there
  // is no active profile or no config yet — the credential must never be
  // persisted to the keychain without an explicit, recorded opt-in.
  async getKeychainConsent(): Promise<boolean> {
    if (!this.currentProfileId) {
      return false;
    }
    try {
      const profileConfigPath = this.getProfileConfigPath();
      const configData = await fs.readFile(profileConfigPath, 'utf8');
      const profileConfig = JSON.parse(configData);
      return profileConfig.rememberDevice === true;
    } catch (error) {
      return false;
    }
  }

  async setKeychainConsent(consent: boolean): Promise<void> {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    await this.updateProfileConfig({ rememberDevice: consent === true });
  }

  // UX-29: whether native OS desktop notifications are shown. Device/app-level
  // global config (like `theme`/`gatewayHost`) rather than per-profile — the
  // preference is about this device's notification behavior, not the signed-in
  // account, so it applies before any profile is active and survives profile
  // switches. Defaults to true (opt-out): unset means notifications are ON.
  // Synchronous so fire-and-forget notification call sites (sync-manager) can
  // gate a notification without awaiting a config round-trip.
  getNotificationsEnabled(): boolean {
    return this.globalConfig.notificationsEnabled !== false;
  }

  async setNotificationsEnabled(enabled: boolean): Promise<void> {
    this.globalConfig.notificationsEnabled = enabled === true;
    await this.saveGlobalConfig();
  }

  // UX-21/UX-22: per-profile (like `syncFolder`/`walletPath`) — whether the
  // continuous sync engine should be running for the ACTIVE profile. Read via
  // getConfig() (profile config merged over global) rather than an in-memory
  // field like notificationsEnabled, since it must be correct immediately
  // after a profile switch (setActiveProfile only swaps currentProfileId; the
  // actual value lives on disk per profile). Defaults to true (unset means
  // enabled) — profiles set up before this preference existed keep auto-
  // starting. UX-22's pause/resume control (sync:pause/sync:resume in
  // main.ts) writes this SAME flag, so "paused" is honored on the next boot
  // too, not just for the rest of the current session.
  async getAutoSyncEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.autoSyncEnabled !== false;
  }

  async setAutoSyncEnabled(enabled: boolean): Promise<void> {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    await this.updateProfileConfig({ autoSyncEnabled: enabled === true });
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