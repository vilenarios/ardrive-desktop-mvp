import React, { useState } from 'react';
import { CheckCircle, Circle, X } from 'lucide-react';

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  category: 'onboarding' | 'dashboard' | 'sync' | 'upload' | 'general';
  completed: boolean;
}

const defaultChecklist: ChecklistItem[] = [
  // Onboarding Flow
  { id: 'onboard-1', title: 'Create New Account Flow', description: 'Test complete new user flow through all 5 steps', category: 'onboarding', completed: false },
  { id: 'onboard-2', title: 'Import Account Flow', description: 'Test import existing wallet through all 4 steps', category: 'onboarding', completed: false },
  { id: 'onboard-3', title: 'Step Navigation', description: 'Test back/forward buttons work correctly', category: 'onboarding', completed: false },
  { id: 'onboard-4', title: 'Step Indicators', description: 'Verify step indicators show correct numbers', category: 'onboarding', completed: false },
  { id: 'onboard-5', title: 'Drive Creation', description: 'Test creating new drive in onboarding', category: 'onboarding', completed: false },
  { id: 'onboard-6', title: 'Drive Selection', description: 'Test selecting existing drive', category: 'onboarding', completed: false },
  { id: 'onboard-7', title: 'Folder Selection', description: 'Test folder picker works', category: 'onboarding', completed: false },

  // Dashboard
  { id: 'dash-1', title: 'Overview Tab', description: 'Check drive info and sync status display', category: 'dashboard', completed: false },
  { id: 'dash-2', title: 'Upload Queue Tab', description: 'Verify pending uploads show correctly', category: 'dashboard', completed: false },
  { id: 'dash-3', title: 'Download Queue Tab', description: 'Check download queue functionality', category: 'dashboard', completed: false },
  { id: 'dash-4', title: 'Permaweb Tab', description: 'Test file explorer view', category: 'dashboard', completed: false },
  { id: 'dash-5', title: 'Tab Navigation', description: 'All tabs switch correctly', category: 'dashboard', completed: false },
  { id: 'dash-6', title: 'Profile Switching', description: 'Test switching between profiles', category: 'dashboard', completed: false },

  // Sync & Upload
  { id: 'sync-1', title: 'File Detection', description: 'Add files to sync folder and verify detection', category: 'sync', completed: false },
  { id: 'sync-2', title: 'Upload Approval', description: 'Test approving individual uploads', category: 'upload', completed: false },
  { id: 'sync-3', title: 'Upload Rejection', description: 'Test rejecting uploads', category: 'upload', completed: false },
  { id: 'sync-4', title: 'Batch Operations', description: 'Test approve/reject all functionality', category: 'upload', completed: false },

  // General
  { id: 'gen-1', title: 'No Demo Data', description: 'Verify no demo/mock data is visible', category: 'general', completed: false },
  { id: 'gen-2', title: 'Empty States', description: 'Check empty states look clean', category: 'general', completed: false },
  { id: 'gen-3', title: 'Error Handling', description: 'Test error scenarios gracefully handled', category: 'general', completed: false },
];

interface UATChecklistProps {
  onClose: () => void;
}

export const UATChecklist: React.FC<UATChecklistProps> = ({ onClose }) => {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(defaultChecklist);
  const [filter, setFilter] = useState<'all' | ChecklistItem['category']>('all');

  const toggleItem = (id: string) => {
    setChecklist(prev => prev.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const resetChecklist = () => {
    setChecklist(prev => prev.map(item => ({ ...item, completed: false })));
  };

  const filteredItems = filter === 'all' 
    ? checklist 
    : checklist.filter(item => item.category === filter);

  const completedCount = checklist.filter(item => item.completed).length;
  const totalCount = checklist.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  const categories = ['all', 'onboarding', 'dashboard', 'sync', 'upload', 'general'] as const;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      zIndex: 10000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '800px',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid var(--gray-200)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>
              🧪 UAT Checklist
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--gray-600)' }}>
              Progress: {completedCount}/{totalCount} ({progressPercent}%)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={resetChecklist}
              style={{
                padding: '8px 12px',
                background: 'var(--gray-100)',
                border: '1px solid var(--gray-300)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Reset All
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderRadius: '6px'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{
            width: '100%',
            height: '8px',
            background: 'var(--gray-200)',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${progressPercent}%`,
              height: '100%',
              background: progressPercent === 100 ? 'var(--success-500)' : 'var(--ardrive-primary)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{
          padding: '0 20px',
          display: 'flex',
          gap: '4px',
          borderBottom: '1px solid var(--gray-200)'
        }}>
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setFilter(category)}
              style={{
                padding: '8px 12px',
                background: filter === category ? 'var(--ardrive-primary)' : 'transparent',
                color: filter === category ? 'white' : 'var(--gray-600)',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                fontSize: '12px',
                textTransform: 'capitalize'
              }}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Checklist Items */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredItems.map(item => (
              <div
                key={item.id}
                onClick={() => toggleItem(item.id)}
                style={{
                  display: 'flex',
                  gap: '12px',
                  padding: '12px',
                  border: '1px solid var(--gray-200)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  background: item.completed ? 'var(--success-50)' : 'white'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ardrive-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--gray-200)';
                }}
              >
                {item.completed ? (
                  <CheckCircle size={20} style={{ color: 'var(--success-500)', flexShrink: 0 }} />
                ) : (
                  <Circle size={20} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: '500',
                    fontSize: '14px',
                    color: item.completed ? 'var(--success-700)' : 'var(--gray-900)',
                    textDecoration: item.completed ? 'line-through' : 'none'
                  }}>
                    {item.title}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--gray-600)',
                    marginTop: '2px'
                  }}>
                    {item.description}
                  </div>
                </div>
                <div style={{
                  fontSize: '10px',
                  color: 'var(--gray-500)',
                  textTransform: 'uppercase',
                  background: 'var(--gray-100)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  alignSelf: 'flex-start'
                }}>
                  {item.category}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};