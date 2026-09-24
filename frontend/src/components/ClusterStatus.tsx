import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { ServiceHealth } from '../types';
import { Server, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Activity, Database } from 'lucide-react';

export const ClusterStatus: React.FC = () => {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState<string>('OFFLINE');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const fetchHealth = async () => {
    const res = await api.getClusterHealth();
    setGatewayStatus(res.gateway);
    setServices(res.services);
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const allOnline = gatewayStatus === 'ONLINE' && services.every((s) => s.status === 'ONLINE');
  const onlineCount = (gatewayStatus === 'ONLINE' ? 1 : 0) + services.filter((s) => s.status === 'ONLINE').length;
  const totalCount = 1 + (services.length || 3);

  const getServiceInfo = (name: string) => {
    if (name.includes('users')) {
      return { db: 'PostgreSQL', purpose: 'Auth & JWT', icon: <Database size={12} /> };
    }
    if (name.includes('products')) {
      return { db: 'MongoDB', purpose: 'Catálogo Poliglota', icon: <Database size={12} /> };
    }
    if (name.includes('orders')) {
      return { db: 'PostgreSQL', purpose: 'Transações ACID', icon: <Database size={12} /> };
    }
    return { db: 'Memória/Cache', purpose: 'Microsserviço', icon: <Server size={12} /> };
  };

  return (
    <div className="cluster-status-bar">
      <div className="cluster-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="cluster-badge">
          <div className="cluster-title-wrap">
            <Activity size={13} />
            <span>CLUSTER DISTRIBUÍDO:</span>
            <span className="cluster-node-count">{onlineCount}/{totalCount} Nós</span>
          </div>

          <span className={`status-pill ${allOnline ? 'online' : 'degraded'}`}>
            <span className="dot"></span>
            {allOnline ? 'Cluster 100% Operacional' : 'Aguardando Nós de Serviço'}
          </span>
        </div>

        <div className="cluster-toggle-wrap">
          <span>{isExpanded ? 'Ocultar Topologia' : 'Inspecionar Topologia'}</span>
          <button className="toggle-btn" aria-label="Alternar detalhes do cluster">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="cluster-details">
          {/* API Gateway Node */}
          <div className="service-row">
            <div className="service-header-line">
              <span className="service-name">API Gateway (Porta :8000)</span>
              <span className={`status-indicator ${gatewayStatus === 'ONLINE' ? 'online' : 'offline'}`}>
                {gatewayStatus === 'ONLINE' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {gatewayStatus}
              </span>
            </div>
            <div className="service-meta-line">
              <span className="service-tag">Proxy Reverso & Roteador</span>
              <span>Express / CORS / Rate-Limit</span>
            </div>
          </div>

          {/* Microservices Nodes */}
          {services.map((s) => {
            const info = getServiceInfo(s.name);
            return (
              <div key={s.name} className="service-row">
                <div className="service-header-line">
                  <span className="service-name">{s.name}</span>
                  <span className={`status-indicator ${s.status.toLowerCase()}`}>
                    {s.status === 'ONLINE' ? (
                      <CheckCircle2 size={13} />
                    ) : s.status === 'DEGRADED' ? (
                      <AlertTriangle size={13} />
                    ) : (
                      <XCircle size={13} />
                    )}
                    {s.status}
                  </span>
                </div>
                <div className="service-meta-line">
                  <span className="service-tag">{info.db}</span>
                  <span>{info.purpose}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
