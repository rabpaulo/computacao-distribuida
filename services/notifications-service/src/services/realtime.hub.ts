import { Response } from 'express';
import { sseConnections } from '../metrics';

// Guarda as conexões Server-Sent Events abertas, agrupadas por usuário.
// Quando uma notificação nasce, o hub escreve nas conexões daquele usuário e só
// nelas: nunca existe broadcast para todos.
//
// Limitação conhecida: o estado fica na memória do processo. Com várias
// réplicas, o evento é consumido por uma só, e só os clientes ligados a ela
// recebem o push na hora (os demais veem a notificação ao reconectar ou
// recarregar a lista). Por isso o Deployment do K8s usa 1 réplica.
export class RealtimeHub {
  private readonly clients = new Map<string, Set<Response>>();

  constructor(private readonly maxPerUser = 5) {}

  // Registra a conexão e devolve a função que a remove
  add(userId: string, res: Response): () => void {
    let set = this.clients.get(userId);
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }

    // Muitas abas abertas: encerra a mais antiga em vez de recusar a nova
    while (set.size >= this.maxPerUser) {
      const oldest = set.values().next().value as Response;
      set.delete(oldest);
      sseConnections.dec();
      oldest.end();
    }

    set.add(res);
    sseConnections.inc();

    const owned = set;
    return () => {
      if (owned.delete(res)) sseConnections.dec();
      if (owned.size === 0 && this.clients.get(userId) === owned) {
        this.clients.delete(userId);
      }
    };
  }

  // Devolve para quantas conexões do usuário a mensagem foi escrita
  publish(userId: string, notification: unknown): number {
    const set = this.clients.get(userId);
    if (!set) return 0;

    const frame = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
    let delivered = 0;
    for (const res of set) {
      if (this.write(res, frame)) delivered += 1;
    }
    return delivered;
  }

  // Linha de comentário SSE: o navegador ignora, mas mantém o proxy acordado
  heartbeat(): void {
    for (const set of this.clients.values()) {
      for (const res of set) {
        this.write(res, ': ping\n\n');
      }
    }
  }

  // Usado no shutdown: sem isso, server.close() espera as conexões para sempre
  closeAll(): void {
    for (const set of this.clients.values()) {
      for (const res of set) {
        res.end();
      }
    }
  }

  connectionCount(userId?: string): number {
    if (userId) return this.clients.get(userId)?.size ?? 0;
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }

  private write(res: Response, frame: string): boolean {
    if (res.writableEnded || res.destroyed) return false;
    try {
      res.write(frame);
      return true;
    } catch {
      return false;
    }
  }
}
