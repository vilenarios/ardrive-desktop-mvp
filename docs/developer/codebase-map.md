# Codebase Map

## Critical Files by Feature

### Wallet Management
- `src/main/wallet-manager-secure.ts` - Main wallet operations (USE THIS)
- `src/main/crypto-utils.ts` - Encryption/decryption utilities
- `src/renderer/components/WalletSetup.tsx` - Wallet setup UI (5 steps)

### Drive Operations
- `src/main/main.ts` - IPC handlers for drive operations (search: "drive:")
- `src/renderer/components/WalletSetup.tsx` - Drive selection (Step 4)
- `src/renderer/components/DriveAndSyncSetup.tsx` - New user drive creation

### File Sync
- `src/main/sync-manager.ts` - Core sync logic
- `src/main/file-monitor.ts` - File watching
- `src/main/upload-manager.ts` - Upload queue management
- `src/renderer/components/UploadApprovalQueue.tsx` - Upload approval UI

### Profile Management
- `src/main/profile-manager.ts` - Multi-profile support
- `src/main/config-manager.ts` - Per-profile configuration
- `src/renderer/components/ProfileSwitcher.tsx` - Profile switching UI

### Database
- `src/main/database-manager.ts` - SQLite operations
- Database schema defined in `initDatabase()` method

### UI Components
- `src/renderer/App.tsx` - Main app router and state
- `src/renderer/components/Dashboard.tsx` - Main dashboard
- `src/renderer/components/WalletSetup.tsx` - Onboarding flow
- `src/renderer/styles/` - CSS styles

### IPC Communication
- `src/preload.ts` - API bridge definition
- `src/main/main.ts` - IPC handler implementations
- Search for `ipcMain.handle` to find all handlers

## Key Patterns

### Adding New IPC Handler
1. Add handler in `main.ts`:
```typescript
ipcMain.handle('module:action', async (event, ...args) => {
  return await someManager.doAction(...args);
});
```

2. Add to preload.ts:
```typescript
module: {
  action: (...args: any[]) => ipcRenderer.invoke('module:action', ...args),
}
```

3. Use in renderer:
```typescript
const result = await window.electronAPI.module.action();
```

### Component Structure
```typescript
// Standard functional component pattern
const ComponentName: React.FC<Props> = ({ prop1, prop2 }) => {
  const [state, setState] = useState(initialValue);
  
  useEffect(() => {
    // Side effects
  }, [dependencies]);
  
  return <div>...</div>;
};
```

### Error Handling Pattern
```typescript
try {
  // Operation
} catch (error) {
  console.error('Context-specific message:', error);
  // User-friendly error handling
  throw new Error('User-friendly message');
}
```

## Important Constants
- Sync check interval: 60 seconds
- Upload chunk size: Defined in upload-manager
- Encryption: AES-256-GCM
- Database: SQLite with better-sqlite3

## State Flow
1. User action in renderer
2. IPC call to main process
3. Manager handles business logic
4. Database/filesystem updates
5. Response back to renderer
6. UI updates

## Security Notes
- Wallets encrypted with AES-256-GCM
- Passwords never stored on disk
- Profile isolation for multi-user
- Secure IPC through contextBridge