# ArDrive Desktop MVP - Smoke Testing Guide

## Prerequisites

1. **Arweave Wallet**: Download a wallet JSON file with some AR tokens
2. **Test Files**: Prepare small test files (images, documents, etc.) under 100MB
3. **Node.js**: Version 18 or higher installed

## 1. Installation and Build Testing

### Install Dependencies
```bash
npm install
```
**Expected**: No errors, all dependencies install successfully

### TypeScript Compilation Test
```bash
npm run typecheck
```
**Expected**: No TypeScript errors

### Build Test
```bash
npm run build
```
**Expected**: 
- `dist/main/` folder created with compiled main process files
- `dist/renderer/` folder created with React app bundle
- No compilation errors

### Development Mode Test
```bash
# Terminal 1: Start development build
npm run dev

# Terminal 2: Start Electron app
npm start
```
**Expected**: 
- Webpack dev server starts on localhost:3000
- Electron app launches and loads the React interface
- Hot reload works when editing React components

## 2. Core Application Flow Testing

### First Run Experience
1. **Launch App**: Start the application
2. **Wallet Import**:
   - Click "Select Wallet File"
   - Choose your Arweave wallet JSON file
   - Enter a secure password (8+ characters)
   - Confirm password
   - Click "Import Wallet"

**Expected Results**:
- Wallet file selection dialog opens
- Password validation works
- Wallet imports successfully
- App navigates to drive selection

### Drive Management
3. **Create Drive**:
   - Enter a drive name (e.g., "Test Drive")
   - Click "Create Drive"

**Expected Results**:
- Drive creation succeeds
- Drive appears in the list
- Can select the new drive

4. **Select Drive**:
   - Click "Select" on your test drive

**Expected Results**:
- App navigates to folder sync setup

### Folder Sync Setup
5. **Select Sync Folder**:
   - Click "Select Folder"
   - Choose a test folder with some files
   - Click "Start Sync"

**Expected Results**:
- Folder selection dialog opens
- Selected folder path displays
- Sync starts successfully
- App navigates to dashboard

### Dashboard and Upload Testing
6. **Monitor Dashboard**:
   - Check wallet info displays correctly
   - Verify selected drive shows up
   - Check sync folder path is correct
   - Observe sync status indicator

**Expected Results**:
- Wallet address and balance display
- Drive name and type show correctly
- Sync folder path is accurate
- Status shows "Active" with green indicator

7. **File Upload Testing**:
   - Add a small test file to your sync folder
   - Watch the dashboard for upload progress

**Expected Results**:
- New file appears in upload list as "pending"
- Status changes to "uploading"
- Progress updates (may be quick for small files)
- Status changes to "completed" with transaction ID
- File count updates in sync status

## 3. Error Handling Testing

### Invalid Wallet Test
8. **Test Invalid Wallet**:
   - Try importing a non-JSON file
   - Try importing an invalid JSON file

**Expected Results**:
- Clear error messages displayed
- App doesn't crash

### Network Error Simulation
9. **Test Offline Behavior**:
   - Disconnect internet
   - Try to create a drive or upload files

**Expected Results**:
- Files queue as "pending" or "failed"
- Error messages are user-friendly
- App remains responsive

### Large File Test
10. **Test File Size Limits**:
    - Add a file larger than 100MB to sync folder

**Expected Results**:
- Large file is skipped (check console logs)
- No error crashes the app

## 4. Database and Persistence Testing

### App Restart Test
11. **Close and Reopen App**:
    - Close the application
    - Restart it

**Expected Results**:
- App remembers wallet (may ask for password)
- Previous drive selection persists
- Sync folder setting persists
- Upload history shows in dashboard

### Database Integrity
12. **Check Upload History**:
    - Upload several files
    - Restart app
    - Check upload history

**Expected Results**:
- All uploads are recorded
- Transaction IDs are preserved
- Upload timestamps are correct

## 5. UI/UX Testing

### Navigation Flow
13. **Test Back Navigation**:
    - Complete full setup flow
    - Test each step transitions properly

**Expected Results**:
- Smooth transitions between setup steps
- No broken states or empty screens

### Responsive Behavior
14. **Test Window Resizing**:
    - Resize application window
    - Test different screen sizes

**Expected Results**:
- UI adapts to different window sizes
- No content gets cut off
- Buttons remain clickable

## 6. Integration Testing

### ArDrive Core Integration
15. **Verify Uploads on Arweave**:
    - Upload a test file
    - Copy the transaction ID from dashboard
    - Visit `https://arweave.net/[transaction-id]`

**Expected Results**:
- File is accessible on Arweave network
- Content matches original file

### Duplicate File Handling
16. **Test Deduplication**:
    - Upload the same file twice
    - Check that duplicate is skipped

**Expected Results**:
- Second upload is skipped
- No duplicate entries in upload history

## Quick Smoke Test Checklist

For rapid testing, run through this minimal flow:

- [ ] App builds without errors (`npm run build`)
- [ ] App starts in development mode (`npm run dev` + `npm start`)
- [ ] Can import a wallet with password
- [ ] Can create a new drive
- [ ] Can select sync folder
- [ ] Can upload a small test file
- [ ] Upload completes with transaction ID
- [ ] App restart preserves settings

## Troubleshooting Common Issues

### Build Errors
- **Missing dependencies**: Run `npm install` again
- **TypeScript errors**: Check `npm run typecheck` output
- **Native module issues**: Rebuild native modules: `npm rebuild`

### Runtime Errors
- **Wallet import fails**: Check wallet JSON format
- **Upload fails**: Verify wallet has AR balance
- **Database errors**: Delete app data and restart fresh

### Platform-Specific Issues
- **Windows**: May need to run as administrator for keytar
- **macOS**: May need to approve app in Security preferences
- **Linux**: Ensure required system libraries are installed

## Expected Test Duration

- **Full smoke test**: 30-45 minutes
- **Quick smoke test**: 10-15 minutes
- **First-time setup**: Add 10 minutes for wallet/file preparation

## Test Environment Cleanup

After testing:
1. Clear uploaded test files from Arweave (they're permanent!)
2. Reset app data: Delete `~/.ardrive/` or app data folder
3. Remove test sync folders if desired