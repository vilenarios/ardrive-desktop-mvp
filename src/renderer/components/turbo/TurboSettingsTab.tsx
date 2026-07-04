import React, { useEffect, useState } from 'react';
import { TrendingUp, Zap } from 'lucide-react';
import { FileUpload } from '../../../types';
import { formatFileSize } from '../../utils/turbo-utils';
import { InfoButton } from '../common/InfoButton';

// TRUST-1: this tab used to show three hardcoded literal stats ("0" Files
// Uploaded, "0 AR" Credits Used, "0 GB" Data Stored) that never updated no
// matter how much a user actually uploaded or spent — fake telemetry on a
// payment settings tab. Investigation (see DESIGN-8 TRUST-1):
//   - "Files Uploaded" and "Data Stored" DO have a real backing source —
//     the `uploads` table (status='completed', fileSize) reachable today via
//     window.electronAPI.files.getUploads() — so they're wired to it below.
//   - "Credits Used" has NO real backing source: turbo-manager only exposes
//     the current point-in-time balance, never a cumulative-spend ledger, and
//     the uploads table has no cost/winc column. Rather than invent a number
//     (or silently repurpose an unrelated figure), that tile is removed
//     outright until real spend tracking exists.
const TurboSettingsTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [filesUploaded, setFilesUploaded] = useState(0);
  const [bytesStored, setBytesStored] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      try {
        const result = await window.electronAPI.files.getUploads();
        if (cancelled) return;
        if (result.success) {
          // DB rows cross IPC raw (see CLAUDE.md) — status is a plain string
          // column here, no boolean-normalization concerns.
          const completed = (result.data as FileUpload[]).filter(u => u.status === 'completed');
          setFilesUploaded(completed.length);
          setBytesStored(completed.reduce((sum, u) => sum + (u.fileSize || 0), 0));
        }
      } catch (error) {
        console.error('[TurboSettingsTab] Failed to load upload stats:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadStats();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="tcm-settings-tab">
      {/* Usage Statistics — real counts derived from completed uploads,
          not invented numbers (TRUST-1) */}
      <div className="tcm-section">
        <div className="tcm-section-header">
          <h3>Usage Statistics</h3>
          <InfoButton tooltip="Counts of files this app has uploaded from this device and profile. Uploads made from another device or profile aren't included." />
        </div>
        <div className="tcm-stats-grid">
          <div className="tcm-stat-card">
            <TrendingUp size={20} className="tcm-stat-icon" />
            <div className="tcm-stat-value">{loading ? '—' : filesUploaded.toLocaleString()}</div>
            <div className="tcm-stat-label">Files Uploaded</div>
          </div>
          <div className="tcm-stat-card">
            <Zap size={20} className="tcm-stat-icon" />
            <div className="tcm-stat-value">{loading ? '—' : formatFileSize(bytesStored)}</div>
            <div className="tcm-stat-label">Data Stored</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TurboSettingsTab;
