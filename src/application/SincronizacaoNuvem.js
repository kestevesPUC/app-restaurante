'use strict';
const ConflictError = require('../domain/errors/ConflictError');
const ExternalServiceError = require('../domain/errors/ExternalServiceError');

/**
 * Copia o banco local para a nuvem de tempos em tempos e também sob demanda (botão "Sincronizar").
 * Depois de QUALQUER rodada (automática ou manual) a contagem do intervalo recomeça do zero.
 * `sync`: objeto com `sincronizar()` e `estado` (veja SqlitePostgresSync). Sem `sync`, o serviço fica inativo.
 */
class SincronizacaoNuvem {
  /**
   * @param {object} deps
   * @param {{sincronizar(): Promise<object>, estado: object}|null} [deps.sync]
   * @param {number} [deps.intervaloMs]
   * @param {(estado: object) => void} [deps.salvarEstado] chamado quando uma rodada envia ou recebe algo
   * @param {(pull: {importados: number}) => void} [deps.aoImportar] chamado quando chegam dados da nuvem (ex.: avisar a tela)
   * @param {() => number} [deps.relogio]
   * @param {Pick<Console,'error'>} [deps.logger]
   */
  constructor({ sync = null, intervaloMs = 5000, salvarEstado = () => {}, aoImportar = () => {}, relogio = Date.now, logger = console } = {}) {
    Object.assign(this, { sync, intervaloMs, salvarEstado, aoImportar, relogio, logger });
    this.timer = null;
    this.ativo = false;
    this.emCurso = null;
    this.ultimaEm = null;
    this.ultimoErro = null;
    this.ultimoResumo = null;
    this.proximaEm = null;
  }

  get configurado() { return Boolean(this.sync); }

  status() {
    if (!this.configurado) return { configurado: false };
    return {
      configurado: true,
      ativo: this.ativo,
      sincronizando: Boolean(this.emCurso),
      intervaloSeg: this.intervaloMs / 1000,
      ultimaEm: this.ultimaEm && new Date(this.ultimaEm).toISOString(),
      proximaEm: this.proximaEm && new Date(this.proximaEm).toISOString(),
      ultimoErro: this.ultimoErro,
      ultimoResumo: this.ultimoResumo,
      importados: this.sync.ultimoPull?.importados ?? 0,
      falhasImportacao: this.sync.falhasPull ?? [],
      avisosImportacao: this.sync.avisosPull ?? [],
    };
  }

  /** Liga a rotina automática (primeira rodada logo em seguida). */
  iniciar() {
    if (!this.configurado || this.ativo) return;
    this.ativo = true;
    this.#agendar(500);
  }

  parar() {
    this.ativo = false;
    this.#cancelar();
  }

  /**
   * Sincroniza agora e reinicia a contagem. Se já houver uma rodada em andamento, espera por ela.
   * @throws {ConflictError} sem configuração; {ExternalServiceError} se o envio falhar
   */
  async sincronizarAgora() {
    if (!this.configurado) throw new ConflictError('A sincronização com a nuvem não está configurada');
    if (!this.emCurso) await this.#rodar();
    else await this.emCurso.catch(() => {});
    if (this.ultimoErro) throw new ExternalServiceError(`Não foi possível sincronizar: ${this.ultimoErro}`);
    return this.status();
  }

  async #rodar() {
    this.#cancelar();
    this.emCurso = (async () => {
      try {
        const resumo = await this.sync.sincronizar();
        if (Object.keys(resumo).length || this.sync.estadoMudou) { this.salvarEstado(this.sync.estado); this.sync.estadoMudou = false; }
        if (this.sync.ultimoPull?.importados > 0) this.aoImportar(this.sync.ultimoPull);
        this.ultimoResumo = resumo;
        this.ultimoErro = null;
      } catch (erro) {
        this.ultimoErro = erro.message;
        this.logger.error?.('falha na sincronização com a nuvem', { motivo: erro.message });
      } finally {
        this.ultimaEm = this.relogio();
      }
    })();
    try { await this.emCurso; } finally {
      this.emCurso = null;
      if (this.ativo) this.#agendar(this.intervaloMs); // recomeça a contagem depois de cada rodada
    }
  }

  #agendar(ms) {
    this.#cancelar();
    this.proximaEm = this.relogio() + ms;
    this.timer = setTimeout(() => { this.#rodar().catch(() => {}); }, ms);
    this.timer.unref?.();
  }

  #cancelar() {
    clearTimeout(this.timer);
    this.timer = null;
    this.proximaEm = null;
  }
}

module.exports = SincronizacaoNuvem;
