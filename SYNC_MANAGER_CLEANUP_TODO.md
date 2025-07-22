# Sync Manager Cleanup TODO

## Overview
Phase 1-3 of the sync manager refactor has been completed successfully. All functionality has been extracted to utility classes, but the old code remains in sync-manager.ts and needs to be removed.

## Code Successfully Replaced

### 1. Properties to Remove (Lines ~32-36)
- `private isDownloading` - replaced by DownloadManager
- `private fileProcessingQueue` - replaced by FileStateManager
- `private processingFiles` - replaced by FileStateManager
- `private recentlyDownloadedFiles` - replaced by FileStateManager
- `private downloadingFiles` - replaced by FileStateManager
- `private uploadQueue` - replaced by UploadQueueManager

### 2. Methods to Remove

#### Upload Queue Management (COMPLETED - Line 1543)
- ✅ `processUploadQueue()` - replaced by UploadQueueManager
- ✅ `sortUploadsForProcessing()` - replaced by UploadQueueManager

#### Download Operations (Lines ~2131-2450)
- `syncDriveMetadata()` - replaced by DownloadManager.syncDriveMetadata()
- `recursivelyListDriveContents()` - replaced by DownloadManager
- `downloadMissingFiles()` - replaced by DownloadManager.downloadMissingFiles()
- `createAllFolders()` - replaced by DownloadManager.createAllFolders()
- `downloadMissingFilesWithProgress()` - replaced by DownloadManager.downloadMissingFilesWithProgress()
- `verifySyncState()` - replaced by DownloadManager.verifySyncState()

#### File Download Methods (Lines ~700-1000)
- `downloadFile()` - replaced by DownloadManager
- `performFileDownload()` - replaced by DownloadManager
- `downloadExistingDriveFiles()` - replaced by DownloadManager

#### Cost Calculation (Inline in handleNewFile ~1456)
- Cost calculation logic - replaced by CostCalculator.calculateUploadCosts()
- Turbo free check - replaced by CostCalculator.isFreeWithTurbo()
- File size check - replaced by CostCalculator.isFileTooBig()

## Safe Removal Strategy

1. **Test First**: Run the application to ensure all functionality works with the new utilities
2. **Comment Out**: Comment out each old method with a note about its replacement
3. **Test Again**: Verify nothing breaks
4. **Remove**: Delete the commented code in a final pass

## Verification Checklist

Before removing old code, verify:
- [ ] File uploads work correctly
- [ ] File downloads work correctly
- [ ] Cost calculations display properly
- [ ] Upload queue processes in correct order
- [ ] File state tracking prevents duplicate processing
- [ ] Progress tracking works for all operations

## New Architecture

The sync-manager.ts now delegates to:
- `SyncProgressTracker` - Progress event emission
- `FileStateManager` - File processing state tracking
- `CostCalculator` - Upload cost calculations
- `UploadQueueManager` - Upload queue processing
- `DownloadManager` - All download operations

## Benefits Achieved

1. **Reduced Complexity**: From 2,600 lines to manageable components
2. **Single Responsibility**: Each utility has one clear purpose
3. **Testability**: Each component can be tested in isolation
4. **Maintainability**: Changes to uploads/downloads are localized
5. **Reusability**: Utilities can be used elsewhere if needed

## Next Steps

1. Complete Phase 4-6 of the refactor plan
2. Add comprehensive tests for each utility
3. Remove old code once all phases are complete
4. Update documentation to reflect new architecture