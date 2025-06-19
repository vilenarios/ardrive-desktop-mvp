# ArDrive Desktop

A secure, multi-profile desktop application for syncing files to the Arweave permanent storage network.

> **For AI Assistants**: See [CLAUDE.md](./CLAUDE.md) for detailed development guidance and codebase overview.

## 📚 Documentation

- **[User Documentation](./docs/user/)**
  - [Getting Started](./docs/user/getting-started.md)
  - [User Guide](./docs/user/user-guide.md)
  - [Troubleshooting](./docs/user/troubleshooting.md)
  
- **[Developer Documentation](./docs/developer/)**
  - [Developer Setup](./docs/developer/setup.md)
  - [Architecture](./docs/developer/architecture.md)
  - [Development Guide](./docs/developer/development.md)
  - [Building & Packaging](./docs/developer/building/)
  
- **[API & SDK Docs](./docs/api/)**
  - [API Reference](./docs/api/api-reference.md)
  - [SDK Documentation](./docs/api/sdk/)
  
- **[Testing](./docs/testing/)**
  - [Testing Guide](./docs/testing/testing-guide.md)
  - [QA Test Plan](./docs/testing/qa-test-plan.md)
  
- **[Other Documentation](./docs/)**
  - [Operations](./docs/operations/) - Security, Performance, etc.
  - [Reference](./docs/reference/) - Features, Specifications
  - [Releases](./docs/releases/) - Changelog, Release Notes

![ArDrive Desktop](assets/ArDrive-Logo-Wordmark-Dark.png)

## 🚀 Features

### 🔐 **Multi-Wallet Support**
- Support for multiple user profiles
- Easy profile switching with dedicated UI
- Each profile has isolated storage and settings
- Quick profile switcher in the navigation bar
- ArNS name and avatar integration

### 🛡️ **Bank-Level Security**
- **AES-256-GCM** encryption for wallet storage
- **Scrypt** key derivation (N=16384) for password protection
- No passwords stored on disk - enhanced security
- Secure file deletion with multi-pass overwriting
- Authenticated encryption to detect tampering
- Complete profile isolation between users

### 💼 **Wallet Management**
- Import Arweave wallets via JSON file or 12-word seed phrase
- Ethereum wallet support (prepared for future integration)
- Secure wallet storage per profile
- ArNS Primary Name integration for personalized profiles
- Real-time AR and Turbo Credits balance display

### ⚡ **Dual Upload System**
- **Turbo Credits**: Instant uploads with immediate confirmation
- **Traditional AR**: Direct Arweave uploads with network confirmation
- **Smart Recommendations**: AI-powered suggestions for optimal upload method
- **Cost Comparison**: Side-by-side pricing for informed decisions
- **Upload Approval Queue**: Review and approve uploads before spending

### 📁 **Smart File Sync**
- Automatic folder monitoring and upload
- Bidirectional sync with existing ArDrive files
- Hash-based duplicate file detection
- Support for all file types with appropriate icons
- Real-time sync status monitoring
- 100MB file size limit (temporary MVP restriction)

### 💰 **Advanced Cost Control**
- **Dual Balance Display**: Monitor both AR tokens and Turbo Credits
- **Real-time Cost Estimation**: Live pricing for both upload methods
- **Method Selection**: Choose upload method per file
- **Batch Operations**: Approve or reject multiple uploads at once
- **Turbo Credits Management**: Top up with fiat or convert AR tokens

### 🎨 **Modern User Interface**
- Clean, intuitive design with ArDrive branding
- File type icons and activity tracking
- Detailed file metadata viewer with copy buttons
- System tray integration for background operation
- Profile avatars and personalization
- Responsive layout with smooth animations
- **NEW**: Toast notifications for instant feedback
- **NEW**: Visual progress bars for uploads/downloads
- **NEW**: Searchable file activity with filters
- **NEW**: Remember Me for quick access

## 🏁 Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **ArDrive Wallet** (.json file or 12-word seed phrase)
- **Operating System**: Windows, macOS, or Linux

### Development Setup

1. **Clone and Install**
   ```bash
   git clone https://github.com/ardriveapp/ardrive-desktop.git
   cd ardrive-desktop-mvp
   npm install
   ```

2. **Run Development Mode**
   ```bash
   npm run dev
   ```
   This starts both the React dev server and Electron app

3. **Build for Production**
   ```bash
   npm run build        # Compile TypeScript and bundle
   npm run dist         # Create distributable app
   ```

### Available Scripts
- `npm run dev` - Start development with hot reload
- `npm run build` - Build main and renderer processes
- `npm run typecheck` - Run TypeScript type checking
- `npm start` - Start Electron app (requires build first)
- `npm run dist` - Create platform-specific distributables

## 📖 User Guide

### First-Time Setup (Streamlined 3-Step Process)

1. **Welcome & Wallet Setup**
   - Choose between importing existing wallet or creating new
   - **Import Options**: 
     - Wallet JSON file with drag-and-drop
     - 12-word seed phrase with secure masking
   - **Create New**: Generates secure seed phrase
   - Set a strong password for encryption

2. **Drive & Sync Setup (Combined)**
   - Create your first drive with custom name
   - Select sync folder in the same screen
   - View Arweave explanation and cost estimates
   - Everything configured in one intuitive step

3. **Start Using ArDrive**
   - Dashboard opens with sync already active
   - See real-time upload progress
   - Manage files immediately

### Profile Management

ArDrive Desktop supports multiple user profiles:

**Benefits:**
- Manage multiple wallets on one computer
- Separate personal and work files
- Family members can share a device
- Complete isolation between profiles

**Managing Profiles:**
1. Click the profile switcher in the top navigation
2. View all profiles with last-used timestamps
3. Switch profiles instantly with inline password prompt
4. Add new profiles with different wallets
5. Each profile maintains separate drives and settings
6. **NEW**: Remember Me option for quick access
7. **NEW**: No page reload needed when switching

### Daily Usage

**Dashboard Overview:**
- **Top Navigation**: Profile switcher, balances, settings, logout
- **Drive Header**: Current drive name and privacy status
- **Sync Status**: Real-time monitoring with start/stop controls
- **File Activity**: 
  - Tabbed view of uploads and downloads
  - **NEW**: Search files by name
  - **NEW**: Filter by status (completed, pending, failed)
  - **NEW**: Visual progress bars for active transfers
- **Statistics**: Total files, uploaded, and failed counts

**Upload Process:**
1. Add files to your sync folder
2. Files appear in the upload approval queue
3. Review costs (AR vs Turbo Credits)
4. Select upload method for each file
5. Approve uploads individually or in batch
6. Monitor progress in the activity panel

**Turbo Credits Features:**
- Instant file availability after upload
- Purchase credits with credit/debit card
- Convert AR tokens to Turbo Credits
- Automatic recommendations based on file size
- Progress tracking for all uploads

**File Sharing:**
- Click any uploaded file to view details
- Copy direct Arweave links for sharing
- Access files through ArDrive web app
- One-click copy for all IDs and links

### Security Best Practices

1. **Password Security**
   - Use a unique, strong password for each profile
   - Passwords are never stored on disk
   - Required when switching profiles

2. **Wallet Security**
   - Never share your wallet file or seed phrase
   - Each profile's wallet is encrypted separately
   - Wallets are isolated between profiles

3. **System Security**
   - Keep your operating system updated
   - Enable full-disk encryption
   - Use antivirus software

## 🏗️ Architecture

### Security Architecture
- **Encryption**: AES-256-GCM with authenticated encryption
- **Key Derivation**: Scrypt (N=16384, r=8, p=1)
- **Profile Isolation**: Separate directories per profile
- **Memory Security**: Sensitive data cleared after use

### Main Process (`src/main/`)
- **crypto-utils.ts**: Secure encryption utilities
- **profile-manager.ts**: Multi-profile support
- **wallet-manager-secure.ts**: Secure wallet operations
- **sync-manager.ts**: File monitoring and uploads
- **turbo-manager.ts**: Turbo Credits integration
- **arns-service.ts**: ArNS name resolution

### Renderer Process (`src/renderer/`)
- **ProfileSelection.tsx**: Profile selection screen
- **ProfileSwitcher.tsx**: Quick profile switching
- **WalletSetup.tsx**: 4-step wallet import flow
- **Dashboard.tsx**: Main application interface
- **TurboCreditsManager.tsx**: Credits management

### Data Storage
```
userData/
├── profiles/
│   ├── {profile-id}/
│   │   ├── wallet.enc       # Encrypted wallet
│   │   └── config.json      # Profile settings
│   └── profiles.json        # Profile metadata
├── ardrive.db              # SQLite database
└── config.json             # Global settings
```

## 📋 System Requirements

- **Memory**: 4GB RAM minimum, 8GB recommended
- **Storage**: 1GB free space + space for synced files
- **Network**: Stable internet connection
- **Node.js**: Version 18 or higher for development

## 🚧 Current Limitations (MVP)

- **Public Drives Only**: Private drives coming soon
- **100MB File Limit**: Large file support planned
- **Manual Sync Control**: Auto-sync in development
- **Basic Conflict Resolution**: Advanced merge planned

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📚 Documentation

- **[Security Guide](SECURITY.md)** - Detailed security implementation
- **[Development Guide](DEVELOPMENT.md)** - Developer documentation
- **[User Guide](USER-GUIDE.md)** - Complete user manual
- **[API Reference](API.md)** - Technical API documentation

## 📞 Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/ardriveapp/ardrive-desktop/issues)
- **Discord**: [Join our community](https://discord.gg/ya4hf2H)
- **Documentation**: [docs.ardrive.io](https://docs.ardrive.io)
- **Email**: support@ardrive.io

## 📄 License

ArDrive Desktop is released under the [AGPL-3.0 License](LICENSE).

## 🙏 Acknowledgments

Built with ❤️ by the ArDrive Team

Special thanks to:
- The Arweave team for permanent storage infrastructure
- The Electron community for cross-platform support
- AR.IO for the ArNS name system
- All our contributors and beta testers

---

**Stay Connected:**
- Website: [ardrive.io](https://ardrive.io)
- Twitter: [@ardriveapp](https://twitter.com/ardriveapp)
- Blog: [ardrive.io/blog](https://ardrive.io/blog)