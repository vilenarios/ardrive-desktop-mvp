# Performance Guide

This document outlines performance optimizations, best practices, and monitoring strategies for ArDrive Desktop.

## Table of Contents

- [Performance Goals](#performance-goals)
- [Startup Optimization](#startup-optimization)
- [Runtime Performance](#runtime-performance)
- [Memory Management](#memory-management)
- [Network Optimization](#network-optimization)
- [File Sync Performance](#file-sync-performance)
- [UI Responsiveness](#ui-responsiveness)
- [Monitoring & Metrics](#monitoring--metrics)

## Performance Goals

### Target Metrics
- **Startup Time**: < 3 seconds to interactive UI
- **Memory Usage**: < 300MB idle, < 500MB active
- **CPU Usage**: < 5% idle, < 30% during sync
- **UI Response**: < 100ms for user interactions
- **File Detection**: < 100ms per file change
- **Network Timeout**: 3 seconds for external APIs

## Startup Optimization

### Non-Blocking Initialization

The app prioritizes getting to an interactive UI quickly:

```typescript
// Profile loading doesn't wait for ArNS data
async getProfiles(): Promise<Profile[]> {
  // Return cached profiles immediately
  const profiles = [...this.profilesConfig!.profiles];
  
  // Enrich with ArNS data asynchronously
  profiles.forEach(profile => {
    this.enrichProfileWithArNS(profile).catch(error => {
      console.error(`Failed to enrich profile ${profile.id}:`, error);
    });
  });
  
  return profiles;
}
```

### Lazy Loading

1. **ArNS Data**: Loaded after UI renders
2. **File Lists**: Paginated to show first 5 items
3. **Images**: Loaded on-demand with caching
4. **Heavy Components**: Code-split where possible

### Startup Sequence

1. Load essential config (< 50ms)
2. Initialize profile manager (< 100ms)
3. Render UI with cached data (< 500ms)
4. Background tasks:
   - ArNS enrichment
   - Wallet balance updates
   - File sync initialization

## Runtime Performance

### Debouncing & Throttling

```typescript
// File system monitoring is debounced
const debouncedFileHandler = debounce((path: string) => {
  handleFileChange(path);
}, 300);

// Search input is debounced
const debouncedSearch = debounce((query: string) => {
  setSearchQuery(query);
}, 200);
```

### Virtual Scrolling

For large file lists:
- Only render visible items
- Recycle DOM nodes
- Maintain scroll position

### Web Workers (Planned)

Heavy operations to move off main thread:
- File hashing
- Encryption/decryption
- Large JSON parsing

## Memory Management

### Profile Isolation

Each profile has isolated storage to prevent memory bloat:

```
userData/
├── profiles/
│   ├── profile-1/  # Only loaded when active
│   └── profile-2/  # Unloaded when inactive
```

### Cache Management

```typescript
// ArNS cache with expiration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Periodic cache cleanup
setInterval(() => {
  cleanExpiredCacheEntries();
}, 60 * 1000); // Every minute
```

### Memory Leak Prevention

1. **Event Listener Cleanup**
   ```typescript
   useEffect(() => {
     const handler = () => { /* ... */ };
     window.addEventListener('resize', handler);
     return () => window.removeEventListener('resize', handler);
   }, []);
   ```

2. **Component Unmounting**
   - Cancel pending requests
   - Clear timers
   - Remove subscriptions

## Network Optimization

### API Timeouts

All external API calls have timeouts:

```typescript
// ArNS API timeout
const timeoutPromise = new Promise<null>((resolve) => {
  setTimeout(() => resolve(null), 3000); // 3 seconds
});

const result = await Promise.race([
  apiCall(),
  timeoutPromise
]);
```

### Request Batching

Multiple file operations are batched:
- Upload approvals
- Status updates
- Balance checks

### Caching Strategy

1. **ArNS Data**: 5-minute cache
2. **Profile Data**: Until logout
3. **File Metadata**: Until modified
4. **Transaction IDs**: Permanent cache

## File Sync Performance

### Efficient File Watching

```typescript
// Chokidar configuration
const watcher = chokidar.watch(syncFolder, {
  ignored: /(^|[\/\\])\../, // Ignore dotfiles
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100
  }
});
```

### Upload Queue Optimization

1. **Parallel Uploads**: Up to 3 concurrent
2. **Size-Based Priority**: Small files first
3. **Retry Logic**: Exponential backoff
4. **Progress Tracking**: Per-file granularity

### Hash Computation

- SHA-256 for file integrity
- Cached to avoid recomputation
- Streamed for large files

## UI Responsiveness

### React Optimizations

1. **Memoization**
   ```typescript
   const MemoizedComponent = React.memo(Component, (prev, next) => {
     return prev.id === next.id;
   });
   ```

2. **useCallback & useMemo**
   ```typescript
   const handleClick = useCallback(() => {
     // Handler logic
   }, [dependency]);
   ```

3. **State Updates**
   - Batch related updates
   - Use functional updates
   - Avoid unnecessary re-renders

### CSS Performance

1. **CSS-in-JS Optimization**
   - Static styles extracted
   - Dynamic styles minimized
   - Animations use `transform`

2. **Layout Thrashing Prevention**
   - Batch DOM reads/writes
   - Use CSS Grid/Flexbox
   - Avoid inline styles

### Animation Performance

```css
/* Use GPU-accelerated properties */
.progress-bar-fill {
  transform: translateX(0);
  will-change: transform;
}

/* Avoid expensive properties */
/* Bad: width, height, top, left */
/* Good: transform, opacity */
```

## Monitoring & Metrics

### Performance Monitoring

```typescript
// Measure startup time
const startTime = performance.now();
await initializeApp();
const loadTime = performance.now() - startTime;
console.log(`App loaded in ${loadTime}ms`);
```

### Memory Monitoring

```typescript
// Check memory usage
if (performance.memory) {
  console.log({
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
  });
}
```

### User Timing API

```typescript
// Mark important events
performance.mark('profile-load-start');
await loadProfile();
performance.mark('profile-load-end');

performance.measure(
  'profile-load',
  'profile-load-start',
  'profile-load-end'
);
```

## Best Practices

### Do's
- ✅ Load UI first, enrich data later
- ✅ Use timeouts for all network calls
- ✅ Cache expensive computations
- ✅ Debounce user input handlers
- ✅ Profile and measure regularly

### Don'ts
- ❌ Block UI on network calls
- ❌ Load all data upfront
- ❌ Keep unused data in memory
- ❌ Perform sync operations in render
- ❌ Ignore error scenarios

## Troubleshooting Performance Issues

### Slow Startup
1. Check for blocking network calls
2. Profile initialization sequence
3. Reduce initial data loading
4. Enable production builds

### High Memory Usage
1. Check for memory leaks
2. Review cache sizes
3. Profile heap snapshots
4. Implement data pagination

### Unresponsive UI
1. Check for synchronous operations
2. Review render performance
3. Optimize component updates
4. Use React DevTools Profiler

## Future Optimizations

### Planned Improvements
1. **Web Workers** for heavy computations
2. **IndexedDB** for client-side caching
3. **Service Worker** for offline support
4. **WebAssembly** for crypto operations
5. **Lazy Component Loading** with React.lazy

### Performance Budget
- Bundle size: < 5MB
- Initial load: < 3s
- Time to interactive: < 4s
- Memory baseline: < 300MB