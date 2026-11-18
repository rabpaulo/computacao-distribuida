import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { AppNotification } from '../types';

interface NotificationBellProps {
  // Clicar numa notificação de pedido abre "Meus pedidos"
  onOpenOrders: () => void;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'agora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export const LevelIcon: React.FC<{ level: AppNotification['level']; size?: number }> = ({
  level,
  size = 16,
}) => {
  if (level === 'success') return <CheckCircle2 size={size} />;
  if (level === 'error') return <XCircle size={size} />;
  return <Info size={size} />;
};

export const NotificationBell: React.FC<NotificationBellProps> = ({ onOpenOrders }) => {
  const { notifications, unreadCount, connected, markRead, markAllRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const handleItemClick = (notification: AppNotification) => {
    void markRead(notification.id);
    if (notification.order_id) {
      setIsOpen(false);
      onOpenOrders();
    }
  };

  return (
    <div className="notif-wrapper" ref={containerRef}>
      <button
        className="btn-icon-action notif-bell"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={
          unreadCount > 0 ? `Notificações, ${unreadCount} não lida(s)` : 'Notificações'
        }
        title="Notificações"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notif-panel" role="dialog" aria-label="Notificações">
          <div className="notif-panel-header">
            <div className="notif-title-row">
              <h3>Notificações</h3>
              <span
                className={`notif-live ${connected ? 'on' : 'off'}`}
                title={connected ? 'Recebendo em tempo real' : 'Reconectando...'}
              >
                <span className="notif-live-dot" />
                {connected ? 'Ao vivo' : 'Reconectando'}
              </span>
            </div>
            <button
              className="notif-markall"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={14} /> Marcar todas como lidas
            </button>
          </div>

          <ul className="notif-list">
            {notifications.length === 0 && (
              <li className="notif-empty">
                Nenhuma notificação por enquanto. Quando um pedido mudar de status, você é avisado aqui.
              </li>
            )}

            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  className={`notif-item ${notification.read_at ? '' : 'unread'}`}
                  onClick={() => handleItemClick(notification)}
                >
                  <span className={`notif-icon level-${notification.level}`}>
                    <LevelIcon level={notification.level} />
                  </span>
                  <span className="notif-body">
                    <span className="notif-item-title">{notification.title}</span>
                    <span className="notif-item-message">{notification.message}</span>
                    <span className="notif-item-time">{timeAgo(notification.created_at)}</span>
                  </span>
                  {!notification.read_at && <span className="notif-unread-dot" aria-label="Não lida" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
