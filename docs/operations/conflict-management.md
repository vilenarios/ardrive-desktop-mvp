# ArDrive Desktop - Robust Conflict Management Design

## Core Principles
1. **User Always in Control** - No automatic uploads without explicit approval
2. **Token Protection** - Clear cost estimation and confirmation before uploads
3. **Conflict Transparency** - Show users exactly what conflicts exist and options to resolve them
4. **Non-Destructive** - Never overwrite/delete without user consent

## 1. Pre-Upload Review System

### Upload Queue UI
```
┌─────────────────────────────────────────────────────────────┐
│ 📤 Pending Uploads (3 files)                    Estimated: 0.25 AR │
├─────────────────────────────────────────────────────────────┤
│ ✅ document.pdf          2.5MB    New file       0.08 AR    │
│ ⚠️  image.jpg           1.2MB    Conflict detected 0.04 AR    │
│ ✅ presentation.pptx    5.1MB    New file       0.13 AR    │
├─────────────────────────────────────────────────────────────┤
│ [Review Conflicts] [Upload All ✅] [Upload Selected] [Cancel] │
└─────────────────────────────────────────────────────────────┘
```

### Features:
- **Cost Calculation**: Show AR token cost per file and total
- **User Approval Required**: No uploads without explicit confirmation
- **Batch Operations**: Select multiple files for upload
- **Conflict Highlighting**: Clearly mark files with conflicts

## 2. Intelligent Conflict Detection

### Types of Conflicts:
1. **Content Conflict**: Same filename, different content (local vs remote)
2. **Duplicate Content**: Same content, different filename/location
3. **Timestamp Conflict**: File modified both locally and remotely
4. **Size Mismatch**: Same filename, different file size

### Conflict Resolution Options:
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  Conflict: image.jpg                                      │
├─────────────────────────────────────────────────────────────┤
│ Local:  image.jpg  (1.2MB, modified 2 hours ago)           │
│ Remote: image.jpg  (1.1MB, modified 1 day ago)             │
├─────────────────────────────────────────────────────────────┤
│ Resolution Options:                                         │
│ ○ Keep Local (upload local version)           Cost: 0.04 AR │
│ ○ Use Remote (download remote version)        Cost: Free    │
│ ○ Keep Both (rename local to image_local.jpg) Cost: 0.04 AR │
│ ○ Skip (don't sync this file)                 Cost: Free    │
│                                                             │
│ [Preview Diff] [Apply] [Apply to All Similar] [Skip]       │
└─────────────────────────────────────────────────────────────┘
```

## 3. Smart Duplicate Detection

### Content-Based Hashing:
- Use SHA256 of file content only (not path-dependent)
- Detect moved/renamed files to avoid re-uploads
- Cross-reference with ArDrive transaction history

### Duplicate Handling:
```
┌─────────────────────────────────────────────────────────────┐
│ 🔍 Duplicate Detected                                        │
├─────────────────────────────────────────────────────────────┤
│ File: presentation.pptx (5.1MB)                             │
│ Already exists as: /Documents/old_presentation.pptx         │
│ Uploaded: 3 days ago (TX: abc123...)                       │
├─────────────────────────────────────────────────────────────┤
│ ○ Skip upload (files are identical)           Save: 0.13 AR │
│ ○ Upload anyway (create duplicate)            Cost: 0.13 AR │
│ ○ Link to existing file (don't upload)       Cost: Free    │
│                                                             │
│ [Apply] [View Original] [Skip]                              │
└─────────────────────────────────────────────────────────────┘
```

## 4. Selective Sync Controls

### Sync Configuration UI:
```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️  Sync Settings                                            │
├─────────────────────────────────────────────────────────────┤
│ Sync Mode:                                                  │
│ ○ Manual (review all changes)                               │
│ ○ Semi-automatic (auto-sync new files, review conflicts)    │
│ ○ Automatic (sync everything, use default conflict rules)   │
│                                                             │
│ File Filters:                                               │
│ ✅ Include: *.pdf, *.doc*, *.jpg, *.png                     │
│ ❌ Exclude: *.tmp, *.cache, .DS_Store, thumbs.db           │
│                                                             │
│ Size Limits:                                                │
│ Max file size: [100] MB                                     │
│ Max daily upload: [1] AR tokens                            │
│                                                             │
│ [Save Settings] [Reset to Defaults]                        │
└─────────────────────────────────────────────────────────────┘
```

## 5. Cost Protection Features

### Upload Confirmation:
```
┌─────────────────────────────────────────────────────────────┐
│ 💰 Upload Confirmation                                       │
├─────────────────────────────────────────────────────────────┤
│ You're about to upload 5 files (12.3MB total)              │
│                                                             │
│ Estimated Cost: 0.35 AR (~$8.75 USD)                       │
│ Your Balance: 2.14 AR                                      │
│ Remaining After: 1.79 AR                                   │
│                                                             │
│ Today's Usage: 0.12 AR / 1.00 AR daily limit              │
│                                                             │
│ ⚠️  This upload will use 16% of your daily limit            │
│                                                             │
│ [Confirm Upload] [Review Files] [Cancel]                   │
└─────────────────────────────────────────────────────────────┘
```

## 6. Enhanced User Experience

### Sync Status Dashboard:
```
┌─────────────────────────────────────────────────────────────┐
│ 🔄 Sync Status                            [⏸️ Pause] [⚙️ Settings] │
├─────────────────────────────────────────────────────────────┤
│ Status: ⚠️ 3 conflicts need review                          │
│                                                             │
│ Queue:                                                      │
│ • 2 files ready to upload (0.15 AR)                        │
│ • 3 conflicts pending review                               │
│ • 1 file downloading...                                     │
│                                                             │
│ Recent Activity:                                            │
│ • ✅ photo.jpg uploaded (2 min ago)                         │
│ • ⬇️  document.pdf downloaded (5 min ago)                   │
│ • ⚠️  video.mp4 conflict detected (10 min ago)              │
│                                                             │
│ [Review Conflicts] [View Queue] [Pause All]                │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Priority

### Phase 1: Basic Protection
1. Pre-upload review queue
2. Cost estimation and confirmation
3. Manual upload approval

### Phase 2: Conflict Management
1. Conflict detection system
2. Resolution options UI
3. Smart duplicate detection

### Phase 3: Advanced Features
1. Selective sync controls
2. Spending limits
3. Advanced filtering

## Technical Architecture

### New Components Needed:
1. `ConflictResolver` - Handles conflict detection and resolution
2. `UploadQueue` - Manages pending uploads with user approval
3. `CostCalculator` - Estimates AR token costs
4. `SyncPolicy` - User-defined sync rules and filters
5. `ConflictUI` - React components for conflict resolution

### Database Schema Updates:
```sql
-- Track user decisions for conflicts
CREATE TABLE conflict_resolutions (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  conflict_type TEXT,
  resolution TEXT,
  created_at DATETIME
);

-- Upload approval queue
CREATE TABLE upload_queue (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  estimated_cost REAL,
  status TEXT, -- pending, approved, rejected
  created_at DATETIME
);
```

This design puts users in complete control while protecting their AR tokens and providing clear conflict resolution options.