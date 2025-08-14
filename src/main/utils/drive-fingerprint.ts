import * as crypto from 'crypto';

/**
 * Generate a deterministic emoji fingerprint for a drive ID
 * This helps users identify private drives without showing the actual drive name
 */
export function getDriveEmojiFingerprint(driveId: string): string {
  // Curated ArDrive-themed emoji set for professional yet friendly appearance
  const ardriveEmojis = [
    // Storage & Tech
    '💾', '📀', '💿', '🗄️', '📁', '📂', '🗂️', '💼',
    // Gems & Permanence (represents Arweave's permanent storage)
    '💎', '💠', '🔷', '🔶', '⭐', '✨', '🌟', '💫',
    // Nature (permanence/growth theme)
    '🌲', '🌳', '🌴', '🌵', '🌿', '🍃', '🌺', '🌸',
    // Elements (building blocks)
    '🔥', '💧', '⚡', '🌊', '🌪️', '☀️', '🌙', '☁️',
    // Creatures (memorable)
    '🦅', '🦉', '🐢', '🐘', '🦏', '🐉', '🦋', '🐝',
    // Security & Tools
    '🔒', '🔐', '🗝️', '🛡️', '⚔️', '🔨', '⚒️', '🧲',
    // Transport (data movement)
    '🚀', '✈️', '🛸', '🚁', '⛵', '🎈', '🪂', '🛰️',
    // Cosmic (permanent like space)
    '🌌', '🪐', '☄️', '🌠', '🌃', '🌅', '🌇', '🌆'
  ];

  // Create SHA-256 hash of the drive ID for deterministic selection
  const hash = crypto.createHash('sha256').update(driveId).digest();
  
  // Use first 3 bytes to select 3 emojis
  const emoji1 = ardriveEmojis[hash[0] % ardriveEmojis.length];
  const emoji2 = ardriveEmojis[hash[1] % ardriveEmojis.length];
  const emoji3 = ardriveEmojis[hash[2] % ardriveEmojis.length];
  
  return `${emoji1}${emoji2}${emoji3}`;
}

/**
 * Get a short preview of the drive ID for display purposes
 */
export function getDriveIdPreview(driveId: string): string {
  return `${driveId.slice(0, 8)}...${driveId.slice(-4)}`;
}