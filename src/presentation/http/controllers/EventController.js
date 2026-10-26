'use strict';

/** Canal SSE (`GET /api/eventos`): entrega os eventos do EventBus aos usuários autenticados. */
class EventController {
  /**
   * @param {import('../../../infrastructure/events/EventBus')} bus
   * @param {{heartbeatMs?: number}} [options]
   */
  constructor(bus, { heartbeatMs = 25_000 } = {}) {
    this.bus = bus;
    this.heartbeatMs = heartbeatMs;
  }

  register(router) {
    router.add('GET', '/api/eventos', (ctx) => this.#stream(ctx), { cozinha: true });
  }

  #stream({ req, res, user }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (text) => {
      if (!res.writableEnded && !res.destroyed) res.write(text);
    };
    write(': conectado\n\n');

    // A: tudo. B: tudo, exceto o QR do WhatsApp. C: somente `pedido` (id e status).
    const unsubscribe = this.bus.subscribe(({ tipo, dados }) => {
      let payload = dados;
      if (user.nivel === 'C') {
        if (tipo !== 'pedido') return;
        payload = { id: dados.id, status: dados.status };
      } else if (user.nivel === 'B' && tipo === 'whatsapp' && dados && 'qr' in dados) {
        payload = { ...dados };
        delete payload.qr;
      }
      write(`event: ${tipo}\ndata: ${JSON.stringify(payload)}\n\n`);
    });
    const heartbeat = setInterval(() => write(': batimento\n\n'), this.heartbeatMs);
    heartbeat.unref();

    let encerrado = false;
    const encerrar = () => {
      if (encerrado) return;
      encerrado = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', encerrar);
    res.on('close', encerrar);
  }
}

module.exports = EventController;
