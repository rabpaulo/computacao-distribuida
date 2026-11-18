import React, { useState } from 'react';
import { Activity, BarChart3, ExternalLink, RefreshCw, Share2, X } from 'lucide-react';

interface MonitoringModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Tool {
  id: 'grafana' | 'prometheus' | 'rabbitmq';
  label: string;
  description: string;
  icon: React.ReactNode;
  // Caminho dentro do próprio site: o gateway repassa para o container da ferramenta
  path: string;
}

const TOOLS: Tool[] = [
  {
    id: 'grafana',
    label: 'Grafana',
    description: 'Painéis: requisições, latência, erros, CPU e memória por serviço',
    icon: <BarChart3 size={15} />,
    path: '/tools/grafana/d/districommerce-overview?orgId=1&refresh=5s',
  },
  {
    id: 'prometheus',
    label: 'Prometheus',
    description: 'Métricas brutas e consultas (PromQL); em Status > Targets, os serviços monitorados',
    icon: <Activity size={15} />,
    path: '/tools/prometheus/graph',
  },
  {
    id: 'rabbitmq',
    label: 'RabbitMQ',
    description: 'Filas, mensagens em fluxo e a fila de falhas (DLQ). Login: admin / admin',
    icon: <Share2 size={15} />,
    path: '/tools/rabbitmq/',
  },
];

// Tela de monitoramento (só admin). Mostra Grafana, Prometheus e RabbitMQ dentro
// do site, cada um numa aba. As ferramentas são servidas pelo gateway no mesmo
// endereço do site (/tools/*), por isso cabem num iframe.
export const MonitoringModal: React.FC<MonitoringModalProps> = ({ isOpen, onClose }) => {
  const [active, setActive] = useState<Tool['id']>('grafana');
  // Abas já abertas continuam montadas (escondidas): voltar para elas não perde o que estava na tela
  const [visited, setVisited] = useState<Set<Tool['id']>>(new Set(['grafana']));
  // Trocar a chave de um iframe o recarrega
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});

  if (!isOpen) return null;

  const current = TOOLS.find((tool) => tool.id === active) ?? TOOLS[0];

  const select = (id: Tool['id']) => {
    setActive(id);
    setVisited((prev) => new Set(prev).add(id));
  };

  const reload = () => {
    setReloadKeys((prev) => ({ ...prev, [active]: (prev[active] ?? 0) + 1 }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card modal-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="monitoring-title"
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <Activity size={18} />
            <h2 id="monitoring-title">Monitoramento</h2>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Fechar janela">
            <X size={18} />
          </button>
        </div>

        <div className="monitor-toolbar">
          <div className="monitor-tabs" role="tablist">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                role="tab"
                aria-selected={tool.id === active}
                className={`monitor-tab ${tool.id === active ? 'active' : ''}`}
                onClick={() => select(tool.id)}
              >
                {tool.icon}
                {tool.label}
              </button>
            ))}
          </div>

          <div className="monitor-actions">
            <button className="btn-icon-action" onClick={reload} title="Recarregar esta tela">
              <RefreshCw size={14} />
              <span className="action-label">Recarregar</span>
            </button>
            <a
              className="btn-icon-action"
              href={current.path}
              target="_blank"
              rel="noreferrer"
              title="Abrir em uma nova aba do navegador"
            >
              <ExternalLink size={14} />
              <span className="action-label">Nova aba</span>
            </a>
          </div>
        </div>

        <p className="monitor-description">{current.description}</p>

        <div className="monitor-frames">
          {TOOLS.filter((tool) => visited.has(tool.id)).map((tool) => (
            <iframe
              key={`${tool.id}-${reloadKeys[tool.id] ?? 0}`}
              className="monitor-frame"
              src={tool.path}
              title={tool.label}
              hidden={tool.id !== active}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
