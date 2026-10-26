'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PADRAO = /^pdv-\d{4}-\d{2}-\d{2}\.sqlite$/;
const dois = (n) => String(n).padStart(2, '0');

/**
 * Cópia de segurança automática: no máximo uma por dia (pdv-AAAA-MM-DD.sqlite, via VACUUM INTO),
 * mantendo as `manter` mais recentes. Só apaga arquivos que casem com o padrão.
 */
class DailyBackup {
  /**
   * @param {object} deps
   * @param {{backupTo(destino:string): void}} deps.db
   * @param {string} deps.pasta
   * @param {() => number} [deps.relogio] "agora" em milissegundos
   * @param {number} [deps.manter]
   */
  constructor({ db, pasta, relogio = Date.now, manter = 14 }) {
    this.db = db;
    this.pasta = pasta;
    this.relogio = relogio;
    this.manter = manter;
  }

  /** @returns {string|null} caminho criado, ou null se já existe backup de hoje */
  run() {
    fs.mkdirSync(this.pasta, { recursive: true });
    const agora = new Date(this.relogio());
    const nome = `pdv-${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}.sqlite`;
    const arquivo = path.join(this.pasta, nome);
    if (fs.existsSync(arquivo)) return null;
    this.db.backupTo(arquivo);
    this.#podar();
    return arquivo;
  }

  #podar() {
    const nomes = fs.readdirSync(this.pasta).filter((n) => PADRAO.test(n)).sort().reverse();
    for (const nome of nomes.slice(this.manter)) fs.rmSync(path.join(this.pasta, nome), { force: true });
  }
}

module.exports = DailyBackup;
