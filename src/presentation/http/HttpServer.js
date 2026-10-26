'use strict';
const http = require('node:http');
const AppError = require('../../domain/errors/AppError');
const UnauthorizedError = require('../../domain/errors/UnauthorizedError');
const ForbiddenError = require('../../domain/errors/ForbiddenError');
const NotFoundError = require('../../domain/errors/NotFoundError');
const FileResponse = require('./FileResponse');
const { readJsonBody, parseCookies } = require('./requestParsing');

const SESSION_COOKIE = 'sid';

/** Servidor HTTP: autenticação, autorização por nível, contexto da requisição e tradução de erros. */
class HttpServer {
  /**
   * @param {object} deps
   * @param {import('./Router')} deps.router
   * @param {import('../../application/AuthService')} deps.authService
   * @param {import('./StaticFileHandler')} deps.staticHandler
   * @param {Pick<Console,'error'>} [deps.logger]
   */
  constructor({ router, authService, staticHandler, logger = console }) {
    this.router = router;
    this.authService = authService;
    this.staticHandler = staticHandler;
    this.logger = logger;
    this.server = http.createServer((req, res) => this.#handle(req, res));
  }

  listen(port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve(this.server.address());
      });
    });
  }

  /** Encerra o servidor, inclusive conexões abertas (SSE). */
  close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
  }

  async #handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return this.staticHandler.handle(url.pathname, res);

      const match = this.router.match(req.method, url.pathname);
      if (!match) throw new NotFoundError('Rota não encontrada');

      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = this.authService.resolveUser(token);
      this.#authorize(match.options, user);

      const headers = {};
      const ctx = {
        req,
        res,
        user,
        token,
        params: match.params,
        query: Object.fromEntries(url.searchParams),
        body: ['GET', 'DELETE'].includes(req.method) ? {} : await readJsonBody(req),
        setCookie: (value, maxAge) => {
          headers['Set-Cookie'] = `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
        },
      };
      const result = await match.handler(ctx);
      if (res.headersSent) return undefined; // o próprio handler respondeu (ex.: SSE)
      return this.#send(res, result, headers);
    } catch (error) {
      return this.#sendError(res, error);
    }
  }

  #authorize(options, user) {
    if (options.public) return;
    if (!user) throw new UnauthorizedError();
    if (user.mustChange && !options.allowMustChange) throw new ForbiddenError('Troque a senha provisória antes de continuar');
    if (options.nivel) {
      if (user.nivel !== options.nivel) throw new ForbiddenError(`Acesso restrito ao nível ${options.nivel}`);
      return;
    }
    if (user.nivel === 'C' && !options.cozinha) throw new ForbiddenError('Seu nível (Cozinha) não acessa este recurso');
  }

  #send(res, result, headers) {
    if (result instanceof FileResponse) {
      res.writeHead(200, {
        ...headers,
        'Content-Type': result.contentType,
        'Content-Disposition': `${result.disposition}; filename="${result.filename}"`,
        ...(result.cacheControl && { 'Cache-Control': result.cacheControl }),
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(result.body);
    }
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(JSON.stringify(result ?? {}));
  }

  #sendError(res, error) {
    const known = error instanceof AppError;
    if (!known) this.logger.error(error);
    if (res.headersSent) return res.end();
    res.writeHead(known ? error.status : 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: known ? error.message : 'Erro interno' }));
  }
}

module.exports = HttpServer;
