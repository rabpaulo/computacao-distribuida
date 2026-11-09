import React, { useMemo, useState } from 'react';
import { api } from '../services/api';
import { Payment, PaymentMethod } from '../types';
import {
  X,
  Wallet,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  CreditCard,
  QrCode,
  FileText,
  Copy,
} from 'lucide-react';

interface PayPalCheckoutModalProps {
  orderId: string;
  amount: number;
  paypalOrderId: string | null;
  onClose: () => void;
  onDone: (payment: Payment) => void;
}

const METHODS: Array<{ id: PaymentMethod; label: string; icon: React.ReactNode }> = [
  { id: 'PAYPAL', label: 'PayPal', icon: <Wallet size={15} /> },
  { id: 'CREDIT_CARD', label: 'Crédito', icon: <CreditCard size={15} /> },
  { id: 'DEBIT_CARD', label: 'Débito', icon: <CreditCard size={15} /> },
  { id: 'PIX', label: 'Pix', icon: <QrCode size={15} /> },
  { id: 'BOLETO', label: 'Boleto', icon: <FileText size={15} /> },
];

const digitsOnly = (v: string) => v.replace(/\D/g, '');
const formatCardNumber = (v: string) =>
  digitsOnly(v).slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
const formatExpiry = (v: string) => {
  const d = digitsOnly(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

// Valida so o formato (16 digitos, validade futura, CVV 3 digitos). Nada daqui
// e enviado ao servidor: o back-end recebe apenas o metodo escolhido.
function validateCard(number: string, name: string, expiry: string, cvv: string): string | null {
  if (digitsOnly(number).length !== 16) return 'O número do cartão deve ter 16 dígitos.';
  if (name.trim().length < 3) return 'Informe o nome impresso no cartão.';
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!m) return 'Validade inválida. Use MM/AA.';
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return 'Mês de validade inválido.';
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return 'Cartão vencido.';
  }
  if (digitsOnly(cvv).length !== 3) return 'O CVV deve ter 3 dígitos.';
  return null;
}

// Tela de pagamento SIMULADA. Nenhum meio e real: tudo passa pelo paypal-mock,
// sem dinheiro e sem enviar dados do comprador (cartao, CPF etc.) ao servidor.
export const PayPalCheckoutModal: React.FC<PayPalCheckoutModalProps> = ({
  orderId,
  amount,
  paypalOrderId,
  onClose,
  onDone,
}) => {
  const [method, setMethod] = useState<PaymentMethod>('PAYPAL');
  const [busy, setBusy] = useState<null | 'APPROVE' | 'DECLINE' | 'CANCEL'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  const isCard = method === 'CREDIT_CARD' || method === 'DEBIT_CARD';

  // Codigos de mentira, estaveis por pedido
  const seed = useMemo(() => digitsOnly(orderId.replace(/[a-f]/gi, (c) => String(c.charCodeAt(0) % 10))), [orderId]);
  const pixCode = useMemo(
    () => `00020126580014BR.GOV.BCB.PIX0136simulado-${orderId}5204000053039865802BR5911DISTRICOMM6009SAO PAULO`,
    [orderId]
  );
  const boletoLine = useMemo(() => {
    const d = (seed + '0'.repeat(47)).slice(0, 47);
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33, 47)}`;
  }, [seed]);
  const boletoDue = useMemo(() => {
    const dt = new Date();
    dt.setDate(dt.getDate() + 3);
    return dt.toLocaleDateString('pt-BR');
  }, []);
  const qrCells = useMemo(
    () => Array.from({ length: 169 }, (_, i) => (Number(seed[i % Math.max(seed.length, 1)] ?? '0') * 7 + i * 13) % 5 < 2),
    [seed]
  );

  const run = async (action: 'APPROVE' | 'DECLINE' | 'CANCEL') => {
    setError(null);

    if (action === 'APPROVE' && isCard) {
      const problem = validateCard(cardNumber, cardName, cardExpiry, cardCvv);
      if (problem) {
        setError(problem);
        return;
      }
    }

    setBusy(action);
    try {
      const payment =
        action === 'CANCEL'
          ? await api.cancelPayPal(orderId)
          : await api.approvePayPal(orderId, action, method);
      onDone(payment);
    } catch (err: any) {
      // Ex.: 503 com o circuit breaker do gateway aberto
      setError(err.message || 'Falha ao processar o pagamento');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponivel: o texto continua visivel na tela */
    }
  };

  const formatted = amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  const approveLabel: Record<PaymentMethod, string> = {
    PAYPAL: `Aprovar pagamento de R$ ${formatted}`,
    CREDIT_CARD: `Pagar R$ ${formatted} no crédito`,
    DEBIT_CARD: `Pagar R$ ${formatted} no débito`,
    PIX: 'Simular pagamento do Pix',
    BOLETO: 'Simular pagamento do boleto',
  };

  return (
    <div className="modal-backdrop paypal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-card paypal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Wallet size={18} />
            <h2>Pagamento</h2>
            <span className="sandbox-tag">SIMULADO</span>
          </div>
          <button className="btn-close" onClick={onClose} disabled={!!busy} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="paypal-body">
          <p className="paypal-disclaimer">
            Ambiente de demonstração. Nenhum pagamento real é feito e nenhum dado de cartão é enviado ou armazenado.
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

          <div className="pay-methods" role="tablist" aria-label="Forma de pagamento">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={method === m.id}
                className={`pay-method${method === m.id ? ' active' : ''}`}
                disabled={!!busy}
                onClick={() => {
                  setMethod(m.id);
                  setError(null);
                }}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {method === 'PAYPAL' && (
            <div className="paypal-account">
              <ShieldCheck size={14} />
              <span>Conta de teste: comprador@sandbox.districommerce.test</span>
            </div>
          )}

          {isCard && (
            <div className="pay-form">
              <label>
                Número do cartão (16 dígitos)
                <input
                  className="pay-input mono"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0000 0000 0000 0000"
                  value={cardNumber}
                  maxLength={19}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                />
              </label>
              <label>
                Nome impresso no cartão
                <input
                  className="pay-input"
                  autoComplete="off"
                  placeholder="NOME COMO NO CARTÃO"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value.toUpperCase())}
                />
              </label>
              <div className="pay-row">
                <label>
                  Validade
                  <input
                    className="pay-input mono"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="MM/AA"
                    value={cardExpiry}
                    maxLength={5}
                    onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                  />
                </label>
                <label>
                  CVV
                  <input
                    className="pay-input mono"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="123"
                    value={cardCvv}
                    maxLength={3}
                    onChange={(e) => setCardCvv(digitsOnly(e.target.value).slice(0, 3))}
                  />
                </label>
              </div>
            </div>
          )}

          {method === 'PIX' && (
            <div className="pay-pix">
              <div className="pay-qr" aria-label="QR Code Pix simulado">
                {qrCells.map((on, i) => (
                  <i key={i} className={on ? 'on' : ''} />
                ))}
              </div>
              <div className="pay-code-box">
                <span className="paypal-label">Pix copia e cola (simulado)</span>
                <code className="pay-code">{pixCode}</code>
                <button type="button" className="btn-copy" onClick={() => copy(pixCode)}>
                  <Copy size={13} /> {copied ? 'Copiado!' : 'Copiar código'}
                </button>
              </div>
            </div>
          )}

          {method === 'BOLETO' && (
            <div className="pay-boleto">
              <div>
                <span className="paypal-label">Vencimento</span>
                <strong>{boletoDue}</strong>
              </div>
              <div>
                <span className="paypal-label">Linha digitável (simulada)</span>
                <code className="pay-code">{boletoLine}</code>
              </div>
              <button type="button" className="btn-copy" onClick={() => copy(boletoLine)}>
                <Copy size={13} /> {copied ? 'Copiado!' : 'Copiar linha digitável'}
              </button>
            </div>
          )}

          {error && (
            <div className="alert-error paypal-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="paypal-actions">
            <button className="btn-paypal" disabled={!!busy} onClick={() => run('APPROVE')}>
              {busy === 'APPROVE' ? <Loader2 size={16} className="spin-animation" /> : null}
              {approveLabel[method]}
            </button>
            <button className="btn-cancel" disabled={!!busy} onClick={() => run('DECLINE')}>
              {busy === 'DECLINE' ? <Loader2 size={14} className="spin-animation" /> : null}
              Simular pagamento recusado
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
