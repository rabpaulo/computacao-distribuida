import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Loader2, Lock, Pencil, ShieldCheck, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

interface PrivacyCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPolicy: () => void;
}

function formatDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
}

// Central de direitos do titular (LGPD, art. 18): acesso, correção, portabilidade e eliminação
export const PrivacyCenterModal: React.FC<PrivacyCenterModalProps> = ({ isOpen, onClose, onOpenPolicy }) => {
  const { user, updateName, deleteAccount } = useAuth();

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Depois de excluir a sessão acaba (user vira null); esta tela de despedida continua
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    if (isOpen && user) setName(user.name);
  }, [isOpen, user]);

  // Fecha o formulário de exclusão ao sair do modal
  useEffect(() => {
    if (!isOpen && !deleted) {
      setConfirmingDelete(false);
      setUnderstood(false);
      setPassword('');
      setDeleteError(null);
      setNameMessage(null);
      setExportError(null);
    }
  }, [isOpen, deleted]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (deleted) setDeleted(false);
    onClose();
  };

  const handleSaveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setNameMessage(null);
    setSavingName(true);
    try {
      await updateName(name.trim());
      setNameMessage({ ok: true, text: 'Nome atualizado.' });
    } catch (err: any) {
      setNameMessage({ ok: false, text: err.message || 'Não foi possível atualizar o nome' });
    } finally {
      setSavingName(false);
    }
  };

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'meus-dados-districommerce.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err.message || 'Não foi possível exportar seus dados');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAccount(password);
      setPassword('');
      setDeleted(true);
    } catch (err: any) {
      setDeleteError(err.message || 'Não foi possível excluir a conta');
    } finally {
      setDeleting(false);
    }
  };

  // ---- Despedida (conta já excluída)
  if (deleted) {
    return (
      <div className="modal-backdrop" onClick={handleClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="privacy-done">
            <CheckCircle2 size={36} />
            <h2>Conta excluída</h2>
            <p>
              Seu nome, e-mail e senha foram apagados e suas notificações removidas. O histórico de pedidos fica
              guardado pelo prazo legal, mas sem identificar você.
            </p>
            <button className="btn-submit" onClick={handleClose}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal-card modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="privacy-center-title"
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <ShieldCheck size={18} />
            <h2 id="privacy-center-title">Privacidade e meus dados</h2>
          </div>
          <button className="btn-close" onClick={handleClose} aria-label="Fechar janela">
            <X size={18} />
          </button>
        </div>

        <div className="privacy-body">
          {/* Acesso */}
          <section className="privacy-section">
            <h3>Seus dados</h3>
            <dl className="privacy-data">
              <div>
                <dt>Nome</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>E-mail</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Consentimento</dt>
                <dd>
                  {user.consent_at
                    ? `Política v${user.consent_version ?? '?'} aceita em ${formatDate(user.consent_at)}`
                    : 'Conta criada antes da Política de Privacidade'}
                </dd>
              </div>
            </dl>
            <button type="button" className="btn-switch-mode privacy-link" onClick={onOpenPolicy}>
              Ler a Política de Privacidade
            </button>
          </section>

          {/* Correção */}
          <section className="privacy-section">
            <h3>
              <Pencil size={14} /> Corrigir meu nome
            </h3>
            <form className="privacy-inline-form" onSubmit={handleSaveName}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={150}
                required
                aria-label="Nome"
              />
              <button type="submit" className="btn-submit" disabled={savingName || name.trim() === user.name}>
                {savingName ? <Loader2 size={14} className="spin-animation" /> : 'Salvar'}
              </button>
            </form>
            {nameMessage && (
              <p className={`privacy-feedback ${nameMessage.ok ? 'ok' : 'error'}`}>{nameMessage.text}</p>
            )}
          </section>

          {/* Portabilidade */}
          <section className="privacy-section">
            <h3>
              <Download size={14} /> Baixar meus dados
            </h3>
            <p className="privacy-hint">
              Um arquivo JSON com sua conta, pedidos, pagamentos, entregas e notificações.
            </p>
            <button type="button" className="btn-icon-action" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <>
                  <Loader2 size={14} className="spin-animation" /> Reunindo seus dados...
                </>
              ) : (
                <>
                  <Download size={14} /> Baixar arquivo
                </>
              )}
            </button>
            {exportError && <p className="privacy-feedback error">{exportError}</p>}
          </section>

          {/* Eliminação */}
          <section className="privacy-section danger-zone">
            <h3>
              <Trash2 size={14} /> Excluir minha conta
            </h3>
            <p className="privacy-hint">
              Apaga seu nome, e-mail e senha e remove suas notificações. Não dá para desfazer. Pedidos e pagamentos
              antigos ficam guardados pelo prazo legal, sem identificar você.
            </p>

            {!confirmingDelete ? (
              <button type="button" className="btn-danger-outline" onClick={() => setConfirmingDelete(true)}>
                Quero excluir minha conta
              </button>
            ) : (
              <form className="privacy-delete-form" onSubmit={handleDelete}>
                <label className="privacy-check">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                  />
                  <span>Entendo que a exclusão é definitiva.</span>
                </label>

                <div className="input-with-icon">
                  <Lock size={16} />
                  <input
                    type="password"
                    placeholder="Digite sua senha para confirmar"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>

                {deleteError && (
                  <div className="privacy-feedback error">
                    <AlertCircle size={14} /> {deleteError}
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setPassword('');
                      setUnderstood(false);
                      setDeleteError(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn-danger"
                    disabled={!understood || password.length === 0 || deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 size={14} className="spin-animation" /> Excluindo...
                      </>
                    ) : (
                      'Excluir definitivamente'
                    )}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
