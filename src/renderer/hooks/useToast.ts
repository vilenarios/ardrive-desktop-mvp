import { useState, useCallback } from 'react';
import { Toast, ToastType } from '../components/ToastNotification';

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, title: string, message?: string, duration?: number) => {
    const id = Date.now().toString();
    const newToast: Toast = {
      id,
      type,
      title,
      message,
      duration
    };

    setToasts((prev) => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const toast = {
    success: (title: string, message?: string, duration?: number) => 
      showToast('success', title, message, duration),
    error: (title: string, message?: string, duration?: number) => 
      showToast('error', title, message, duration),
    info: (title: string, message?: string, duration?: number) => 
      showToast('info', title, message, duration),
    warning: (title: string, message?: string, duration?: number) => 
      showToast('warning', title, message, duration),
  };

  return {
    toasts,
    toast,
    removeToast
  };
};