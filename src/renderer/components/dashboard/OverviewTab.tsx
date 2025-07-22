import React, { useState, useEffect } from 'react';
import { DriveInfo, AppConfig } from '../../../types';
import { 
  HardDrive, 
  Copy,
  Lock,
  Globe,
  FolderOpen,
  Cloud,
  Zap,
  FileDown,
  ExternalLink
} from 'lucide-react';

interface OverviewTabProps {
  drive: DriveInfo;
  config: AppConfig;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  drive,
  config
}) => {
  const selectedDrive = drive;
  const [driveStats, setDriveStats] = useState<{
    fileCount: number;
    folderCount: number;
    totalSize: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedDrive) {
      loadDriveStats();
    }
  }, [selectedDrive?.id]);

  const loadDriveStats = async () => {
    try {
      setLoading(true);
      
      // Get real data from permaweb (use cache for instant loading)
      const permawebFiles = await window.electronAPI.drive.getPermawebFiles(selectedDrive.id, false);
      
      const files = permawebFiles.filter((item: any) => item.type === 'file');
      const folders = permawebFiles.filter((item: any) => item.type === 'folder');
      
      // Only log issues
      const filesWithoutSize = files.filter((file: any) => !file.size || file.size === 0);
      if (filesWithoutSize.length > 0) {
        console.warn(`⚠️ ${filesWithoutSize.length}/${files.length} files missing size in permaweb data`);
      }
      
      const stats = {
        fileCount: files.length,
        folderCount: folders.length,
        totalSize: files.reduce((total: number, file: any) => {
          const fileSize = file.size || 0;
          return total + fileSize;
        }, 0)
      };
      
      console.log('📈 Drive stats from permaweb:', stats);
      setDriveStats(stats);
    } catch (error) {
      console.error('Failed to load drive stats:', error);
      // Fallback to empty stats
      setDriveStats({
        fileCount: 0,
        folderCount: 0,
        totalSize: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatContains = (folderCount: number, fileCount: number) => {
    const parts = [];
    if (folderCount > 0) {
      parts.push(`${folderCount} folder${folderCount !== 1 ? 's' : ''}`);
    }
    if (fileCount > 0) {
      parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'Empty';
  };

  const exportDriveMetadata = async () => {
    try {
      console.log('Starting drive metadata export for drive:', selectedDrive.id);
      
      // Get the permaweb files data
      const permawebFiles = await window.electronAPI.drive.getPermawebFiles(selectedDrive.id, true);
      console.log('Retrieved permaweb files:', permawebFiles);
      
      if (!permawebFiles || permawebFiles.length === 0) {
        alert('No files found to export');
        return;
      }

      // Convert the data to CSV format
      const csvHeaders = [
        'File Id',
        'File Name', 
        'Parent Folder ID',
        'Parent Folder Name',
        'Data Transaction ID',
        'Metadata Transaction ID',
        'File Size',
        'Date Created',
        'Last Modified',
        'Direct Download Link',
        'Status'
      ];

      const csvRows = permawebFiles
        .filter((item: any) => item.type === 'file') // Only export files, not folders
        .map((file: any) => {
          // Format dates to match the example CSV format
          const formatDate = (dateStr: string) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toISOString().replace('T', ' ').replace('Z', '.000');
          };

          return [
            file.id || '',
            file.name || '',
            file.parentId || '',
            file.parentName || selectedDrive?.name || '', // Use drive name as fallback
            file.dataTxId || '',
            file.metadataTxId || '',
            file.size || 0,
            formatDate(file.createdAt || file.modifiedAt),
            formatDate(file.modifiedAt),
            file.dataTxId ? `https://arweave.net/${file.dataTxId}` : '',
            'confirmed' // Default status - could be enhanced based on actual status
          ];
        });

      // Generate CSV content
      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map((row: (string | number)[]) => 
          row.map((field: string | number) => 
            // Escape fields that contain commas, quotes, or newlines
            typeof field === 'string' && (field.includes(',') || field.includes('"') || field.includes('\n'))
              ? `"${field.replace(/"/g, '""')}"` 
              : field
          ).join(',')
        )
      ].join('\n');

      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/:/g, '_')
        .replace('T', ' ')
        .replace('Z', '')
        .replace(/\./g, '_');
      
      const filename = `Export from ${selectedDrive?.id || 'Drive'} ${timestamp}.csv`;

      // Create and download the file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`CSV export completed: ${filename}`);
        // Could add a toast notification here
      } else {
        throw new Error('CSV download not supported');
      }
      
    } catch (error) {
      console.error('Failed to export drive metadata:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };



  if (!selectedDrive) {
    return (
      <div className="overview-tab">
        <div className="empty-state">
          <HardDrive size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }} />
          <h3>No Drive Selected</h3>
          <p>Select a drive to view its information.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-tab">
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '600', margin: 0, marginBottom: 'var(--space-2)' }}>
          Dashboard Overview
        </h2>
        <p style={{ color: 'var(--gray-600)', fontSize: '16px', margin: 0 }}>
          Welcome to your ArDrive. Here&apos;s what&apos;s happening with your permanent storage.
        </p>
      </div>


      {/* Main Content Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-6)',
        marginBottom: 'var(--space-6)'
      }}>
        {/* Drive Information */}
        <div className="summary-card">
          <div className="card-header">
            <div className="header-left">
              {selectedDrive.privacy === 'private' ? <Lock size={20} /> : <Globe size={20} />}
              <h3>Drive Information</h3>
            </div>
          </div>

          <div className="drive-metadata">
            <div className="metadata-row">
              <span className="metadata-label">Drive Name</span>
              <span className="metadata-value">{selectedDrive.name}</span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Privacy</span>
              <span className="metadata-value">
                {selectedDrive.privacy === 'private' ? '🔒 Private' : '🌐 Public'}
              </span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Drive ID</span>
              <div className="metadata-value drive-id">
                <span>{selectedDrive.id}</span>
                <button 
                  className="icon-button"
                  onClick={() => copyToClipboard(selectedDrive.id)}
                  title="Copy Drive ID"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>

            {selectedDrive.dateCreated && (
              <div className="metadata-row">
                <span className="metadata-label">Created</span>
                <span className="metadata-value">{formatDate(new Date(selectedDrive.dateCreated))}</span>
              </div>
            )}

            <div className="metadata-row">
              <span className="metadata-label">Size</span>
              <span className="metadata-value">
                {loading ? '...' : formatFileSize(driveStats?.totalSize || 0)}
              </span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Contains</span>
              <span className="metadata-value">
                {loading ? '...' : formatContains(driveStats?.folderCount || 0, driveStats?.fileCount || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="summary-card">
          <div className="card-header">
            <div className="header-left">
              <Zap size={20} />
              <h3>Quick Actions</h3>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <button 
              className="button large"
              onClick={async () => {
                if (config.syncFolder) {
                  await window.electronAPI.shell.openPath(config.syncFolder);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <FolderOpen size={16} />
              Open Sync Folder
            </button>

            <button 
              className="button outline large"
              onClick={() => {
                // Open drive in ArDrive web app
                const encodedName = encodeURIComponent(selectedDrive.name);
                const driveUrl = `https://app.ardrive.io/#/drives/${selectedDrive.id}?name=${encodedName}`;
                window.electronAPI.shell.openExternal(driveUrl);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <ExternalLink size={16} />
              View Drive Online
            </button>

            <button 
              className="button outline large"
              onClick={exportDriveMetadata}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <FileDown size={16} />
              Export Metadata
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};