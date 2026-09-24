import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { X, Lock, Mail, User as UserIcon, Shield, Loader2, AlertCircle } from 'lucide-react';
import { UserRole } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { login, register } = useAuth();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('ROLE_CUSTOMER');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isLoginMode) {
        await login(email, password);
      } else {
        await register(name, email, password, role);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao autenticar');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Conta DistriCommerce</h2>
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

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-tab-switch">
            <button
              type="button"
              className={`auth-tab-btn ${isLoginMode ? 'active' : ''}`}
              onClick={() => {
                setIsLoginMode(true);
                setError(null);
              }}
            >
              Entrar na Conta
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${!isLoginMode ? 'active' : ''}`}
              onClick={() => {
                setIsLoginMode(false);
                setError(null);
              }}
            >
              Criar Cadastro
            </button>
          </div>

          {!isLoginMode && (
            <div className="form-group">
              <label>Nome Completo</label>
              <div className="input-with-icon">
                <UserIcon size={16} />
                <input
                  type="text"
                  placeholder="Nome e Sobrenome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label>E-mail</label>
            <div className="input-with-icon">
              <Mail size={16} />
              <input
                type="email"
                placeholder="seu.email@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Senha</label>
            <div className="input-with-icon">
              <Lock size={16} />
              <input
                type="password"
                placeholder="Mínimo de 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          </div>

          {!isLoginMode && (
            <div className="form-group">
              <label>Permissões da Conta</label>
              <div className="role-selector">
                <label className={`role-option ${role === 'ROLE_CUSTOMER' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="ROLE_CUSTOMER"
                    checked={role === 'ROLE_CUSTOMER'}
                    onChange={() => setRole('ROLE_CUSTOMER')}
                  />
                  <span>Cliente</span>
                </label>
                <label className={`role-option ${role === 'ROLE_ADMIN' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="ROLE_ADMIN"
                    checked={role === 'ROLE_ADMIN'}
                    onChange={() => setRole('ROLE_ADMIN')}
                  />
                  <span className="admin-badge-label">
                    <Shield size={13} /> Administrador
                  </span>
                </label>
              </div>
            </div>
          )}

          <button type="submit" className="btn-submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 size={16} className="spin-animation" /> Processando...
              </>
            ) : isLoginMode ? (
              'Entrar'
            ) : (
              'Concluir Cadastro'
            )}
          </button>
        </form>

        <div className="modal-footer-switch">
          <span>{isLoginMode ? 'Não possui acesso?' : 'Já possui conta?'}</span>
          <button
            type="button"
            className="btn-switch-mode"
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setError(null);
            }}
          >
            {isLoginMode ? 'Criar uma conta' : 'Acessar agora'}
          </button>
        </div>
      </div>
    </div>
  );
};
