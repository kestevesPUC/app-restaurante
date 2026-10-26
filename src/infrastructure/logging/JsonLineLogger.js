'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 };
const PADRAO_ARQUIVO = /^pdv-\d{4}-\d{2}-\d{2}\.log$/;
const SEGREDOS = new Set(['senha', 'senha_hash', 'senhahash', 'token', 'cookie', 'authorization', 'sid', 'hash']);

const doisDigitos = (n) => String(n).padStart(2, '0');

/**
 * Log estruturado: uma linha JSON por registro em `pdv-AAAA-MM-DD.log` (data local do relógio).
 *
 * Escrita SÍNCRONA (`appendFileSync`): é simples, preserva a ordem e não perde linhas se o app encerrar de repente;
 * o volume de um PDV é pequeno. Por isso `fechar()` não tem nada pendente a descarregar.
 * Nunca lança: falhas de escrita são contadas (`falhasDeEscrita()`) e a primeira vira UMA linha em `console.error`.
 * Compatível com `Pick<Console,'error'>`: `error(erro)` e `error('msg', contexto)` funcionam.
 */
class JsonLineLogger {
  /**
   * @param {object} opcoes
   * @param {string} opcoes.pasta
   * @param {() => number} [opcoes.relogio] "agora" em milissegundos
   * @param {'debug'|'info'|'warn'|'error'} [opcoes.nivelMinimo]
   * @param {number} [opcoes.manter] quantidade de arquivos diários mantidos
   */
  constructor({ pasta, relogio = Date.now, nivelMinimo = 'info', manter = 14 }) {
    this.pasta = pasta;
    this.relogio = relogio;
    this.minimo = NIVEIS[nivelMinimo] ?? NIVEIS.info;
    this.manter = manter;
    this.falhas = 0;
    this.diaPreparado = null;
    this.podarPendente = false;
  }

  debug(msg, contexto) { this.#registrar('debug', msg, contexto); }

  info(msg, contexto) { this.#registrar('info', msg, contexto); }

  warn(msg, contexto) { this.#registrar('warn', msg, contexto); }

  error(msg, contexto) { this.#registrar('error', msg, contexto); }

  falhasDeEscrita() { return this.falhas; }

  /** Escrita é síncrona: não há pendências. Mantido para o encerramento ordenado do app. */
  async fechar() { /* nada pendente */ }

  #registrar(nivel, msg, contexto) {
    if (NIVEIS[nivel] < this.minimo) return;
    try {
      const agora = new Date(this.relogio());
      const linha = { ts: agora.toISOString(), nivel, ...this.#conteudo(msg, contexto) };
      const texto = `${this.#serializar(linha)}\n`;
      const dia = `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
      this.#prepararDia(dia);
      fs.appendFileSync(path.join(this.pasta, `pdv-${dia}.log`), texto);
      if (this.podarPendente) this.#podar(); // depois de criar o arquivo do dia, para ele contar entre os mantidos
    } catch (error) {
      this.#falhou(error);
    }
  }

  #conteudo(msg, contexto) {
    const extra = contexto instanceof Error ? { erro: contexto } : (contexto && typeof contexto === 'object' ? contexto : (contexto === undefined ? {} : { detalhe: contexto }));
    if (msg instanceof Error) return { msg: msg.message, erro: msg, ...extra };
    return { msg: typeof msg === 'string' ? msg : String(msg), ...extra };
  }

  /** Ao abrir/virar o dia: garante a pasta e poda os arquivos antigos (uma vez por dia). */
  #prepararDia(dia) {
    if (this.diaPreparado === dia) return;
    fs.mkdirSync(this.pasta, { recursive: true });
    this.diaPreparado = dia;
    this.podarPendente = true;
  }

  #podar() {
    this.podarPendente = false;
    const nomes = fs.readdirSync(this.pasta).filter((n) => PADRAO_ARQUIVO.test(n)).sort();
    for (const nome of nomes.slice(0, Math.max(0, nomes.length - this.manter))) fs.unlinkSync(path.join(this.pasta, nome));
  }

  #falhou(error) {
    this.falhas += 1;
    if (this.falhas === 1) {
      try { console.error(`[log] não foi possível gravar o log: ${error.message}`); } catch { /* nada a fazer */ }
    }
  }

  /** JSON seguro: circular -> "[Circular]", BigInt -> string, Error -> {nome, mensagem, stack}, segredos -> "***". */
  #serializar(valor) {
    const pilha = new WeakSet();
    const limpar = (v, chave) => {
      if (chave && SEGREDOS.has(String(chave).toLowerCase())) return '***';
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'function' || typeof v === 'symbol') return String(v);
      if (v === null || typeof v !== 'object') return v;
      if (pilha.has(v)) return '[Circular]';
      pilha.add(v);
      try {
        if (v instanceof Error) return { nome: v.name, mensagem: v.message, stack: v.stack };
        if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
        if (Array.isArray(v)) return v.map((x) => limpar(x));
        const saida = {};
        for (const [k, x] of Object.entries(v)) saida[k] = limpar(x, k);
        return saida;
      } finally {
        pilha.delete(v); // só ancestrais contam como ciclo; a mesma referência repetida em ramos irmãos é permitida
      }
    };
    return JSON.stringify(limpar(valor));
  }
}

module.exports = JsonLineLogger;
