# ArDrive Desktop MVP - Comprehensive Test Plan

## Current Test Status

### Test Infrastructure
- Framework: Vitest with React Testing Library
- Coverage tools: Configured but missing @vitest/coverage-v8 dependency
- Existing tests: 3 test files (2 unit tests, 1 React component test)
- Test status: Currently failing due to dependency issues and mock setup

### Existing Test Files
1. `tests/unit/profile-authentication.test.ts` - Profile switching and authentication
2. `tests/unit/sync/sync-manager.test.ts` - Basic sync manager structure (mostly placeholders)
3. `tests/unit/react-profile-flow.test.tsx` - React component testing for ProfileSwitcher

## Critical User Flows to Test

### 1. User Onboarding & Authentication (Priority: High)
- **New User Flow**
  - Create new wallet
  - Import existing wallet from file
  - Import wallet from seed phrase
  - Set up profile with password
  - Profile creation and switching

- **Existing User Flow**
  - Profile selection on startup
  - Password authentication
  - Auto-load wallet on return
  - Profile switching with password verification
  - Logout and wallet cleanup

### 2. File Synchronization (Priority: Critical)
- **Upload Flow**
  - File detection and queuing
  - Upload approval queue management
  - Cost estimation (AR tokens vs Turbo Credits)
  - Upload progress tracking
  - Error handling and retry logic
  - File size validation (100MB limit)

- **Download Flow**
  - Drive content scanning
  - Download queue management
  - Streaming download implementation
  - Progress tracking
  - File integrity verification (SHA-256)

- **Sync Operations**
  - File move detection
  - File rename detection
  - File copy detection
  - Folder operations detection
  - Conflict resolution
  - Real-time file watching

### 3. Drive Management (Priority: High)
- Create new drive (public/private)
- Select and switch drives
- Drive metadata caching
- Manifest creation for public drives
- ArNS name resolution

### 4. Payment & Credits (Priority: Medium)
- Turbo Credits balance checking
- Cost estimation for uploads
- AR token balance management
- Payment method selection
- Top-up flow

### 5. Security & Encryption (Priority: Critical)
- Wallet encryption/decryption
- Password validation
- Secure key storage
- Profile isolation
- Input validation for all user inputs

## Test Categories & Implementation Plan

### Phase 1: Fix Existing Tests (Immediate)
1. Fix dependency issues in test setup
2. Update mock implementations for current architecture
3. Fix React component test warnings (act() wrapper)
4. Ensure all existing tests pass

### Phase 2: Core Functionality Tests (Week 1)
1. **Wallet Manager Tests** (`wallet-manager-secure.ts`)
   - Wallet creation, import, export
   - Encryption/decryption
   - Password management
   - Profile switching integration

2. **Database Manager Tests** (`database-manager.ts`)
   - Profile isolation
   - CRUD operations for all entities
   - Migration handling
   - Transaction support

3. **Input Validator Tests** (`input-validator.ts`)
   - All validation methods
   - Security edge cases
   - Error message consistency

### Phase 3: Sync Engine Tests (Week 2)
1. **File Operation Detectors**
   - FileOperationDetector tests
   - FolderOperationDetector tests
   - Timing window tests
   - Hash matching tests

2. **Sync Manager Core**
   - Full sync flow
   - File watching
   - Upload queue processing
   - Download queue processing
   - Error recovery

3. **Streaming & Verification**
   - StreamingDownloader tests
   - FileHashVerifier tests
   - Progress tracking accuracy

### Phase 4: Integration Tests (Week 3)
1. **End-to-End User Flows**
   - Complete onboarding flow
   - File upload from detection to completion
   - File download with verification
   - Profile switching with sync state

2. **IPC Communication Tests**
   - All IPC handlers in main.ts
   - Preload API contract testing
   - Error propagation

3. **React Component Tests**
   - Dashboard components
   - Upload approval queue
   - Sync progress display
   - Wallet setup flow

### Phase 5: Performance & Edge Cases (Week 4)
1. **Performance Tests**
   - Large file handling
   - Multiple concurrent operations
   - Memory usage during streaming
   - Database query optimization

2. **Error Scenarios**
   - Network failures
   - Disk space issues
   - Corrupted files
   - Invalid wallet formats
   - Malformed inputs

3. **Security Tests**
   - Path traversal prevention
   - SQL injection prevention
   - XSS prevention in renderer
   - Secure IPC validation

## Test Implementation Guidelines

### Unit Test Structure
```typescript
describe('ComponentName', () => {
  let instance: ComponentClass;
  
  beforeEach(() => {
    // Setup mocks and instance
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('methodName', () => {
    it('should handle success case', async () => {
      // Arrange
      // Act
      // Assert
    });
    
    it('should handle error case', async () => {
      // Test error scenarios
    });
  });
});
```

### Integration Test Pattern
```typescript
describe('Feature Integration', () => {
  it('should complete full user flow', async () => {
    // Step 1: Setup initial state
    // Step 2: Perform user actions
    // Step 3: Verify final state
    // Step 4: Check side effects
  });
});
```

### React Component Test Pattern
```typescript
describe('Component', () => {
  it('should render with props', async () => {
    const { getByText, getByRole } = render(<Component {...props} />);
    
    // Use act() for state updates
    await act(async () => {
      fireEvent.click(getByRole('button'));
    });
    
    expect(getByText('Expected Text')).toBeInTheDocument();
  });
});
```

## Success Metrics

1. **Code Coverage Goals**
   - Overall: 80%+ coverage
   - Critical paths: 95%+ coverage
   - New features: 100% coverage before merge

2. **Test Reliability**
   - Zero flaky tests
   - All tests pass in CI/CD
   - Tests run in < 5 minutes

3. **Bug Detection**
   - Catch 90%+ of bugs before production
   - All critical paths have integration tests
   - Security vulnerabilities tested

## Next Steps

1. Install missing test dependencies (`@vitest/coverage-v8`)
2. Fix existing test failures
3. Set up continuous integration for test runs
4. Begin implementing Phase 2 core functionality tests
5. Create test data fixtures for consistent testing
6. Document test patterns for team consistency

## Tools & Resources Needed

- Mock file system for file operation tests
- Test wallet files and seed phrases
- Mock ArDrive API responses
- Test database instances
- Performance profiling tools
- Security scanning tools

This comprehensive test plan will ensure the ArDrive Desktop MVP maintains high quality and reliability as development continues.