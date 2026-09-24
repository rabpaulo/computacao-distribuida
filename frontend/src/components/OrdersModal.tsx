import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Order } from '../types';
import { X, Package, Calendar, Loader2, CheckCircle2 } from 'lucide-react';

interface OrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OrdersModal: React.FC<OrdersModalProps> = ({ isOpen, onClose }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadOrders();
    }
  }, [isOpen]);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const data = await api.getMyOrders();
      setOrders(data || []);
    } catch (err) {
      console.error('Erro ao carregar pedidos:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

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
                    <span className={`status-badge status-${order.status.toLowerCase()}`}>
                      <CheckCircle2 size={12} /> {order.status === 'CONFIRMED' ? 'Confirmado' : order.status}
                    </span>
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
          )}
        </div>
      </div>
    </div>
  );
};
