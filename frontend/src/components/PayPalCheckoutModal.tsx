import React, { useState } from 'react';
import { api } from '../services/api';
import { Payment } from '../types';
import { X, Wallet, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface PayPalCheckoutModalProps {
  orderId: string;
  amount: number;
  paypalOrderId: string | null;
  onClose: () => void;
  onDone: (payment: Payment) => void;
}

// Tela de aprovação SIMULADA. No PayPal real o comprador seria redirecionado
// para o site deles; aqui tudo acontece contra o paypal-mock, sem dinheiro,
// sem login e sem coletar nenhum dado do comprador.
export const PayPalCheckoutModal: React.FC<PayPalCheckoutModalProps> = ({
  orderId,
  amount,
  paypalOrderId,
  onClose,
  onDone,
}) => {
  const [busy, setBusy] = useState<null | 'APPROVE' | 'DECLINE' | 'CANCEL'>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'APPROVE' | 'DECLINE' | 'CANCEL') => {
    setBusy(action);
    setError(null);
    try {
      const payment =
        action === 'CANCEL'
          ? await api.cancelPayPal(orderId)
          : await api.approvePayPal(orderId, action);
      onDone(payment);
    } catch (err: any) {
      // Ex.: 503 com o circuit breaker do gateway aberto
      setError(err.message || 'Falha ao falar com o PayPal');
    } finally {
      setBusy(null);
    }
  };

  const formatted = amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  return (
    <div className="modal-backdrop paypal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-card paypal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Wallet size={18} />
            <h2>Checkout PayPal</h2>
            <span className="sandbox-tag">SIMULADO</span>
          </div>
          <button className="btn-close" onClick={onClose} disabled={!!busy} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="paypal-body">
          <p className="paypal-disclaimer">
            Ambiente de demonstração. Nenhum pagamento real é feito e nenhum dado é enviado ao PayPal.
          </p>

          <div className="paypal-summary">
            <div>
              <span className="paypal-label">Pedido</span>
              <strong className="mono">#{orderId.slice(0, 8)}</strong>
            </div>
            <div>
              <span className="paypal-label">Ordem PayPal</span>
              <strong className="mono">{paypalOrderId ?? '—'}</strong>
            </div>
            <div className="paypal-amount">
              <span className="paypal-label">Total</span>
              <strong>R$ {formatted}</strong>
            </div>
          </div>

          <div className="paypal-account">
            <ShieldCheck size={14} />
            <span>Conta de teste: comprador@sandbox.districommerce.test</span>
          </div>

          {error && (
            <div className="alert-error paypal-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="paypal-actions">
            <button className="btn-paypal" disabled={!!busy} onClick={() => run('APPROVE')}>
              {busy === 'APPROVE' ? <Loader2 size={16} className="spin-animation" /> : null}
              Aprovar pagamento de R$ {formatted}
            </button>
            <button className="btn-cancel" disabled={!!busy} onClick={() => run('DECLINE')}>
              {busy === 'DECLINE' ? <Loader2 size={14} className="spin-animation" /> : null}
              Simular cartão recusado
            </button>
            <button className="btn-link-danger" disabled={!!busy} onClick={() => run('CANCEL')}>
              {busy === 'CANCEL' ? <Loader2 size={14} className="spin-animation" /> : null}
              Cancelar e voltar à loja
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
