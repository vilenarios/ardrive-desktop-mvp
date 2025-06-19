# ArDrive Desktop Changelog

All notable changes to the ArDrive Desktop MVP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.1] - 2024-12-06 - Initial MVP Release

### Added
- **Core File Sync System**: Bidirectional sync between local folder and ArDrive
- **Dual Upload System**: Support for both traditional AR and Turbo Credits uploads
- **Wallet Management**: Secure wallet import/export with password protection
- **Drive Integration**: Connect to existing ArDrive drives
- **Upload Approval Queue**: Review and approve file uploads before spending tokens
- **Cost Estimation**: Real-time cost comparison between AR and Turbo methods
- **Turbo Credits Management**: Top-up with fiat payments or convert AR tokens
- **File Monitoring**: Real-time detection of file changes in sync folder
- **Download Functionality**: Retrieve existing files from ArDrive to local folder
- **Cross-platform Support**: Windows, macOS, and Linux compatibility

### Features
- **Smart Upload Recommendations**: Automatic suggestions for optimal upload method
- **Hash-based Deduplication**: Prevent re-uploading of existing files
- **Folder Structure Support**: Maintain folder hierarchy in ArDrive
- **Error Recovery**: Robust error handling with automatic retry mechanisms
- **Session Management**: Persistent wallet sessions with secure storage

### Technical Implementation
- Built with Electron for cross-platform desktop support
- React-based user interface with TypeScript
- SQLite database for local state management
- Integration with ArDrive Core JS v2.0.8
- Turbo SDK integration for instant uploads
- Secure cryptographic wallet handling

### Known Limitations
- Files larger than 100MB are currently skipped
- Limited to single drive sync per session
- Requires manual drive selection on first run
- Basic conflict resolution (no merge capabilities)

### Security
- Wallet files are encrypted with AES encryption
- Private keys never stored in plaintext
- Secure password-based wallet unlock
- Session-based authentication for Turbo services

---

## Future Releases

### Planned for v0.1.0
- Private drive support with encryption
- Multi-drive support
- Advanced conflict resolution
- Large file upload support (>100MB)
- Enhanced version history UI
- Real-time sync automation
- Advanced file filtering options

### Planned for v0.2.0
- Mobile app companion
- Team collaboration features
- Plugin architecture for extensibility
- Advanced sharing and permissions
- Cloud backup integration