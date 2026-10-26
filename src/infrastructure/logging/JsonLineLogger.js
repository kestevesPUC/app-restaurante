'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 };
const PADRAO_ARQUIVO = /^pdv-\d{4}-\d{2}-\d{2}\.log$/;
const SEGREDOS = new Set(['senha', 'senha_hash', 'senhahash', 'token', 'cookie', 'authorization', 'sid', 'hash']);

const MAX_STRING = 4096;
const MAX_ITENS = 50;
const MAX_CHAVES = 100;
const MAX_PROFUNDIDADE = 6;
const MAX_LINHA = 64 * 1024;
const MARCA = '…[truncado]';
const ILEGIVEL = '[erro ao ler]';

const doisDigitos = (n) => String(n).padStart(2, '0');
const cortar = (s, max) => (s.length > max ? `${s.slice(0, max)}${MARCA}` : s);
const comoTexto = (v) => { try { return typeof v === 'string' ? v : String(v); } catch { return ILEGIVEL; } };

/**
 * Log estruturado: uma linha JSON por registro em `pdv-AAAA-MM-DD.log` (data local do relógio).
 *
 * Escrita SÍNCRONA (`appendFileSync`): é simples, preserva a ordem e não perde linhas se o app encerrar de repente;
 * o volume de um PDV é pequeno. Por isso `fechar()` não tem nada pendente a descarregar.
 * Nunca lança: falhas de escrita são contadas (`falhasDeEscrita()`) e a primeira vira UMA linha em `console.error`.
 * Limites: strings 4 KB, arrays 50 itens, objetos 100 chaves, profundidade 6, linha final 64 KB.
 * Campos reais (`ts`, `nivel`, `msg`) prevalecem sobre chaves de mesmo nome no contexto.
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
      const texto = `${this.#linha(agora.toISOString(), nivel, msg, contexto)}\n`;
      const dia = `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
      this.#prepararDia(dia);
      fs.appendFileSync(path.join(this.pasta, `pdv-${dia}.log`), texto);
    } catch (error) {
      this.#falhou(error);
      return;
    }
    // Depois de criar o arquivo do dia, para ele contar entre os mantidos. Falha de poda não é falha de escrita.
    if (this.podarPendente) {
      try { this.#podar(); } catch { /* a poda tenta de novo no próximo dia */ }
    }
  }

  /** Monta a linha final (teto de 64 KB); `ts`/`nivel`/`msg` reais vencem chaves iguais do contexto. */
  #linha(ts, nivel, msg, contexto) {
    let extra;
    if (contexto instanceof Error) extra = { erro: contexto };
    else if (contexto && typeof contexto === 'object' && !Array.isArray(contexto)) extra = contexto;
    else extra = contexto === undefined ? {} : { detalhe: contexto };
    const fixos = msg instanceof Error ? { msg: msg.message, erro: msg } : { msg: comoTexto(msg) };
    const completa = this.#serializar({ ...this.#chaves(extra), ts, nivel, ...fixos });
    if (Buffer.byteLength(completa) <= MAX_LINHA) return completa;
    return JSON.stringify({ ts, nivel, msg: cortar(comoTexto(fixos.msg), 1024), truncado: true });
  }

  /** Cópia rasa tolerante a getters que lançam e proxies exóticos. */
  #chaves(obj) {
    const saida = {};
    try {
      for (const k of Object.keys(obj)) {
        try { saida[k] = obj[k]; } catch { saida[k] = ILEGIVEL; }
      }
    } catch { saida.contexto = ILEGIVEL; }
    return saida;
  }

  /** Ao abrir/virar o dia: garante a pasta e agenda a poda (uma vez por dia). */
  #prepararDia(dia) {
    if (this.diaPreparado === dia) return;
    fs.mkdirSync(this.pasta, { recursive: true });
    this.diaPreparado = dia;
    this.podarPendente = true;
  }

  #podar() {
    this.podarPendente = false;
    const nomes = fs.readdirSync(this.pasta).filter((n) => PADRAO_ARQUIVO.test(n)).sort();
    for (const nome of nomes.slice(0, Math.max(0, nomes.length - this.manter))) {
      try { fs.unlinkSync(path.join(this.pasta, nome)); } catch { /* segue com os demais */ }
    }
  }

  #falhou(error) {
    this.falhas += 1;
    if (this.falhas === 1) {
      try { console.error(`[log] não foi possível gravar o log: ${error.message}`); } catch { /* nada a fazer */ }
    }
  }

  /** JSON seguro e limitado: circular, BigInt, Error, segredos mascarados, getters que lançam e tamanhos máximos. */
  #serializar(valor) {
    const pilha = new WeakSet();
    const limpar = (v, chave, nivel) => {
      if (chave && SEGREDOS.has(String(chave).toLowerCase())) return '***';
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'string') return cortar(v, MAX_STRING);
      if (typeof v === 'function' || typeof v === 'symbol') return cortar(comoTexto(v), MAX_STRING);
      if (v === null || typeof v !== 'object') return v;
      if (pilha.has(v)) return '[Circular]';
      if (nivel >= MAX_PROFUNDIDADE) return '[profundo]';
      pilha.add(v);
      try {
        return objeto(v, nivel);
      } catch {
        return ILEGIVEL;
      } finally {
        pilha.delete(v); // só ancestrais contam como ciclo; a mesma referência repetida em ramos irmãos é permitida
      }
    };
    const objeto = (v, nivel) => {
      if (v instanceof Error) {
        return { nome: limpar(v.name, null, nivel + 1), mensagem: limpar(v.message, null, nivel + 1), stack: limpar(v.stack, null, nivel + 1) };
      }
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
      if (Array.isArray(v)) {
        const itens = [];
        const total = v.length;
        for (let i = 0; i < Math.min(total, MAX_ITENS); i += 1) {
          try { itens.push(limpar(v[i], null, nivel + 1)); } catch { itens.push(ILEGIVEL); }
        }
        if (total > MAX_ITENS) itens.push(`…+${total - MAX_ITENS}`);
        return itens;
      }
      const saida = {};
      const chaves = Object.keys(v);
      for (const k of chaves.slice(0, MAX_CHAVES)) {
        try { saida[k] = limpar(v[k], k, nivel + 1); } catch { saida[k] = ILEGIVEL; }
      }
      if (chaves.length > MAX_CHAVES) saida['…'] = `+${chaves.length - MAX_CHAVES} chaves`;
      return saida;
    };
    return JSON.stringify(limpar(valor, null, 0));
  }
}

module.exports = JsonLineLogger;
