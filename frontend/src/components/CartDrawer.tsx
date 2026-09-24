import React, { useState } from 'react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { X, Trash2, Plus, Minus, ShoppingBag, CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

interface CartDrawerProps {
  onOpenAuth: () => void;
  onOrderCompleted: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({ onOpenAuth, onOrderCompleted }) => {
  const { isCartOpen, setIsCartOpen, items, updateQuantity, removeFromCart, clearCart, totalAmount, totalCount } = useCart();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isCartOpen) return null;

  const handleCheckout = async () => {
    setErrorMessage(null);
    if (!user) {
      setIsCartOpen(false);
      onOpenAuth();
      return;
    }

    if (items.length === 0) return;

    setIsSubmitting(true);
    try {
      const orderPayload = items.map((it) => ({
        productId: it.product.id,
        productName: it.product.name,
        price: it.product.price,
        quantity: it.quantity,
      }));

      const createdOrder = await api.createOrder(orderPayload);
      setOrderSuccess(`Pedido #${createdOrder.id.slice(0, 8)} confirmado com sucesso!`);
      clearCart();
      onOrderCompleted();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao processar checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cart-drawer-backdrop" onClick={() => setIsCartOpen(false)}>
      <div className="cart-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cart-header">
          <div className="cart-header-title">
            <ShoppingBag size={18} />
            <h2>Carrinho de Compras</h2>
            {totalCount > 0 && <span className="cart-badge">{totalCount}</span>}
          </div>
          <button className="btn-close" onClick={() => setIsCartOpen(false)} aria-label="Fechar carrinho">
            <X size={18} />
          </button>
        </div>

        {orderSuccess ? (
          <div className="cart-success-view">
            <CheckCircle2 size={44} className="text-success" />
            <h3>Compra Confirmada</h3>
            <p>{orderSuccess}</p>
            <p className="subtext">
              Transação persistida no PostgreSQL com atualização de estoque no MongoDB.
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                setOrderSuccess(null);
                setIsCartOpen(false);
              }}
            >
              Continuar Comprando
            </button>
          </div>
        ) : (
          <>
            <div className="cart-items-list">
              {errorMessage && (
                <div className="alert-error">
                  <AlertCircle size={15} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {items.length === 0 ? (
                <div className="cart-empty">
                  <ShoppingBag size={40} className="empty-icon" />
                  <p>Seu carrinho está vazio</p>
                  <span>Explore o catálogo para adicionar produtos de alta performance.</span>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.product.id} className="cart-item">
                    <img
                      src={
                        item.product.images?.[0] ||
                        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80'
                      }
                      alt={item.product.name}
                      className="cart-item-image"
                    />
                    <div className="cart-item-details">
                      <h4>{item.product.name}</h4>
                      <div className="cart-item-price">
                        R$ {(item.product.price * item.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>

                      <div className="cart-item-controls">
                        <div className="quantity-stepper">
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                            aria-label="Diminuir quantidade"
                          >
                            <Minus size={13} />
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                            disabled={item.quantity >= item.product.stock}
                            aria-label="Aumentar quantidade"
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <button
                          className="btn-remove"
                          onClick={() => removeFromCart(item.product.id)}
                          aria-label="Remover item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="cart-footer">
                <div className="cart-subtotal">
                  <span>Total do Pedido:</span>
                  <strong className="cart-total-value">
                    R$ {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </strong>
                </div>

                <button
                  className="btn-checkout"
                  onClick={handleCheckout}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="spin-animation" /> Finalizando Pedido...
                    </>
                  ) : user ? (
                    <>
                      <span>Finalizar Compra</span>
                      <ArrowRight size={16} />
                    </>
                  ) : (
                    'Entrar para Finalizar Compra'
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
