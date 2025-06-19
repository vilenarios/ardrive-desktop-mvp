# UAT Testing Made Easy 🚀

This guide shows you how to streamline your UAT testing process using the built-in development tools.

## Quick Start

### 1. Enable Development Mode
- Press `Ctrl+Shift+D` to toggle the development panel
- The dev panel appears in the top-right corner with shortcut buttons

### 2. Quick Navigation Shortcuts
- **🔄 Reset All** - Completely resets the app state
- **→ Wallet Setup** - Jump directly to wallet creation/import
- **→ Drive Setup** - Skip to drive selection with test wallet
- **→ Dashboard** - Go straight to dashboard with everything set up

### 3. Keyboard Shortcuts (when dev mode is active)
- `Ctrl+Shift+R` - Quick reset
- `Ctrl+Shift+1` - Jump to wallet setup
- `Ctrl+Shift+2` - Jump to drive setup  
- `Ctrl+Shift+3` - Jump to dashboard

### 4. UAT Checklist
- Click **🧪 UAT Checklist** to open the testing checklist
- Track your progress through all test scenarios
- Filter by category (onboarding, dashboard, sync, etc.)
- Check off items as you complete them

## Testing Scenarios

### NPM Scripts for Different Test Modes
```bash
# Standard UAT mode with dev tools
npm run uat

# Start at new user flow
npm run uat:new-user

# Start at existing user flow  
npm run uat:existing-user

# Start at dashboard
npm run uat:dashboard

# Clean build + UAT
npm run uat:clean
```

## UAT Workflow Recommendations

### 1. **Start Fresh Each Test Cycle**
- Use `🔄 Reset All` or `Ctrl+Shift+R`
- This clears all data and starts from scratch

### 2. **Use the Checklist**
- Open UAT Checklist to see all test scenarios
- Work through categories systematically
- Check off items as you complete them

### 3. **Test Specific Flows Quickly**
- Use the navigation shortcuts to jump to specific areas
- No need to go through full onboarding every time

### 4. **Test Edge Cases**
- Use dev shortcuts to quickly get to edge case scenarios
- Test error conditions without lengthy setup

## Test Data Available

The development mode provides:
- Test wallet addresses
- Mock drive data
- Sample sync folders
- Placeholder balances

## Tips for Efficient UAT

1. **Group Similar Tests**: Use the checklist categories to batch similar tests
2. **Use Shortcuts**: Don't manually navigate through flows you've already tested
3. **Reset Frequently**: Start fresh for each major test category
4. **Track Progress**: Use the checklist to avoid re-testing the same scenarios
5. **Test Real Flows**: Occasionally do full end-to-end tests without shortcuts

## Disabling Dev Mode

- Press `Ctrl+Shift+D` to hide the development panel
- Set `NODE_ENV=production` to completely disable dev features
- Dev mode is only available in development builds

---

This setup should reduce your UAT time significantly while ensuring thorough testing coverage!