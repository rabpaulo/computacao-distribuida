import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    pass: string,
    role: UserRole | undefined,
    acceptTerms: boolean
  ) => Promise<void>;
  logout: () => void;
  // LGPD: exclui a conta (pede a senha de novo) e encerra a sessão
  deleteAccount: (password: string) => Promise<void>;
  // LGPD: correção do nome
  updateName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('districommerce_token'));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const profile = await api.getProfile();
        setUser(profile);
      } catch (err) {
        // Também cai aqui quando a conta foi removida (a API responde 410)
        console.warn('Sessão expirada, token inválido ou conta removida');
        logout();
      } finally {
        setIsLoading(false);
      }
    }
    loadUser();
  }, [token]);

  const login = async (email: string, pass: string) => {
    const res = await api.login({ email, password: pass });
    localStorage.setItem('districommerce_token', res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const register = async (
    name: string,
    email: string,
    pass: string,
    role: UserRole | undefined,
    acceptTerms: boolean
  ) => {
    const res = await api.register({ name, email, password: pass, role, acceptTerms });
    localStorage.setItem('districommerce_token', res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const logout = () => {
    localStorage.removeItem('districommerce_token');
    // O carrinho fica no navegador; numa conta excluída não faz sentido deixá-lo para trás
    setToken(null);
    setUser(null);
  };

  const deleteAccount = async (password: string) => {
    await api.deleteMyAccount(password);
    localStorage.removeItem('districommerce_cart');
    logout();
  };

  const updateName = async (name: string) => {
    const updated = await api.updateProfileName(name);
    setUser(updated);
  };

  const isAdmin = user?.role === 'ROLE_ADMIN';

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, isAdmin, login, register, logout, deleteAccount, updateName }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser utilizado dentro de AuthProvider');
  return ctx;
};
