import React, { useEffect, useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert } from 'lucide-react';

export const SecurityStatus: React.FC = () => {
  const [keychainAvailable, setKeychainAvailable] = useState<boolean | null>(null);
  const [securityMethod, setSecurityMethod] = useState<'keychain' | 'fallback' | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    checkSecurityStatus();
  }, []);

  const checkSecurityStatus = async () => {
    try {
      const available = await window.electronAPI.security.isKeychainAvailable();
      const method = await window.electronAPI.security.getMethod();
      setKeychainAvailable(available);
      setSecurityMethod(method);
    } catch (error) {
      console.error('Failed to check security status:', error);
      setKeychainAvailable(false);
      setSecurityMethod('fallback');
    }
  };

  if (keychainAvailable === null) return null;

  const getSecurityInfo = () => {
    if (keychainAvailable && securityMethod === 'keychain') {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes('mac')) {
        return {
          icon: <ShieldCheck className="text-green-600" size={20} />,
          title: 'macOS Keychain Active',
          description: 'Your password is protected by Touch ID and macOS Keychain',
          color: 'text-green-700'
        };
      } else if (platform.includes('win')) {
        return {
          icon: <ShieldCheck className="text-green-600" size={20} />,
          title: 'Windows Credential Manager Active',
          description: 'Your password is protected by Windows Hello and Credential Manager',
          color: 'text-green-700'
        };
      } else {
        return {
          icon: <ShieldCheck className="text-green-600" size={20} />,
          title: 'OS Keychain Active',
          description: 'Your password is protected by your system keychain',
          color: 'text-green-700'
        };
      }
    } else {
      return {
        icon: <Shield className="text-gray-600" size={20} />,
        title: 'Standard Security',
        description: 'Your password is encrypted in memory during your session',
        color: 'text-gray-700'
      };
    }
  };

  const info = getSecurityInfo();

  return (
    <div className="security-status">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
        title="Click for security details"
      >
        {info.icon}
        <span className={info.color}>{info.title}</span>
      </button>
      
      {showDetails && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm">
          <p className="text-gray-600 mb-2">{info.description}</p>
          
          {keychainAvailable && securityMethod === 'keychain' && (
            <div className="text-xs text-gray-500">
              <p>Benefits of OS keychain integration:</p>
              <ul className="list-disc list-inside mt-1">
                <li>Biometric authentication support</li>
                <li>Hardware-backed security</li>
                <li>Automatic lock with system</li>
                <li>No password in application memory</li>
              </ul>
            </div>
          )}
          
          {(!keychainAvailable || securityMethod === 'fallback') && (
            <div className="text-xs text-gray-500">
              <p className="mt-2">
                To enable enhanced security, ensure you have the latest version 
                with keychain support installed.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};