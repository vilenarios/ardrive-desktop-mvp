import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Global error handlers for the renderer process
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in renderer:', event.reason);
  
  // Report to main process if possible
  if (window.electronAPI?.error?.reportError) {
    window.electronAPI.error.reportError({
      message: `Unhandled promise rejection: ${event.reason}`,
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
  
  // Prevent the error from causing a crash
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.error('Uncaught error in renderer:', event.error);
  
  // Report to main process if possible  
  if (window.electronAPI?.error?.reportError) {
    window.electronAPI.error.reportError({
      message: `Uncaught error: ${event.error?.message || event.message}`,
      stack: event.error?.stack,
      timestamp: new Date().toISOString()
    });
  }
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);