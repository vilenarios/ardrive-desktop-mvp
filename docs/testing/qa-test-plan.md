# ArDrive Desktop MVP - QA Test Plan

## Overview
This document outlines the comprehensive testing strategy for ArDrive Desktop MVP, including manual testing procedures, automated test coverage, and quality assurance checkpoints.

## Test Environment Setup

### Prerequisites
- Node.js 18+ installed
- Test Arweave wallet with small AR balance
- Test Turbo Credits account
- Windows/macOS/Linux test environments

### Test Data
- Small test files (< 1MB) for upload testing
- Various file types: .txt, .pdf, .jpg, .json
- Large file (> 10MB) for performance testing
- Files with special characters in names

## Automated Test Coverage

### Unit Tests (`npm test`)
- **Database Operations**: CRUD operations, file tracking
- **Turbo Manager**: Balance, costs, payments, uploads
- **Cost Calculations**: AR vs Turbo pricing
- **File Processing**: Hash generation, duplicate detection
- **React Components**: UI interactions, state management

### Integration Tests
- **File Sync Workflow**: End-to-end file synchronization
- **Upload Processing**: AR and Turbo upload paths
- **Payment Flow**: Turbo Credits purchase and usage
- **Error Handling**: Network failures, invalid inputs

### Coverage Goals
- **Minimum**: 80% overall code coverage
- **Critical Paths**: 95+ coverage for core sync and payment flows
- **UI Components**: 70+ coverage for user interactions

## Manual Testing Checklist

### 1. Application Startup & Wallet Setup
- [ ] App launches without errors
- [ ] GPU crashes are resolved (no console errors)
- [ ] Wallet selection dialog appears for new users
- [ ] Valid wallet loads successfully
- [ ] Invalid wallet shows appropriate error
- [ ] Wallet persistence works across app restarts
- [ ] Balance displays correctly (AR and Turbo Credits)

### 2. Drive Management
- [ ] Available drives load and display
- [ ] Drive selection works correctly
- [ ] Drive information displays properly
- [ ] Error handling for inaccessible drives

### 3. Sync Folder Configuration
- [ ] Folder selection dialog works
- [ ] Selected folder path displays correctly
- [ ] Folder permissions are validated
- [ ] Invalid folders show appropriate errors

### 4. File Synchronization - Downloads
- [ ] Existing drive files download to local folder
- [ ] Downloaded files have correct content
- [ ] File metadata is preserved
- [ ] Progress indicators work during download
- [ ] Download errors are handled gracefully
- [ ] Large files download successfully

### 5. File Synchronization - Uploads
- [ ] New local files are detected
- [ ] Files appear in pending approval queue
- [ ] Cost calculations display correctly (AR and Turbo)
- [ ] Upload method selection works
- [ ] Approved uploads process successfully
- [ ] Upload progress tracking works
- [ ] Failed uploads show error messages
- [ ] Upload history displays correctly

### 6. File Processing & Deduplication
- [ ] Already downloaded files don't re-upload
- [ ] Duplicate files are properly detected
- [ ] File hash tracking works across app restarts
- [ ] Modified files are detected as new uploads
- [ ] Large files (>100MB) are rejected appropriately

### 7. Turbo Credits Management
- [ ] Current balance displays correctly
- [ ] Balance updates after payments
- [ ] Fiat estimates load and update
- [ ] Currency selection works for all supported currencies

### 8. Payment Flow - Fiat Top-up
- [ ] "Pay with Card" opens payment window
- [ ] Payment window is modal and properly sized
- [ ] Stripe checkout loads correctly
- [ ] Test payment processing works
- [ ] Payment success detection works
- [ ] Payment window closes after success
- [ ] Balance refreshes after payment
- [ ] Payment errors are handled appropriately
- [ ] Invalid amounts are rejected

### 9. Payment Flow - AR Token Conversion
- [ ] AR to Turbo Credits conversion works
- [ ] Conversion rates display correctly
- [ ] Sufficient AR balance is verified
- [ ] Transaction processing works
- [ ] Balance updates after conversion

### 10. Upload Method Selection
- [ ] Cost comparison displays correctly
- [ ] Turbo option appears when available
- [ ] AR fallback works when Turbo fails
- [ ] Method selection persists for each file
- [ ] Recommended method highlights correctly

### 11. Error Handling & Edge Cases
- [ ] Network disconnection during upload
- [ ] Insufficient balance errors
- [ ] Wallet logout/login cycles
- [ ] App crash recovery
- [ ] Corrupted database recovery
- [ ] Invalid file types
- [ ] Files with special characters
- [ ] Very long file names
- [ ] Permission-restricted files

### 12. UI/UX Validation
- [ ] Responsive design works on different screen sizes
- [ ] Dark/light theme consistency
- [ ] Loading states are clear and informative
- [ ] Error messages are user-friendly
- [ ] Success feedback is appropriate
- [ ] Navigation flows are intuitive
- [ ] Scrollbar positioning is correct
- [ ] Apple design guidelines compliance

### 13. Performance Testing
- [ ] App startup time < 3 seconds
- [ ] File detection is real-time
- [ ] Large folder scanning completes reasonably
- [ ] Memory usage remains stable
- [ ] CPU usage is reasonable during sync
- [ ] Multiple file uploads handle well
- [ ] UI remains responsive during operations

### 14. Security Testing
- [ ] Wallet files are encrypted properly
- [ ] Session passwords are machine-specific
- [ ] No sensitive data in logs
- [ ] Payment data is handled securely
- [ ] File permissions are respected

## Browser & Platform Testing

### Operating Systems
- [ ] Windows 10/11 (x64)
- [ ] macOS (Intel & Apple Silicon)
- [ ] Linux (Ubuntu/Debian)

### Payment Browser Compatibility
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (macOS)
- [ ] Edge

## Performance Benchmarks

### Target Metrics
- **Startup Time**: < 3 seconds
- **File Detection**: < 1 second for changes
- **Small File Upload**: < 30 seconds (< 1MB)
- **Payment Flow**: < 60 seconds end-to-end
- **Memory Usage**: < 200MB idle, < 500MB active
- **CPU Usage**: < 5% idle, < 30% during operations

### Load Testing
- [ ] 100+ files in sync folder
- [ ] 10+ concurrent uploads
- [ ] Extended runtime (24+ hours)
- [ ] Multiple payment transactions

## Regression Testing

### Critical Paths to Verify
1. **Wallet → Drive → Sync Setup**: Complete onboarding flow
2. **File Upload**: Local file → Pending → Approved → Completed
3. **Payment**: No Credits → Purchase → Use for Upload
4. **Error Recovery**: Network fail → Retry → Success

### Before Each Release
- [ ] Run full automated test suite
- [ ] Execute critical path manual tests
- [ ] Verify no new console errors
- [ ] Test payment flow end-to-end
- [ ] Validate file sync accuracy

## Bug Severity Classification

### Critical (P0) - Release Blockers
- App won't start
- Data corruption/loss
- Payment processing fails
- Security vulnerabilities

### High (P1) - Must Fix Before Release
- Core functionality broken
- UI completely unusable
- Memory leaks
- Performance degradation

### Medium (P2) - Should Fix
- Minor UI issues
- Edge case errors
- Confusing error messages
- Performance optimization

### Low (P3) - Nice to Have
- Cosmetic issues
- Minor UX improvements
- Code cleanup
- Documentation updates

## Test Reports

### Daily Testing
- Automated test results
- Performance metrics
- New issue triage
- Critical bug status

### Release Testing
- Full manual test checklist completion
- Performance benchmark results
- Security scan results
- Cross-platform validation

## Quality Gates

### Code Quality
- [ ] All automated tests pass
- [ ] Code coverage > 80%
- [ ] No high-severity linting errors
- [ ] TypeScript compilation with no errors

### Functionality
- [ ] All critical paths tested
- [ ] Payment flow verified
- [ ] File sync accuracy confirmed
- [ ] Error handling validated

### Performance
- [ ] Benchmark targets met
- [ ] No memory leaks detected
- [ ] Startup time acceptable
- [ ] UI responsiveness maintained

### Security
- [ ] No sensitive data exposure
- [ ] Encryption working properly
- [ ] Payment security verified
- [ ] File permissions respected

## Release Criteria

### Pre-Release Checklist
- [ ] All P0 and P1 bugs resolved
- [ ] Automated tests passing (100%)
- [ ] Manual testing completed (critical paths)
- [ ] Performance benchmarks met
- [ ] Security review passed
- [ ] Documentation updated

### Post-Release Monitoring
- [ ] User feedback collection
- [ ] Error monitoring active
- [ ] Performance metrics tracking
- [ ] Security incident monitoring