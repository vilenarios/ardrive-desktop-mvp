# ArDrive Desktop Design Guidelines

## Overview
These guidelines ensure a consistent, intuitive user experience that meets Google-level UX standards while maintaining ArDrive's unique value proposition of permanent, decentralized storage.

## Core Design Principles

### 1. **Simplicity First**
- Default to the simplest interface that accomplishes the user's goal
- Hide complexity behind progressive disclosure
- Use smart defaults to reduce user decisions
- One primary action per screen

### 2. **Clarity Over Completeness**
- Use plain language over technical jargon
- Explain benefits, not features
- Show outcomes, not processes
- Provide context for technical concepts

### 3. **Progressive Disclosure**
- Start with essential information only
- Reveal additional details on demand
- Use "Show more" / "Advanced options" patterns
- Layer complexity based on user expertise

### 4. **Consistent Patterns**
- Reuse established UI patterns
- Maintain consistent behavior across similar components
- Follow platform conventions
- Create predictable interactions

## Language & Messaging Standards

### Terminology Consistency

**Use These Terms (User-Friendly):**
- Account (not "wallet")
- Storage (not "drive" unless specifically referring to ArDrive)
- Upload (not "sync" for one-time actions)
- Sync (only for continuous folder monitoring)
- Credits (not "Turbo Credits" in UI)
- Recovery phrase (not "seed phrase")
- Permanent storage (not "Arweave" unless in technical context)

**Avoid These Terms:**
- Winston (use "transaction fee" instead)
- JWK, JWT (use "account key" if needed)
- ArFS (explain as "ArDrive's file system")
- Gas fees (use "network fees")

### Tone Guidelines

**Voice:** Helpful, confident, encouraging
**Personality:** Expert guide, not cold software
**Language:** Conversational but professional

**Example Transformations:**
- ❌ "Import wallet from seed phrase"
- ✅ "Restore your account"

- ❌ "Select drive privacy setting"
- ✅ "Who can see your files?"

- ❌ "Transaction failed with error code 429"
- ✅ "Upload paused - trying again in a moment"

### Error Messages

**Structure:** [What happened] + [Why] + [What to do]

**Examples:**
- ❌ "Invalid JWK format"
- ✅ "Couldn't read your account file. Please check it's the correct .json file from ArDrive."

- ❌ "Insufficient balance for transaction"
- ✅ "Not enough credits to upload. Add credits or try a smaller file."

### Success Messages

**Structure:** [What was accomplished] + [What happens next]

**Examples:**
- ✅ "Account created! Your files will be stored permanently on Arweave."
- ✅ "Upload complete! Anyone with the link can view this file."

## Visual Design System

### Layout Principles

#### Spacing System
```css
--space-1: 4px;   /* Tight spacing */
--space-2: 8px;   /* Component padding */
--space-3: 12px;  /* Element margins */
--space-4: 16px;  /* Card padding */
--space-5: 24px;  /* Section spacing */
--space-6: 32px;  /* Large spacing */
--space-8: 48px;  /* Page margins */
```

#### Typography Scale
```css
--text-xs: 12px;    /* Secondary labels */
--text-sm: 14px;    /* Body text */
--text-base: 16px;  /* Primary body */
--text-lg: 18px;    /* Subheadings */
--text-xl: 20px;    /* Card titles */
--text-2xl: 24px;   /* Section headings */
--text-3xl: 30px;   /* Page headings */
```

### Component Standards

#### Buttons

**Primary Button:**
- High contrast background
- Used for main action only
- One per screen/section
- Clear action verb ("Upload", "Create", "Save")

**Secondary Button:**
- Border style
- Supporting actions
- Cancel, back, alternative paths

**Icon Buttons:**
- 40px minimum click target
- Include aria-label
- Consistent icon family (Lucide React)

#### Cards
```css
.card {
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  border: 1px solid var(--gray-200);
  box-shadow: var(--shadow-sm);
}

.card-interactive {
  cursor: pointer;
  transition: all 0.2s ease;
}

.card-interactive:hover {
  border-color: var(--gray-300);
  box-shadow: var(--shadow-md);
}
```

#### Loading States
- Use consistent spinner component
- Show progress percentage when possible
- Provide meaningful loading text
- Never show raw "Loading..." without context

#### Empty States
- Friendly illustration or icon
- Clear explanation of why it's empty
- Primary action to resolve
- Secondary help link if needed

### Information Hierarchy

#### Progressive Disclosure Patterns

**Expansion Panels:**
```jsx
<ExpandableSection 
  title="Advanced options"
  summary="2 settings configured"
>
  {/* Complex options here */}
</ExpandableSection>
```

**Info Buttons:**
```jsx
<Label>
  Credits balance
  <InfoButton tooltip="Credits are used for fast uploads">
    <HelpCircle size={16} />
  </InfoButton>
</Label>
```

**Tabs for Complex Features:**
- Overview (default)
- Details (advanced)
- Settings (customization)

## User Flow Patterns

### Onboarding Flow

1. **Welcome Screen** - Value proposition, not features
2. **Account Setup** - Combined wallet + profile creation
3. **Storage Setup** - Quick drive creation with smart defaults
4. **Success State** - Clear next steps, tour offer

### Progressive Enhancement

**Level 1 (New Users):**
- Single drive
- Public files only
- Automatic upload method selection
- Basic file management

**Level 2 (Familiar Users):**
- Multiple drives
- Privacy options
- Manual upload method choice
- Metadata editing

**Level 3 (Power Users):**
- Bulk operations
- Advanced metadata
- Cost optimization
- Export/backup features

### Navigation Patterns

#### Breadcrumb Navigation
```jsx
<Breadcrumb>
  <BreadcrumbItem>Settings</BreadcrumbItem>
  <BreadcrumbItem>Storage</BreadcrumbItem>
  <BreadcrumbItem current>Drive #1</BreadcrumbItem>
</Breadcrumb>
```

#### Modal Navigation
- Always include escape routes (X button, Cancel)
- Use consistent footer layout (Cancel left, Action right)
- Prevent loss of work with "unsaved changes" warnings

## Accessibility Standards

### Keyboard Navigation
- All interactive elements must be keyboard accessible
- Visible focus indicators
- Logical tab order
- Escape key closes modals/dropdowns

### Screen Readers
- Semantic HTML structure
- ARIA labels for icon buttons
- Status announcements for dynamic content
- Alternative text for images/icons

### Visual Accessibility
- 4.5:1 contrast ratio minimum
- Color-blind friendly status indicators
- Text alternatives for color-coded information
- Minimum 44px touch targets

## Mobile-First Responsive Design

### Breakpoints
```css
--mobile: 640px;
--tablet: 768px;
--desktop: 1024px;
--wide: 1280px;
```

### Mobile Patterns
- Single column layouts
- Collapsible navigation
- Thumb-friendly touch targets
- Horizontal scrolling for tables
- Bottom sheet modals

### Desktop Enhancements
- Two-column layouts where beneficial
- Hover states
- Keyboard shortcuts
- Contextual menus
- Multi-selection capabilities

## Performance & Feedback

### Loading States
- Skeleton screens for known layouts
- Progress indicators for long operations
- Optimistic updates where safe
- Background loading with notifications

### Error Handling
- Graceful degradation
- Retry mechanisms
- Clear recovery paths
- Contact support as last resort

### Success Feedback
- Immediate visual confirmation
- Toast notifications for background actions
- Progress towards goals
- Celebration of milestones

## Help & Documentation

### Contextual Help
- Info buttons near complex controls
- Tooltips for unfamiliar terms
- "Learn more" links to detailed docs
- Progressive disclosure in help text

### Help Content Structure
1. **Quick answer** (1 sentence)
2. **Why this matters** (benefit/context)
3. **How to do it** (step-by-step if needed)
4. **Related topics** (links to other help)

### Examples
```jsx
<InfoTooltip>
  <TooltipTrigger>
    What are Credits? <HelpCircle size={14} />
  </TooltipTrigger>
  <TooltipContent>
    <strong>Credits make uploads instant</strong>
    <p>Instead of waiting 20+ minutes, uploads complete in seconds.</p>
    <Link>Learn about pricing →</Link>
  </TooltipContent>
</InfoTooltip>
```

## Quality Checklist

Before shipping any interface:

### Language
- [ ] Uses approved terminology
- [ ] No technical jargon without explanation
- [ ] Error messages follow structure guidelines
- [ ] CTAs use action verbs

### Visual
- [ ] Follows spacing system
- [ ] Uses consistent components
- [ ] Has proper loading states
- [ ] Works on mobile

### Interaction
- [ ] Keyboard accessible
- [ ] Has focus indicators
- [ ] Provides feedback for all actions
- [ ] Handles error states gracefully

### Content
- [ ] Progressive disclosure where appropriate
- [ ] Contextual help available
- [ ] Clear next steps
- [ ] No information overload

This design system should be treated as a living document, updated as we learn from user feedback and usage patterns.