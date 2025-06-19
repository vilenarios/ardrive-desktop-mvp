# ArDrive Desktop MVP - Quick Start

## Fast Track to Testing (5 minutes)

### 1. Prerequisites
- Have an Arweave wallet JSON file ready
- Ensure wallet has some AR tokens (even 0.001 AR is enough for testing)
- Prepare 1-2 small test files

### 2. Setup Commands
```bash
# Install dependencies
npm install

# Validate build setup
npm run test:build

# Check for TypeScript errors
npm run typecheck

# Build the app
npm run build
```

### 3. Start Development Mode
```bash
# Terminal 1: Start webpack dev server
npm run dev

# Terminal 2: Start Electron app  
npm start
```

### 4. Quick Smoke Test Flow (Streamlined 3-Step Process)

1. **Import Wallet** (30 seconds)
   - Choose "Import Existing Wallet"
   - Select wallet JSON or enter seed phrase
   - Set password → Click "Continue"

2. **Drive & Sync Setup** (30 seconds) 
   - Enter drive name "Test Drive MVP"
   - Click "Choose Folder" → select test folder
   - Review cost estimate → Click "Complete Setup"

3. **Verify Upload** (2-3 minutes)
   - Dashboard opens with sync active
   - Watch progress bars on uploads
   - Search for files using new search bar
   - Click file → Copy transaction ID
   - Visit: `https://arweave.net/[TX-ID]`

### 5. Success Indicators

✅ **App launches without errors**  
✅ **Wallet imports successfully**  
✅ **Drive creation works**  
✅ **Files upload and get transaction IDs**  
✅ **Files are accessible on arweave.net**

### 6. If Something Goes Wrong

**Build Errors:**
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

**App Won't Start:**
- Check both terminals for error messages
- Ensure ports 3000 is available
- Try restarting both terminals

**Wallet Import Fails:**
- Verify wallet JSON is valid Arweave format
- Check wallet has AR balance
- Try a different password

**Upload Fails:**
- Check internet connection
- Verify wallet has sufficient AR balance
- Try smaller files first

### 7. Production Build Test (Optional)
```bash
# Build for production
npm run build

# Create distributable
npm run dist
```

## Expected Test Results

- **Build time**: ~30-60 seconds
- **First upload**: 1-3 minutes (depending on file size and network)
- **Subsequent uploads**: 30 seconds - 2 minutes
- **Memory usage**: ~100-200MB
- **CPU usage**: Low when idle, moderate during uploads

## Development Notes

- React hot reload works in development mode
- SQLite database stored in user data directory
- Wallet encrypted with AES and stored in system keychain
- Upload progress tracked in local database
- ArDrive metadata cached for performance