import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import * as crypto from 'crypto-js';
import { randomUUID } from 'crypto';
import { arnsService } from './arns-service';

export interface Profile {
  id: string;
  name: string;
  address: string;
  avatarUrl?: string;
  arnsName?: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface ProfilesConfig {
  profiles: Profile[];
  activeProfileId: string | null;
}

class ProfileManager {
  private profilesDir: string;
  private profilesConfigPath: string;
  private profilesConfig: ProfilesConfig | null = null;

  constructor() {
    const userData = app.getPath('userData');
    this.profilesDir = path.join(userData, 'profiles');
    this.profilesConfigPath = path.join(userData, 'profiles.json');
  }

  async initialize(): Promise<void> {
    // Ensure profiles directory exists
    await fs.mkdir(this.profilesDir, { recursive: true });
    
    // Load or create profiles config
    try {
      const configData = await fs.readFile(this.profilesConfigPath, 'utf8');
      this.profilesConfig = JSON.parse(configData);
    } catch (error) {
      // Create default config if it doesn't exist
      this.profilesConfig = {
        profiles: [],
        activeProfileId: null
      };
      await this.saveConfig();
    }
  }

  private async saveConfig(): Promise<void> {
    if (!this.profilesConfig) return;
    
    await fs.writeFile(
      this.profilesConfigPath, 
      JSON.stringify(this.profilesConfig, null, 2)
    );
  }

  async createProfile(name: string, address: string): Promise<Profile> {
    if (!this.profilesConfig) await this.initialize();

    // Check if profile with this address already exists
    const existingProfile = this.profilesConfig!.profiles.find(p => p.address === address);
    if (existingProfile) {
      throw new Error('A profile with this wallet address already exists');
    }

    const profile: Profile = {
      id: randomUUID(),
      name,
      address,
      createdAt: new Date(),
      lastUsedAt: new Date()
    };

    // Create profile directory
    const profileDir = path.join(this.profilesDir, profile.id);
    await fs.mkdir(profileDir, { recursive: true });

    // Add to config and save
    this.profilesConfig!.profiles.push(profile);
    await this.saveConfig();

    return profile;
  }

  private async enrichProfileWithArNS(profile: Profile): Promise<Profile> {
    try {
      // Skip if ArNS data is recent (less than 24 hours old)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (profile.arnsName && profile.lastUsedAt > twentyFourHoursAgo) {
        return profile;
      }

      const arnsData = await arnsService.getArNSProfile(profile.address);
      
      if (arnsData.name || arnsData.avatar) {
        const enrichedProfile = {
          ...profile,
          arnsName: arnsData.name || profile.arnsName,
          avatarUrl: arnsData.avatar || profile.avatarUrl
        };
        
        // Update the stored profile with new ArNS data
        const profileIndex = this.profilesConfig!.profiles.findIndex(p => p.id === profile.id);
        if (profileIndex !== -1) {
          this.profilesConfig!.profiles[profileIndex] = enrichedProfile;
          await this.saveConfig();
        }
        
        return enrichedProfile;
      }
    } catch (error) {
      console.error('Failed to enrich profile with ArNS data:', error);
    }
    
    return profile;
  }

  async getProfiles(): Promise<Profile[]> {
    if (!this.profilesConfig) await this.initialize();
    
    // Return profiles immediately without waiting for ArNS enrichment
    const profiles = [...this.profilesConfig!.profiles];
    
    // Enrich profiles with ArNS data asynchronously (non-blocking)
    profiles.forEach(profile => {
      this.enrichProfileWithArNS(profile).catch(error => {
        console.error(`Failed to enrich profile ${profile.id}:`, error);
      });
    });
    
    return profiles;
  }

  async getActiveProfile(): Promise<Profile | null> {
    if (!this.profilesConfig) await this.initialize();
    
    if (!this.profilesConfig!.activeProfileId) return null;
    
    const profile = this.profilesConfig!.profiles.find(
      p => p.id === this.profilesConfig!.activeProfileId
    );
    
    if (!profile) return null;
    
    // Try to enrich with ArNS data before returning
    try {
      const enrichedProfile = await this.enrichProfileWithArNS(profile);
      return enrichedProfile;
    } catch (error) {
      console.error(`Failed to enrich active profile:`, error);
      return profile; // Return original profile if enrichment fails
    }
  }

  async setActiveProfile(profileId: string): Promise<void> {
    if (!this.profilesConfig) await this.initialize();
    
    const profile = this.profilesConfig!.profiles.find(p => p.id === profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    // Update last used timestamp
    profile.lastUsedAt = new Date();
    
    this.profilesConfig!.activeProfileId = profileId;
    await this.saveConfig();
  }

  async updateProfile(profileId: string, updates: Partial<Profile>): Promise<void> {
    if (!this.profilesConfig) await this.initialize();
    
    const profileIndex = this.profilesConfig!.profiles.findIndex(p => p.id === profileId);
    if (profileIndex === -1) {
      throw new Error('Profile not found');
    }

    // Update profile
    this.profilesConfig!.profiles[profileIndex] = {
      ...this.profilesConfig!.profiles[profileIndex],
      ...updates,
      id: profileId // Ensure ID can't be changed
    };

    await this.saveConfig();
  }

  async deleteProfile(profileId: string): Promise<void> {
    if (!this.profilesConfig) await this.initialize();
    
    const profileIndex = this.profilesConfig!.profiles.findIndex(p => p.id === profileId);
    if (profileIndex === -1) {
      throw new Error('Profile not found');
    }

    // IMPORTANT: Close database connection before deleting profile directory
    // This prevents EBUSY errors on Windows when trying to delete the database file
    const { databaseManager } = await import('./database-manager');
    if (databaseManager.isProfileActive(profileId)) {
      console.log(`[ProfileManager] Closing database connection for profile ${profileId} before deletion`);
      await databaseManager.close();
    }

    // Delete profile directory
    const profileDir = path.join(this.profilesDir, profileId);
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to delete profile directory:', error);
    }

    // Remove from config
    this.profilesConfig!.profiles.splice(profileIndex, 1);
    
    // If this was the active profile, clear it
    if (this.profilesConfig!.activeProfileId === profileId) {
      this.profilesConfig!.activeProfileId = null;
    }

    await this.saveConfig();
  }

  getProfileStoragePath(profileId: string, filename: string): string {
    return path.join(this.profilesDir, profileId, filename);
  }

  getProfilePath(profileId: string): string {
    return path.join(this.profilesDir, profileId);
  }

  async getProfileByAddress(address: string): Promise<Profile | null> {
    if (!this.profilesConfig) await this.initialize();
    
    return this.profilesConfig!.profiles.find(p => p.address === address) || null;
  }

  async hasProfiles(): Promise<boolean> {
    if (!this.profilesConfig) await this.initialize();
    return this.profilesConfig!.profiles.length > 0;
  }
}

export const profileManager = new ProfileManager();