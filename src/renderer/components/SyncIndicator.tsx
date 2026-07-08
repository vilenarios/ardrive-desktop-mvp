import React from 'react';
import { RefreshCw, Pause, CheckCircle, WifiOff, AlertTriangle } from 'lucide-react';
import {
  SyncIndicatorSnapshot,
  resolveSyncIndicatorKind,
  syncIndicatorLabelFor
} from '../utils/syncIndicatorStatus';

interface SyncIndicatorProps {
  snapshot: SyncIndicatorSnapshot;
}

/**
 * UX-28 / SYNC-9: persistent, always-visible sync status chip for the
 * dashboard header. Before this, overall sync progress was only visible on the
 * Download Queue tab's badge — every other tab (including the default Overview
 * tab) showed nothing while a sync ran. This chip lives in the header
 * (rendered once, outside the per-tab content), so it is visible from every
 * tab.
 *
 * SYNC-9 adds the two DEGRADED states — "Offline — sync paused" and
 * "Sync error" — so a broken/offline sync is honestly visible here instead of
 * the app looking healthy ("Up to date"/"Paused") while sync is actually down.
 *
 * Informational only, never interactive: no button semantics, no tabIndex,
 * nothing to click and nothing that can trap keyboard focus.
 * `aria-live="polite"` + `aria-atomic="true"` announce the FULL new status
 * line to screen readers whenever it changes (e.g. "Syncing 3 files…" ->
 * "Offline — sync paused") without interrupting whatever the user is doing.
 */
export const SyncIndicator: React.FC<SyncIndicatorProps> = ({ snapshot }) => {
  const kind = resolveSyncIndicatorKind(snapshot);
  const label = syncIndicatorLabelFor(snapshot);

  const icon =
    kind === 'offline' ? (
      <WifiOff size={13} />
    ) : kind === 'error' ? (
      <AlertTriangle size={13} />
    ) : kind === 'syncing' ? (
      <RefreshCw size={13} className="animate-spin" />
    ) : kind === 'paused' ? (
      <Pause size={13} />
    ) : (
      <CheckCircle size={13} />
    );

  // SYNC-9: on a degraded state, surface the honest detail (e.g. the gateway
  // error) as a hover tooltip without lengthening the compact chip label.
  const title =
    (kind === 'offline' || kind === 'error') && snapshot.healthMessage
      ? snapshot.healthMessage
      : undefined;

  return (
    <div
      className={`sync-indicator sync-indicator-${kind}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={title}
    >
      {icon}
      <span className="sync-indicator-label">{label}</span>
    </div>
  );
};

export default SyncIndicator;
