import React from 'react';
import { X, ShieldCheck } from 'lucide-react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Versão vigente. Precisa bater com PRIVACY_POLICY_VERSION do users-service:
// é ela que fica gravada no cadastro como prova do que o titular aceitou.
export const PRIVACY_POLICY_VERSION = '1.0';
const UPDATED_AT = '18/11/2026';

// Contato do encarregado (DPO). O grupo deve trocar pelo e-mail real antes da entrega.
const CONTACT_EMAIL = 'privacidade@districommerce.com';

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="privacy-policy-title"
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <ShieldCheck size={18} />
            <h2 id="privacy-policy-title">Política de Privacidade</h2>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Fechar janela">
            <X size={18} />
          </button>
        </div>

        <div className="policy-body">
          <p className="policy-meta">
            Versão {PRIVACY_POLICY_VERSION} · atualizada em {UPDATED_AT} · conforme a Lei Geral de Proteção de
            Dados (LGPD, Lei 13.709/2018)
          </p>

          <h3>1. Quem somos</h3>
          <p>
            O DistriCommerce é um projeto acadêmico de comércio eletrônico distribuído (Projeto Final de Sistemas
            Distribuídos). Os pagamentos e as entregas são <strong>simulados</strong>: nenhuma cobrança real é feita.
          </p>

          <h3>2. Dados que tratamos</h3>
          <ul>
            <li>
              <strong>Cadastro:</strong> nome, e-mail e senha. A senha é guardada apenas como <em>hash</em> (bcrypt),
              nunca em texto.
            </li>
            <li>
              <strong>Pedidos:</strong> itens, valores e datas das suas compras.
            </li>
            <li>
              <strong>Pagamentos:</strong> forma escolhida, valor e situação. Dados de cartão{' '}
              <strong>nunca</strong> são coletados nem armazenados.
            </li>
            <li>
              <strong>Entregas:</strong> situação e posição do caminhão. Não coletamos endereço.
            </li>
            <li>
              <strong>Notificações:</strong> avisos sobre o andamento dos seus pedidos.
            </li>
            <li>
              <strong>Registros técnicos:</strong> data, hora e endereço IP das requisições nos servidores.
            </li>
            <li>
              <strong>No seu navegador:</strong> não usamos cookies. Guardamos o token de sessão e o carrinho no
              armazenamento local.
            </li>
          </ul>

          <h3>3. Para que usamos e em que base legal</h3>
          <ul>
            <li>Criar sua conta e identificar você: seu <strong>consentimento</strong> (art. 7º, I).</li>
            <li>Processar pedidos, pagamentos e entregas: <strong>execução de contrato</strong> (art. 7º, V).</li>
            <li>
              Guardar o histórico de pedidos e pagamentos: <strong>obrigação legal e fiscal</strong> (art. 7º, II).
            </li>
            <li>Segurança e prevenção a fraudes: <strong>legítimo interesse</strong> (art. 7º, IX).</li>
          </ul>

          <h3>4. Com quem compartilhamos</h3>
          <p>
            Não vendemos nem cedemos seus dados. Eles circulam apenas entre os serviços do próprio sistema para
            executar seu pedido. O PayPal usado no checkout é um simulador interno: nenhum dado sai do ambiente.
          </p>

          <h3>5. Por quanto tempo guardamos</h3>
          <ul>
            <li>Dados da conta: enquanto ela existir.</li>
            <li>Notificações: 90 dias, depois são apagadas automaticamente.</li>
            <li>
              Pedidos e pagamentos: mantidos pelo prazo legal mesmo depois da exclusão da conta, mas{' '}
              <strong>sem identificar você</strong> (a conta é anonimizada).
            </li>
          </ul>

          <h3>6. Seus direitos (art. 18)</h3>
          <p>
            No menu da sua conta, em <strong>Privacidade</strong>, você pode a qualquer momento:
          </p>
          <ul>
            <li>
              <strong>Acessar e levar seus dados:</strong> baixar tudo em um arquivo JSON.
            </li>
            <li>
              <strong>Corrigir</strong> o seu nome.
            </li>
            <li>
              <strong>Excluir sua conta:</strong> nome, e-mail e senha são apagados, suas notificações removidas e o
              consentimento revogado.
            </li>
          </ul>
          <p>
            Outras solicitações: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h3>7. Segurança</h3>
          <p>
            Senhas com hash bcrypt, sessão por token JWT com validade, HTTPS na versão publicada e serviços de
            backend executados sem privilégios de administrador. Cada pessoa só consulta os próprios pedidos,
            pagamentos, entregas e notificações. Os administradores do sistema conseguem consultar os dados de
            cadastro (nome, e-mail e perfil) para operar a loja.
          </p>

          <h3>8. Mudanças nesta política</h3>
          <p>
            Quando a política mudar, a versão aumenta e registramos qual versão cada pessoa aceitou no cadastro.
          </p>
        </div>

        <div className="modal-footer-switch">
          <button className="btn-submit policy-close" onClick={onClose}>
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};
