'use strict';

/** Acesso: login, logout, usuário logado e troca da própria senha (RN-01). */
class AuthController {
  /** @param {import('../../../application/AuthService')} authService */
  constructor(authService) {
    this.authService = authService;
  }

  register(router) {
    router.add('POST', '/api/login', (ctx) => this.#login(ctx), { public: true });
    router.add('POST', '/api/logout', (ctx) => this.#logout(ctx), { public: true });
    router.add('GET', '/api/me', (ctx) => ctx.user, { allowMustChange: true, cozinha: true });
    router.add('POST', '/api/me/senha', (ctx) => this.#trocarSenha(ctx), { allowMustChange: true, cozinha: true });
  }

  #login(ctx) {
    const { sid, user } = this.authService.login(ctx.body.usuario, ctx.body.senha);
    ctx.setCookie(sid);
    return user;
  }

  #logout(ctx) {
    this.authService.logout(ctx.token);
    ctx.setCookie('', 0);
    return { ok: true };
  }

  /** A troca encerra todas as sessões do usuário; abre uma nova e reemite o cookie. */
  #trocarSenha(ctx) {
    this.authService.trocarSenha(ctx.user, ctx.body.atual, ctx.body.nova);
    ctx.setCookie(this.authService.abrirSessao(ctx.user));
    return { ok: true };
  }
}

module.exports = AuthController;
