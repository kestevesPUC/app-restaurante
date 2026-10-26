'use strict';

/** Administração de usuários — restrita ao nível A. */
class UsuarioController {
  /** @param {import('../../../application/UsuarioService')} usuarioService */
  constructor(usuarioService) {
    this.usuarioService = usuarioService;
  }

  register(router) {
    const admin = { nivel: 'A' };
    router.add('GET', '/api/usuarios', () => this.usuarioService.listar(), admin);
    router.add('POST', '/api/usuarios', (ctx) => this.usuarioService.criar(ctx.user, ctx.body), admin);
    router.add('PUT', '/api/usuarios/:id', (ctx) => this.usuarioService.atualizar(ctx.user, Number(ctx.params.id), ctx.body), admin);
    router.add('POST', '/api/usuarios/:id/resetar-senha', (ctx) => this.usuarioService.resetarSenha(ctx.user, Number(ctx.params.id)), admin);
  }
}

module.exports = UsuarioController;
