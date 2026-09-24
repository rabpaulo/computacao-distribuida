import React, { useState, useEffect } from 'react';
import { Product } from '../types';
import { api } from '../services/api';
import { ProductCard } from './ProductCard';
import { ArrowUpDown, Loader2, RefreshCw } from 'lucide-react';

interface ProductGridProps {
  searchTerm: string;
  refreshTrigger: number;
}

const CATEGORIES = ['Todos', 'Informática', 'Eletrônicos', 'Áudio', 'Periféricos', 'Acessórios'];

export const ProductGrid: React.FC<ProductGridProps> = ({ searchTerm, refreshTrigger }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [sortOption, setSortOption] = useState<string>('newest');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const categoryParam = selectedCategory === 'Todos' ? undefined : selectedCategory;
      const data = await api.getProducts({
        category: categoryParam,
        search: searchTerm || undefined,
        sort: sortOption,
      });
      setProducts(data.products || []);
    } catch (err: any) {
      console.error('Erro ao buscar produtos:', err);
      setError('Não foi possível carregar o catálogo de produtos. Verifique se o API Gateway e o products-service estão ativos.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [selectedCategory, sortOption, searchTerm, refreshTrigger]);

  return (
    <section className="product-section">
      {/* Controles de Filtros e Ordenação */}
      <div className="filter-bar">
        <div className="category-chips">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`chip ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="sort-container">
          <ArrowUpDown size={14} />
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            className="sort-select"
            aria-label="Ordenar produtos"
          >
            <option value="newest">Mais recentes</option>
            <option value="price_asc">Menor preço</option>
            <option value="price_desc">Maior preço</option>
          </select>
        </div>
      </div>

      {/* Conteúdo Principal */}
      {isLoading ? (
        <div className="loading-state">
          <Loader2 size={30} className="spin-animation" />
          <p>Carregando catálogo de produtos...</p>
        </div>
      ) : error ? (
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={fetchProducts}>
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <p>Nenhum produto encontrado para os filtros selecionados.</p>
        </div>
      ) : (
        <div className="products-grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </section>
  );
};
