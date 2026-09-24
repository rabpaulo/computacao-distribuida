import React, { useState } from 'react';
import { api } from '../services/api';
import { X, Plus, Loader2, AlertCircle } from 'lucide-react';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProductCreated: () => void;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({
  isOpen,
  onClose,
  onProductCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Informática');
  const [stock, setStock] = useState('10');
  const [imageUrl, setImageUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await api.createProduct({
        name: name.trim(),
        description: description.trim(),
        price: parseFloat(price),
        category,
        stock: parseInt(stock, 10),
        images: imageUrl.trim() ? [imageUrl.trim()] : [],
        active: true,
      });

      onProductCreated();
      onClose();
      setName('');
      setDescription('');
      setPrice('');
      setImageUrl('');
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar produto');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Plus size={18} />
            <h2>Novo Item no Catálogo (Admin)</h2>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Fechar janela">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="modal-alert-error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="product-form">
          <div className="form-group">
            <label>Nome do Produto</label>
            <input
              type="text"
              placeholder="Ex: Teclado Mecânico Custom 75%"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="Informática">Informática</option>
                <option value="Eletrônicos">Eletrônicos</option>
                <option value="Áudio">Áudio</option>
                <option value="Periféricos">Periféricos</option>
                <option value="Acessórios">Acessórios</option>
              </select>
            </div>

            <div className="form-group">
              <label>Preço Unitário (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="499.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Estoque Inicial</label>
              <input
                type="number"
                min="0"
                placeholder="10"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>URL da Imagem</label>
            <input
              type="url"
              placeholder="https://images.unsplash.com/photo-..."
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </div>

          {imageUrl.trim() && (
            <div className="image-preview-box">
              <img
                src={imageUrl.trim()}
                alt="Pré-visualização"
                className="image-preview-thumbnail"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span className="image-preview-text">Prévia da imagem carregada</span>
            </div>
          )}

          <div className="form-group">
            <label>Especificações e Descrição</label>
            <textarea
              rows={3}
              placeholder="Detalhes de conectividade, switches, material e características técnicas..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={5}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 size={16} className="spin-animation" /> Salvando...
                </>
              ) : (
                'Salvar no Catálogo'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
