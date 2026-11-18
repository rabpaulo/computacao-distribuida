import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, openNotificationStream } from '../services/api';
import { AppNotification } from '../types';
import { useAuth } from './AuthContext';

export interface Toast {
  id: string;
  title: string;
  message: string;
  level: AppNotification['level'];
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  toasts: Toast[];
  // Conexão em tempo real aberta (false = tentando reconectar)
  connected: boolean;
  // Muda a cada notificação que chega: quem exibe dados do pedido usa para atualizar na hora
  lastEventAt: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Quantas notificações ficam em memória no navegador
const MAX_KEPT = 50;
const MAX_TOASTS = 4;

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, logout } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState(0);

  // Ids já vistos: a mesma notificação pode chegar pelo stream e pela listagem
  const knownIds = useRef(new Set<string>());
  // O handler do stream vive mais que cada render; a ref evita usar um logout velho
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  // Cópia da lista atual para os callbacks lerem sem depender do render
  const notificationsRef = useRef<AppNotification[]>([]);
  notificationsRef.current = notifications;

  useEffect(() => {
    if (!token) {
      knownIds.current = new Set();
      setNotifications([]);
      setUnreadCount(0);
      setToasts([]);
      setConnected(false);
      return;
    }

    let active = true;

    // Sincroniza com o servidor. Roda ao abrir o canal e depois de cada
    // reconexão, o que recupera tudo que chegou enquanto o navegador estava offline.
    const sync = async () => {
      try {
        const data = await api.getNotifications(30);
        if (!active) return;
        knownIds.current = new Set(data.notifications.map((n) => n.id));
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      } catch (err) {
        console.warn('Não foi possível carregar as notificações:', err);
      }
    };

    const stop = openNotificationStream(token, {
      onReady: () => void sync(),
      onNotification: (notification) => {
        if (!active || knownIds.current.has(notification.id)) return;
        knownIds.current.add(notification.id);

        setNotifications((prev) => [notification, ...prev].slice(0, MAX_KEPT));
        setUnreadCount((count) => count + 1);
        setLastEventAt(Date.now());
        setToasts((prev) =>
          [
            ...prev,
            {
              id: notification.id,
              title: notification.title,
              message: notification.message,
              level: notification.level,
            },
          ].slice(-MAX_TOASTS)
        );
      },
      onAuthError: () => {
        if (active) logoutRef.current();
      },
      onStatusChange: (isConnected) => {
        if (active) setConnected(isConnected);
      },
    });

    return () => {
      active = false;
      stop();
    };
  }, [token]);

  const markRead = useCallback(async (id: string) => {
    // Decide pelo valor atual (ref): o updater do setState roda depois, não dá para
    // usá-lo para descobrir se a notificação estava mesmo não lida.
    const target = notificationsRef.current.find((n) => n.id === id);
    if (!target || target.read_at) return;

    setNotifications((prev) =>
      prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n))
    );
    setUnreadCount((count) => Math.max(0, count - 1));

    try {
      await api.markNotificationRead(id);
    } catch (err) {
      console.warn(err);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnreadCount(0);

    try {
      await api.markAllNotificationsRead();
    } catch (err) {
      console.warn(err);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        toasts,
        connected,
        lastEventAt,
        markRead,
        markAllRead,
        dismissToast,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications deve ser utilizado dentro de NotificationProvider');
  return ctx;
};
