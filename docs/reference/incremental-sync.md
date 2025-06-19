# Incremental Sync Implementation Guide

## The Problem

The current sync implementation has a critical issue for large drives:
- Uses `arDrive.downloadPublicFolder()` which downloads ALL files every sync
- No way to query only changed files from ardrive-core-js
- Large drives (1000+ files) will re-download everything each time

## ardrive-core-js Limitations

After thorough analysis, ardrive-core-js does NOT support:
- ❌ `getModifiedFilesSince(date)` - No such method exists
- ❌ Date filtering in `listPublicFolder()` - Returns all files
- ❌ Incremental sync APIs - Must implement client-side
- ❌ Change notifications - No webhooks or events

What it DOES provide:
- ✅ `listPublicFolder()` - Returns all files with metadata
- ✅ `lastModifiedDate` - Available on each file
- ✅ Individual file download - Can selectively download

## Solution: IncrementalSyncEngine

The new `IncrementalSyncEngine` implements true incremental sync by:

### 1. **Building File Indexes**
```typescript
// Remote index: All files in ArDrive with metadata
const remoteFiles = await this.buildRemoteFileIndex();

// Local index: All files on disk with hashes
const localFiles = await this.buildLocalFileIndex();
```

### 2. **Smart Comparison**
- Compare file sizes first (fast)
- Check local hash database
- Only download if truly different
- Track last sync time

### 3. **Aggressive Caching**
- 30-minute cache for stable content
- Cache folder structure
- Cache file metadata
- Reuse cache across syncs

### 4. **Batch Processing**
- Download in batches of 50
- Parallel downloads (max 5)
- Progress tracking

## Performance Comparison

### Current Implementation (sync-manager.ts)
```typescript
// Downloads EVERYTHING every time!
await this.arDrive.downloadPublicFolder({
  folderId: EID(this.rootFolderId),
  destFolderPath: this.syncFolderPath,
  maxDepth: 10
});
```

**For 1000 file drive:**
- First sync: Downloads 1000 files ✅
- Second sync: Downloads 1000 files again! ❌
- Network usage: Massive
- Time: Very slow

### New Implementation (incremental-sync-engine.ts)
```typescript
// Only downloads changed files
const stats = await incrementalSync.performIncrementalSync();
// Result: { filesChecked: 1000, filesDownloaded: 5, filesSkipped: 995 }
```

**For 1000 file drive:**
- First sync: Downloads 1000 files ✅
- Second sync: Downloads only changed files ✅
- Network usage: Minimal
- Time: Fast (mostly cache hits)

## Implementation Steps

### 1. Add Database Table for Sync State
```sql
CREATE TABLE IF NOT EXISTS drive_sync_state (
  drive_id TEXT PRIMARY KEY,
  last_sync_time TEXT,
  last_full_scan TEXT,
  total_files INTEGER,
  sync_version INTEGER DEFAULT 1
);
```

### 2. Replace Download Logic in sync-engine.ts
```typescript
// OLD - Don't do this!
private async downloadExistingDriveFiles() {
  await this.arDrive.downloadPublicFolder(...); // Downloads everything
}

// NEW - Do this instead!
private async downloadExistingDriveFiles() {
  const syncEngine = new IncrementalSyncEngine(
    this.arDrive,
    this.databaseManager,
    this.driveId,
    this.rootFolderId,
    this.syncFolderPath
  );
  
  const stats = await syncEngine.performIncrementalSync();
  console.log('Sync stats:', stats);
}
```

### 3. Update Multi-Drive Sync Manager
```typescript
// Use incremental sync for all drives
for (const engine of this.syncEngines.values()) {
  if (engine instanceof IncrementalSyncEngine) {
    await engine.performIncrementalSync();
  }
}
```

## Configuration for Large Drives

### Recommended Settings
```typescript
const config = {
  // Longer cache for stable content
  CACHE_TTL: 3600, // 1 hour for large, stable drives
  
  // Larger batches for better throughput
  BATCH_SIZE: 100,
  
  // More parallel downloads
  MAX_PARALLEL: 10,
  
  // Skip unchanged files
  skipExistingFiles: true,
  
  // Enable all optimizations
  deduplicationEnabled: true,
  incrementalSync: true
};
```

### Memory Optimization
- Stream-based hashing (no full file load)
- Batch processing (limited memory use)
- Cache eviction for old entries

## Monitoring & Debugging

### Sync Statistics
```typescript
interface SyncStats {
  filesChecked: number;      // Total files examined
  filesDownloaded: number;   // New/changed files downloaded
  filesSkipped: number;      // Unchanged files skipped
  filesUploaded: number;     // Local files uploaded
  errors: number;           // Failed operations
  startTime: Date;
  endTime?: Date;
}
```

### Debug Output
```
Starting incremental sync...
Last sync: 2024-01-15T10:30:00Z
Using cached remote file index
Found 1000 remote files
Found 1000 local files
Comparing files...
New remote file: documents/report.pdf
File needs update: images/photo.jpg
Downloading batch of 2 files...
Sync completed in 5.2s: {
  filesChecked: 1000,
  filesDownloaded: 2,
  filesSkipped: 998,
  filesUploaded: 0,
  errors: 0
}
```

## Future Enhancements

### 1. **Smart Sync Scheduling**
- Daily full scan for large drives
- Frequent incremental syncs
- Off-peak scheduling

### 2. **Selective Sync**
- Allow folder exclusions
- File type filters
- Size-based rules

### 3. **Conflict Resolution**
- Handle concurrent edits
- Version tracking
- User prompts for conflicts

### 4. **Performance Metrics**
- Track sync performance
- Identify slow operations
- Optimize based on usage

## Migration Checklist

- [ ] Add drive_sync_state table
- [ ] Implement IncrementalSyncEngine
- [ ] Update sync-engine.ts to use incremental sync
- [ ] Test with large drive (1000+ files)
- [ ] Monitor performance improvements
- [ ] Update documentation