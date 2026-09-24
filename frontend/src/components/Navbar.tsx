import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { ShoppingCart, User as UserIcon, LogOut, Plus, Search, Shield, Package } from 'lucide-react';

interface NavbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onOpenAuth: () => void;
  onOpenCreateProduct: () => void;
  onOpenOrders: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchTerm,
  onSearchChange,
  onOpenAuth,
  onOpenCreateProduct,
  onOpenOrders,
}) => {
  const { user, isAdmin, logout } = useAuth();
  const { totalCount, setIsCartOpen } = useCart();

  return (
    <header className="navbar-container">
      <div className="navbar-content">
        {/* Brand / Logo */}
        <div className="navbar-brand">
          <div className="logo-icon-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div className="brand-text">
            <h1 className="brand-title">
              DISTRI<span className="brand-accent">COMMERCE</span>
            </h1>
            <span className="brand-badge">Cluster v1.0 • Distribuído</span>
          </div>
        </div>

        {/* Busca com Debounce/Instantânea */}
        <div className="navbar-search">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por categoria, modelo ou especificação..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchTerm && (
            <button className="btn-clear-search" onClick={() => onSearchChange('')} aria-label="Limpar busca">
              ✕
            </button>
          )}
        </div>

        {/* Ações da Direita */}
        <div className="navbar-actions">
          {/* Botão Admin para criar produtos */}
          {isAdmin && (
            <button className="btn-admin-action" onClick={onOpenCreateProduct}>
              <Plus size={15} />
              <span>Novo Produto</span>
            </button>
          )}

          {/* Pedidos para usuários autenticados */}
          {user && (
            <button className="btn-icon-action" onClick={onOpenOrders} title="Meus Pedidos">
              <Package size={17} />
              <span className="action-label">Pedidos</span>
            </button>
          )}

          {/* Botão do Carrinho */}
          <button
            className="btn-cart"
            onClick={() => setIsCartOpen(true)}
            aria-label="Abrir Carrinho"
          >
            <ShoppingCart size={17} />
            <span className="cart-label">Carrinho</span>
            {totalCount > 0 && <span className="cart-badge">{totalCount}</span>}
          </button>

          {/* Autenticação / Perfil */}
          {user ? (
            <div className="user-profile-menu">
              <div className="user-avatar-initial">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">{user.name.split(' ')[0]}</span>
                {isAdmin ? (
                  <span className="role-tag admin">
                    <Shield size={10} /> Admin
                  </span>
                ) : (
                  <span className="role-tag client">Cliente</span>
                )}
              </div>
              <button className="btn-logout" onClick={logout} title="Sair da conta">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button className="btn-login" onClick={onOpenAuth}>
              <UserIcon size={16} />
              <span>Entrar / Cadastrar</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
