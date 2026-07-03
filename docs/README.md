# ArDrive Desktop Documentation

Welcome to the ArDrive Desktop documentation. This directory contains all project documentation organized by category.

## 📁 Documentation Structure

### Product & Process (`/product`) — start here for current work
- **[Backlog](./product/BACKLOG.md)** - Canonical work tracker (stable item IDs, acceptance criteria)
- **[Roadmap](./product/ROADMAP.md)** - Beta milestones and post-beta tracks
- **[Process](./product/PROCESS.md)** - The PM / implementer / QA-gate loop
- **[Decisions](./product/DECISIONS.md)** - Append-only decision log (D-###)
- **[Audit 2026-07-02](./product/AUDIT-2026-07-02.md)** - Immutable audit evidence snapshot

### User Documentation (`/user`)
- **[Getting Started](./user/getting-started.md)** - Quick start guide for new users
- **[User Guide](./user/user-guide.md)** - Comprehensive user manual
- **[Troubleshooting](./user/troubleshooting.md)** - Common issues and solutions

### Developer Documentation (`/developer`)
- **[Setup Guide](./developer/setup.md)** - Development environment setup
- **[Development](./developer/development.md)** - Development guidelines and practices
- **[Architecture](./developer/architecture.md)** - System architecture overview
- **[Codebase Map](./developer/codebase-map.md)** - Project structure guide
- **[Design Guidelines](./developer/design-guidelines.md)** - UI/UX design principles
- **Building & Releasing**
  - **[Quick Build](./developer/building/quick-build.md)** - Fast build instructions
  - **[Installers](./developer/building/installers.md)** - Creating installers
  - **[MVP Getting Started](./developer/mvp-getting-started.md)** - Dev/release onboarding
  - **[MVP Workflow](./developer/mvp-workflow.md)** - Branch/CI workflow
  - **[Release Guide](./developer/release-guide.md)** - Release process
  - **[Testing Distribution](./developer/testing-distribution.md)** - Sharing builds with testers

### API & SDK Documentation (`/api`)
- **[API Reference](./api/api-reference.md)** - API endpoints and usage
- **SDK Documentation**
  - **[AR.IO SDK](./api/sdk/ar-io-sdk.md)** - AR.IO integration
  - **[ArDrive Core JS](./api/sdk/ardrive-core-js.md)** - Core JavaScript library
  - **[ArDrive Turbo](./api/sdk/ardrive-turbo.md)** - Turbo upload system

### Testing Documentation (`/testing`)
- **[Testing Guide](./testing/testing-guide.md)** - Testing strategies and tools
- **[QA Test Plan](./testing/qa-test-plan.md)** - Quality assurance procedures
- **[UAT Testing](./testing/uat-testing.md)** - User acceptance testing guide

### Operations (`/operations`)
- **[Security](./operations/security.md)** - Security policies and practices
- **[Security Logging](./operations/security-logging.md)** - Logging guidelines
- **[Performance](./operations/performance.md)** - Performance optimization
- **[Conflict Management](./operations/conflict-management.md)** - Handling sync conflicts

### Reference Documentation (`/reference`)
- **[Features](./reference/features.md)** - Feature documentation
- **[Product Specification](./reference/product-specification.md)** - Product specs
- **[Edge Cases](./reference/edge-cases.md)** - Edge case handling
- **[Sync Optimization](./reference/sync-optimization.md)** - Sync performance
- **[Incremental Sync](./reference/incremental-sync.md)** - Incremental sync guide
- **[Code Review](./reference/code-review.md)** - Code review findings
- **[Recommendations](./reference/recommendations.md)** - Project recommendations
- **Analysis**
  - **[Bug Analysis](./reference/analysis/bug-analysis-final.md)** - Bug analysis report
  - **[Bug Diagnosis](./reference/analysis/diagnose-bug.md)** - Diagnostic procedures

### Releases (`/releases`)
- **[Changelog](./releases/changelog.md)** - Version history
- **[v0.0.1 Release Notes](./releases/v0.0.1.md)** - Initial release notes

### Archive (`/archive`) — superseded, historical only
Old plans and reviews kept for reference (drive-key persistence plans, old test plan, move-detection review, private-drives implementation guide). Do not implement from these; current work is in `/product`.

### Vendor (`/vendor`)
Third-party SDK readmes vendored for offline reference (ardrive-core-js, wayfinder-core).

### Branding (`/branding`)
Style guide and marketing images (kept out of `assets/`, which ships inside installers).

## 🔍 Finding Information

- **New Users**: Start with [Getting Started](./user/getting-started.md)
- **Developers**: Begin with [Developer Setup](./developer/setup.md)
- **Testers**: See [Testing Guide](./testing/testing-guide.md)
- **API Integration**: Check [API Reference](./api/api-reference.md)

## 📝 Documentation Standards

When contributing to documentation:
1. Use clear, concise language
2. Include code examples where applicable
3. Keep formatting consistent
4. Update the table of contents when adding new docs
5. Use relative links between documents

## 🚀 Quick Links

- [Main README](../README.md) - Project overview
- [CLAUDE.md](../CLAUDE.md) - AI assistant guidance
- [LICENSE](../LICENSE) - License information