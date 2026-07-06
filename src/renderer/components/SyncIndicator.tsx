import React from 'react';
import { RefreshCw, Pause, CheckCircle } from 'lucide-react';
import {
  SyncIndicatorSnapshot,
  resolveSyncIndicatorKind,
  syncIndicatorLabelFor
} from '../utils/syncIndicatorStatus';

interface SyncIndicatorProps {
  snapshot: SyncIndicatorSnapshot;
}

/**
 * UX-28: persistent, always-visible sync status chip for the dashboard
 * header. Before this, overall sync progress was only visible on the
 * Download Queue tab's badge — every other tab (including the default
 * Overview tab) showed nothing while a sync ran. This chip lives in the
 * header (rendered once, outside the per-tab content), so it is visible
 * from every tab.
 *
 * Informational only, never interactive: no button semantics, no tabIndex,
 * nothing to click and nothing that can trap keyboard focus.
 * `aria-live="polite"` + `aria-atomic="true"` announce the FULL new status
 * line to screen readers whenever it changes (e.g. "Syncing 3 files…" ->
 * "Up to date") without interrupting whatever the user is doing.
 */
export const SyncIndicator: React.FC<SyncIndicatorProps> = ({ snapshot }) => {
  const kind = resolveSyncIndicatorKind(snapshot);
  const label = syncIndicatorLabelFor(snapshot);

  const icon =
    kind === 'syncing' ? (
      <RefreshCw size={13} className="animate-spin" />
    ) : kind === 'paused' ? (
      <Pause size={13} />
    ) : (
      <CheckCircle size={13} />
    );

  return (
    <div
      className={`sync-indicator sync-indicator-${kind}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {icon}
      <span className="sync-indicator-label">{label}</span>
    </div>
  );
};

export default SyncIndicator;
