import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { Navbar } from './components/Navbar';
import { ClusterStatus } from './components/ClusterStatus';
import { ProductGrid } from './components/ProductGrid';
import { CartDrawer } from './components/CartDrawer';
import { AuthModal } from './components/AuthModal';
import { CreateProductModal } from './components/CreateProductModal';
import { OrdersModal } from './components/OrdersModal';
import { ShieldCheck, Database, Server, Terminal, Network } from 'lucide-react';

const AppContent: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefreshProducts = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="app-container">
      {/* Barra de Status do Cluster Distribuído */}
      <ClusterStatus />

      {/* Navegação Principal */}
      <Navbar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onOpenAuth={() => setIsAuthOpen(true)}
        onOpenCreateProduct={() => setIsCreateProductOpen(true)}
        onOpenOrders={() => setIsOrdersOpen(true)}
      />

      <main className="main-content">
        {/* Hero Editorial & Architectural Blueprint */}
        <section className="hero-banner">
          <div className="hero-content">
            <div className="hero-left">
              <div className="hero-badge-wrap">
                <span className="hero-badge">
                  <span className="hero-badge-dot"></span>
                  CLUSTER OPERACIONAL • NODE CLUSTER ACTIVE
                </span>
              </div>
              <h2 className="hero-title">
                Hardware de Alta Performance. Arquitetura Distribuída.
              </h2>
              <p className="hero-description">
                Catálogo de tecnologia projetado para desenvolvedores e engenharia. Operado por uma malha de microsserviços distribuídos em contêineres, com isolamento de falhas e persistência poliglota.
              </p>
              <div className="hero-trust-bar">
                <div className="trust-item">
                  <Network size={14} />
                  <span>API Gateway Reverso (:8000)</span>
                </div>
                <div className="trust-item">
                  <Database size={14} />
                  <span>PostgreSQL + MongoDB</span>
                </div>
                <div className="trust-item">
                  <ShieldCheck size={14} />
                  <span>JWT Sem Estado</span>
                </div>
              </div>
            </div>

            {/* Spec Sheet / Arquitetura Visual */}
            <div className="hero-blueprint-card">
              <div className="blueprint-header">
                <div className="blueprint-title-row">
                  <Terminal size={14} />
                  <span>TOPOLOGIA DE MICROSSERVIÇOS</span>
                </div>
                <div className="blueprint-status-indicator">
                  <span className="dot"></span>
                  <span>100% HEALTHY</span>
                </div>
              </div>

              <div className="blueprint-pipeline">
                <div className="pipeline-node">
                  <span className="node-label">
                    <Server size={13} />
                    <span>CLIENT / WEB BROWSER</span>
                  </span>
                  <span className="node-badge">HTTP / REST</span>
                </div>

                <div className="pipeline-connector">↓ :8000</div>

                <div className="pipeline-node primary">
                  <span className="node-label">
                    <Network size={13} />
                    <span>API GATEWAY (Express Proxy)</span>
                  </span>
                  <span className="node-badge">Reverse Proxy & Rate Limit</span>
                </div>

                <div className="pipeline-connector">↓ Roteamento Interno</div>

                <div className="pipeline-node">
                  <span className="node-label">
                    <Database size={13} />
                    <span>CATÁLOGO + PEDIDOS + AUTH</span>
                  </span>
                  <span className="node-badge">Mongo & Postgres</span>
                </div>
              </div>

              <div className="blueprint-specs-grid">
                <div className="blueprint-spec-item">
                  <span className="spec-key">Persistência</span>
                  <span className="spec-val">Híbrida Poliglota</span>
                </div>
                <div className="blueprint-spec-item">
                  <span className="spec-key">Orquestração</span>
                  <span className="spec-val">Docker & Kubernetes</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Grade de Produtos */}
        <ProductGrid searchTerm={searchTerm} refreshTrigger={refreshTrigger} />
      </main>

      {/* Gaveta do Carrinho */}
      <CartDrawer
        onOpenAuth={() => setIsAuthOpen(true)}
        onOrderCompleted={handleRefreshProducts}
      />

      {/* Modais do Sistema */}
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      <CreateProductModal
        isOpen={isCreateProductOpen}
        onClose={() => setIsCreateProductOpen(false)}
        onProductCreated={handleRefreshProducts}
      />
      <OrdersModal isOpen={isOrdersOpen} onClose={() => setIsOrdersOpen(false)} />

      {/* Rodapé Informativo */}
      <footer className="app-footer">
        <div className="footer-content">
          <p>© 2026 DistriCommerce — Projeto Final de Sistemas Distribuídos (Prof. Ildo Vieira)</p>
          <p className="footer-subtext">
            Construído em TypeScript, React, Express, MongoDB, PostgreSQL, Docker e Kubernetes.
          </p>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <CartProvider>
        <AppContent />
      </CartProvider>
    </AuthProvider>
  );
};

export default App;
