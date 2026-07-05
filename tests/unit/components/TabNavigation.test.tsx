// UAT-1b (defect #4): only the ACTIVE tab's role="tabpanel" is ever mounted
// (Dashboard.tsx conditionally renders a single panel), so every tab button
// emitting aria-controls unconditionally left inactive tabs pointing at
// panel ids that don't exist in the DOM. Only the active tab should carry
// aria-controls now.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TabNavigation } from '../../../src/renderer/components/common/TabNavigation';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'upload-queue', label: 'Upload Queue' },
  { id: 'permaweb', label: 'Permaweb' },
];

describe('TabNavigation aria-controls (UAT-1b defect #4)', () => {
  it('only the active tab has aria-controls, and it resolves to a mounted panel id', () => {
    // Mirrors Dashboard.tsx: only the active tab's panel is mounted.
    render(
      <>
        <TabNavigation tabs={TABS} activeTab="upload-queue" onTabChange={() => {}} />
        <div id="upload-queue-panel" role="tabpanel" aria-labelledby="upload-queue-tab" />
      </>
    );

    const activeTabButton = screen.getByRole('tab', { name: 'Upload Queue' });
    expect(activeTabButton).toHaveAttribute('aria-controls', 'upload-queue-panel');
    expect(document.getElementById(activeTabButton.getAttribute('aria-controls')!)).not.toBeNull();

    for (const label of ['Overview', 'Permaweb']) {
      const inactiveTabButton = screen.getByRole('tab', { name: label });
      expect(inactiveTabButton).not.toHaveAttribute('aria-controls');
    }
  });

  it('moving the active tab moves aria-controls with it (never stale)', () => {
    const { rerender } = render(
      <TabNavigation tabs={TABS} activeTab="overview" onTabChange={() => {}} />
    );
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-controls', 'overview-panel');
    expect(screen.getByRole('tab', { name: 'Permaweb' })).not.toHaveAttribute('aria-controls');

    rerender(<TabNavigation tabs={TABS} activeTab="permaweb" onTabChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Permaweb' })).toHaveAttribute('aria-controls', 'permaweb-panel');
    expect(screen.getByRole('tab', { name: 'Overview' })).not.toHaveAttribute('aria-controls');
  });
});
