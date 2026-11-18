import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Toast, useNotifications } from '../context/NotificationContext';
import { LevelIcon } from './NotificationBell';

// Some sozinho depois de alguns segundos
const TOAST_DURATION_MS = 6000;

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast level-${toast.level}`}>
      <span className="toast-icon">
        <LevelIcon level={toast.level} size={18} />
      </span>
      <div className="toast-body">
        <strong>{toast.title}</strong>
        <span>{toast.message}</span>
      </div>
      <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Fechar aviso">
        <X size={14} />
      </button>
    </div>
  );
};

// aria-live: leitores de tela anunciam o aviso novo sem tirar o foco de onde o usuário está
export const ToastStack: React.FC = () => {
  const { toasts, dismissToast } = useNotifications();

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
};
