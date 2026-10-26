'use strict';

/** Informações do sistema (nome e versão) para qualquer usuário logado, inclusive a Cozinha. */
class SistemaController {
  /** @param {{nome: string, versao: string}} sistema lido uma vez na construção */
  constructor({ nome, versao }) {
    this.info = Object.freeze({ nome, versao });
  }

  register(router) {
    router.add('GET', '/api/sistema', () => ({ ...this.info }), { cozinha: true });
  }
}

module.exports = SistemaController;
