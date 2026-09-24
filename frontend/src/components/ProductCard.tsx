import React from 'react';
import { Product } from '../types';
import { useCart } from '../context/CartContext';
import { ShoppingCart } from 'lucide-react';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { addToCart } = useCart();
  const isOutOfStock = product.stock <= 0;

  const imageUrl =
    product.images && product.images.length > 0 && product.images[0]
      ? product.images[0]
      : 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80';

  return (
    <div className="product-card">
      <div className="product-image-container">
        <img
          src={imageUrl}
          alt={product.name}
          className="product-image"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80';
          }}
        />
        <span className="product-category-badge">{product.category}</span>
        {isOutOfStock && <div className="out-of-stock-overlay">Esgotado</div>}
      </div>

      <div className="product-info">
        <h3 className="product-title" title={product.name}>
          {product.name}
        </h3>
        <p className="product-description">{product.description}</p>

        <div className="product-stock-info">
          <span className={`stock-dot ${isOutOfStock ? 'out' : ''}`}></span>
          <span>
            {isOutOfStock ? (
              <span className="text-danger">Sem estoque</span>
            ) : (
              `Em estoque (${product.stock} un.)`
            )}
          </span>
        </div>

        <div className="product-footer">
          <div className="product-price">
            <span className="currency">R$</span>
            <span className="amount">
              {product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <button
            className={`btn-add-cart ${isOutOfStock ? 'disabled' : ''}`}
            onClick={() => addToCart(product)}
            disabled={isOutOfStock}
            aria-label={`Adicionar ${product.name} ao carrinho`}
          >
            <ShoppingCart size={14} />
            <span>Adicionar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
