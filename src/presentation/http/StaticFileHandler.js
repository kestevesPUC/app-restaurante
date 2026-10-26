'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

/** Serve os arquivos estáticos da interface, impedindo saída do diretório público. */
class StaticFileHandler {
  constructor(root) {
    this.root = path.resolve(root);
  }

  /** Responde a requisição (200 com o arquivo ou 404). */
  handle(pathname, res) {
    let relative;
    try {
      relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname);
    } catch {
      return this.#notFound(res);
    }
    if (relative.includes('\0')) return this.#notFound(res);
    const file = path.resolve(this.root, `.${path.sep}${relative}`);
    const inside = file.startsWith(this.root + path.sep);
    if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) return this.#notFound(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    return res.end(fs.readFileSync(file));
  }

  #notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
}

module.exports = StaticFileHandler;
