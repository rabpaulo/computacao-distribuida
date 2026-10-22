import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { Order } from '../types';
import { X, Package, Calendar, Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface OrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// De quanto em quanto tempo reconsulta enquanto tiver pedido pendente
const POLL_INTERVAL_MS = 3000;

const STATUS_LABEL: Record<Order['status'], string> = {
  PENDING: 'Processando pagamento',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Pagamento recusado',
};

const StatusBadge: React.FC<{ status: Order['status'] }> = ({ status }) => {
  const icon =
    status === 'CONFIRMED' ? (
      <CheckCircle2 size={12} />
    ) : status === 'CANCELLED' ? (
      <XCircle size={12} />
    ) : (
      <Clock size={12} className="spin-animation" />
    );

  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {icon} {STATUS_LABEL[status]}
    </span>
  );
};

export const OrdersModal: React.FC<OrdersModalProps> = ({ isOpen, onClose }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    // Enquanto sobrar pedido em PENDING, reconsulta. O status so muda
    // quando o payments-service responder pela fila, bem depois do checkout.
    const load = async (showSpinner: boolean) => {
      if (showSpinner) setIsLoading(true);

      try {
        const data = await api.getMyOrders();
        if (cancelled) return;

        const list = data || [];
        setOrders(list);

        if (list.some((order) => order.status === 'PENDING')) {
          pollTimer.current = setTimeout(() => load(false), POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.error('Erro ao carregar pedidos:', err);
      } finally {
        if (!cancelled && showSpinner) setIsLoading(false);
      }
    };

    void load(true);

    return () => {
      cancelled = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const pendingCount = orders.filter((order) => order.status === 'PENDING').length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Package size={18} />
            <h2>Histórico de Pedidos</h2>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Fechar histórico">
            <X size={18} />
          </button>
        </div>

        <div className="orders-content">
          {isLoading ? (
            <div className="loading-state">
              <Loader2 size={28} className="spin-animation" />
              <p>Carregando histórico de pedidos...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="empty-state">
              <Package size={36} className="empty-icon" />
              <p>Nenhum pedido realizado até o momento.</p>
            </div>
          ) : (
            <>
              {pendingCount > 0 && (
                <div className="orders-async-notice">
                  <Loader2 size={14} className="spin-animation" />
                  <span>
                    {pendingCount === 1
                      ? '1 pedido aguardando o processamento assíncrono do pagamento (RabbitMQ).'
                      : `${pendingCount} pedidos aguardando o processamento assíncrono do pagamento (RabbitMQ).`}
                  </span>
                </div>
              )}

              <div className="orders-list">
                {orders.map((order) => (
                  <div key={order.id} className="order-card">
                    <div className="order-card-header">
                      <div>
                        <span className="order-id">#{order.id.slice(0, 8)}</span>
                        <div className="order-date">
                          <Calendar size={13} />
                          <span>
                            {new Date(order.created_at).toLocaleDateString('pt-BR')} às{' '}
                            {new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>

                    <div className="order-items-table">
                      {order.items?.map((it) => (
                        <div key={it.id} className="order-item-row">
                          <span>{it.quantity}x {it.product_name}</span>
                          <strong>
                            R$ {(it.price * it.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <div className="order-card-footer">
                      <span>Total da Transação:</span>
                      <strong className="order-total-amount">
                        R$ {order.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
