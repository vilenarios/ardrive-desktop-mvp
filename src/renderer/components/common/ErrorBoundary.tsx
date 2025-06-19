import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Report error to main process for logging
    if (window.electronAPI?.error?.reportError) {
      window.electronAPI.error.reportError({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack || undefined,
        timestamp: new Date().toISOString()
      });
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-icon">
              <AlertTriangle size={48} />
            </div>
            
            <h1>Something went wrong</h1>
            <p>An unexpected error occurred in the application. This has been automatically reported.</p>
            
            <div className="error-actions">
              <button className="error-button primary" onClick={this.handleReset}>
                <RefreshCw size={16} />
                Try Again
              </button>
              
              <button className="error-button secondary" onClick={this.handleReload}>
                <Home size={16} />
                Reload App
              </button>
            </div>

            {/* Show error details in development */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-details">
                <summary>
                  <Bug size={16} />
                  Error Details (Development Only)
                </summary>
                <div className="error-stack">
                  <h3>Error:</h3>
                  <pre>{this.state.error.message}</pre>
                  
                  <h3>Stack Trace:</h3>
                  <pre>{this.state.error.stack}</pre>
                  
                  {this.state.errorInfo && (
                    <>
                      <h3>Component Stack:</h3>
                      <pre>{this.state.errorInfo.componentStack}</pre>
                    </>
                  )}
                </div>
              </details>
            )}
          </div>

          <style>{`
            .error-boundary {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              padding: var(--space-8);
              background: var(--gray-50);
            }

            .error-boundary-content {
              max-width: 500px;
              text-align: center;
              background: white;
              padding: var(--space-8);
              border-radius: var(--radius-lg);
              box-shadow: var(--shadow-lg);
            }

            .error-icon {
              color: var(--red-500);
              margin-bottom: var(--space-4);
            }

            .error-boundary h1 {
              margin: 0 0 var(--space-3) 0;
              font-size: var(--text-2xl);
              font-weight: 600;
              color: var(--gray-900);
            }

            .error-boundary p {
              margin: 0 0 var(--space-6) 0;
              color: var(--gray-600);
              line-height: 1.5;
            }

            .error-actions {
              display: flex;
              gap: var(--space-3);
              justify-content: center;
              margin-bottom: var(--space-6);
            }

            .error-button {
              display: flex;
              align-items: center;
              gap: var(--space-2);
              padding: var(--space-3) var(--space-4);
              border: none;
              border-radius: var(--radius-md);
              font-size: var(--text-sm);
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s ease;
            }

            .error-button.primary {
              background: var(--ardrive-primary);
              color: white;
            }

            .error-button.primary:hover {
              background: var(--ardrive-primary-dark);
            }

            .error-button.secondary {
              background: var(--gray-100);
              color: var(--gray-700);
              border: 1px solid var(--gray-300);
            }

            .error-button.secondary:hover {
              background: var(--gray-200);
            }

            .error-details {
              text-align: left;
              margin-top: var(--space-6);
              padding: var(--space-4);
              background: var(--gray-100);
              border-radius: var(--radius-md);
              border: 1px solid var(--gray-300);
            }

            .error-details summary {
              display: flex;
              align-items: center;
              gap: var(--space-2);
              font-weight: 500;
              cursor: pointer;
              margin-bottom: var(--space-3);
            }

            .error-details summary:hover {
              color: var(--ardrive-primary);
            }

            .error-stack h3 {
              margin: var(--space-4) 0 var(--space-2) 0;
              font-size: var(--text-sm);
              font-weight: 600;
              color: var(--gray-800);
            }

            .error-stack h3:first-child {
              margin-top: 0;
            }

            .error-stack pre {
              background: var(--gray-900);
              color: var(--gray-100);
              padding: var(--space-3);
              border-radius: var(--radius-sm);
              font-size: var(--text-xs);
              overflow-x: auto;
              white-space: pre-wrap;
              word-break: break-word;
            }

            /* Mobile responsive */
            @media (max-width: 640px) {
              .error-boundary {
                padding: var(--space-4);
              }

              .error-boundary-content {
                padding: var(--space-6);
              }

              .error-actions {
                flex-direction: column;
              }

              .error-button {
                width: 100%;
                justify-content: center;
              }
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

// Convenience wrapper for common use cases
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorFallback?: ReactNode
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary fallback={errorFallback}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
};