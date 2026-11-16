'use strict';

/** Estado da cópia para a nuvem e botão "Sincronizar agora" (qualquer usuário logado, inclusive a Cozinha). */
class SincronizacaoController {
  /** @param {import('../../../application/SincronizacaoNuvem')} servico */
  constructor(servico) {
    this.servico = servico;
  }

  register(router) {
    router.add('GET', '/api/sincronizacao', () => this.servico.status(), { cozinha: true });
    router.add('POST', '/api/sincronizacao/agora', () => this.servico.sincronizarAgora(), { cozinha: true });
  }
}

module.exports = SincronizacaoController;
