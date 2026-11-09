import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { Order, Payment, Shipment } from '../types';
import { X, Package, Calendar, Loader2, CheckCircle2, Clock, XCircle, Wallet } from 'lucide-react';
import { PayPalCheckoutModal } from './PayPalCheckoutModal';
import { ShipmentTracker } from './ShipmentTracker';

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

const StatusBadge: React.FC<{ status: Order['status']; awaitingPayer?: boolean }> = ({ status, awaitingPayer }) => {
  if (awaitingPayer) {
    return (
      <span className="status-badge status-pending">
        <Wallet size={12} /> Aguardando pagamento
      </span>
    );
  }

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
  const [payments, setPayments] = useState<Record<string, Payment>>({});
  const [shipments, setShipments] = useState<Record<string, Shipment>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [checkoutOrder, setCheckoutOrder] = useState<Order | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    // Reconsulta enquanto houver algo andando: pedido PENDING (pagamento
    // pela fila) ou entrega ainda nao concluida (telemetria MQTT).
    const load = async (showSpinner: boolean) => {
      if (showSpinner) setIsLoading(true);

      try {
        // Pagamentos e entregas sao best-effort: se o servico estiver fora,
        // o historico de pedidos continua aparecendo.
        const [data, paymentList, shipmentList] = await Promise.all([
          api.getMyOrders(),
          api.getMyPayments().catch(() => [] as Payment[]),
          api.getMyShipments().catch(() => [] as Shipment[]),
        ]);
        if (cancelled) return;

        const list = data || [];
        setOrders(list);
        setPayments(Object.fromEntries(paymentList.map((p) => [p.order_id, p])));
        const shipmentMap = Object.fromEntries(shipmentList.map((s) => [s.order_id, s]));
        setShipments(shipmentMap);

        const active = list.some(
          (order) =>
            order.status === 'PENDING' ||
            (order.status === 'CONFIRMED' && shipmentMap[order.id]?.status !== 'DELIVERED')
        );
        if (active) {
          pollTimer.current = setTimeout(() => load(false), POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.error('Erro ao carregar pedidos:', err);
      } finally {
        if (!cancelled && showSpinner) setIsLoading(false);
      }
    };

    void load(reloadKey === 0);

    return () => {
      cancelled = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [isOpen, reloadKey]);

  if (!isOpen) return null;

  const awaitingPayer = (order: Order) =>
    order.status === 'PENDING' && payments[order.id]?.status === 'PENDING_APPROVAL';
  const pendingCount = orders.filter((order) => order.status === 'PENDING' && !awaitingPayer(order)).length;

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
                      <StatusBadge status={order.status} awaitingPayer={awaitingPayer(order)} />
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

                    {awaitingPayer(order) && (
                      <button className="btn-paypal btn-paypal-inline" onClick={() => setCheckoutOrder(order)}>
                        <Wallet size={15} /> Pagar pedido
                      </button>
                    )}

                    {order.status === 'CANCELLED' && payments[order.id]?.reason && (
                      <p className="order-reason">Motivo: {payments[order.id].reason}</p>
                    )}

                    {order.status === 'CONFIRMED' && <ShipmentTracker shipment={shipments[order.id]} />}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {checkoutOrder && (
        <div onClick={(e) => e.stopPropagation()}>
          <PayPalCheckoutModal
            orderId={checkoutOrder.id}
            amount={checkoutOrder.total_amount}
            paypalOrderId={payments[checkoutOrder.id]?.paypal_order_id ?? null}
            onClose={() => setCheckoutOrder(null)}
            onDone={(payment) => {
              setPayments((prev) => ({ ...prev, [payment.order_id]: payment }));
              setCheckoutOrder(null);
              // Reabre o ciclo de polling para ver o pedido mudar de status
              setReloadKey((k) => k + 1);
            }}
          />
        </div>
      )}
    </div>
  );
};
