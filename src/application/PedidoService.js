'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const ValidationError = require('../domain/errors/ValidationError');
const ForbiddenError = require('../domain/errors/ForbiddenError');
const { validarIdentificacao, OBSERVACAO_MAX } = require('../domain/pedido/ItemValidator');
const { calcularPedido, centavos } = require('../domain/pedido/calculos');
const { podeTransitar } = require('../domain/pedido/situacoes');

const MOTIVO_MAX = 200;
const LIMITE_LISTA = 1000;
const NIVEIS_PEDIDO = ['A', 'B'];
const NAO_PAGOS = ['ABERTO', 'AGUARDANDO_PAGAMENTO'];

const ehComandaDuplicada = (error) => /UNIQUE/i.test(error?.message || '') && /pedidos\.mesa_id/i.test(error?.message || '');

/** Data local AAAA-MM-DD do instante `ms`. */
function dataLocalDe(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function motivoDe(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) throw new ValidationError('Informe o motivo');
  if ([...texto].length > MOTIVO_MAX) throw new ValidationError(`O motivo deve ter no máximo ${MOTIVO_MAX} caracteres`);
  return texto;
}

function observacaoDe(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ValidationError('A observação deve ser um texto');
  const texto = valor.trim();
  if ([...texto].length > OBSERVACAO_MAX) throw new ValidationError(`A observação deve ter no máximo ${OBSERVACAO_MAX} caracteres`);
  return texto || null;
}

/** Casos de uso do pedido (RN-05/RN-06): balcão e comanda de mesa, rodadas para a cozinha, finalizar, cancelar. */
class PedidoService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/database/SqliteDatabase')} deps.db
   * @param {import('../infrastructure/repositories/PedidoRepository')} deps.repository
   * @param {import('./MontadorDeItens')} deps.montador
   * @param {import('../infrastructure/repositories/MesaRepository')} deps.mesaRepository
   * @param {import('./MesaService')} deps.mesas
   * @param {import('./ConfigService')} deps.config
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/events/EventBus')} [deps.bus]
   * @param {() => number} [deps.relogio] "agora" em ms
   * @param {(pedidoId:number) => boolean} [deps.temPagamentoPendente] porta ligada aos pagamentos (Tarefa 17)
   */
  constructor({ db, repository, montador, mesaRepository, mesas, config, audit, bus = null, relogio = Date.now, temPagamentoPendente = () => false }) {
    Object.assign(this, { db, repository, montador, mesaRepository, mesas, config, audit, bus, relogio, temPagamentoPendente });
  }

  criar(user, body = {}) {
    this.#exigirAtendente(user);
    const ident = validarIdentificacao(body);
    const observacao = observacaoDe(body.observacao);
    const itens = this.montador.montar(body.itens);
    const { resultado: id, eventosMesa } = this.#escreverComMesas((eventos) => {
      if (ident.tipo === 'MESA') this.#exigirMesaDisponivel(ident.mesaId);
      const agora = this.relogio();
      const dataLocal = dataLocalDe(agora);
      const pedidoId = this.repository.insert({
        ...ident, observacao, dataLocal, numeroDia: this.repository.proximoNumero(dataLocal), criadoPor: user.id, criadoEm: new Date(agora).toISOString(),
      });
      this.#inserirItens(pedidoId, itens);
      this.#recalcular(pedidoId);
      if (ident.tipo === 'MESA') this.#ocuparSeNecessario(user, ident.mesaId, eventos);
      const criado = this.repository.findById(pedidoId);
      this.#log(user, 'criar', criado, 'criado', null, criado);
      return pedidoId;
    });
    return this.#publicar(id, eventosMesa);
  }

  adicionarItens(user, pedidoId, entradas) {
    this.#exigirAtendente(user);
    const itens = this.montador.montar(entradas, { exigirAoMenosUm: true });
    this.#escrever(() => {
      const antes = this.#exigirSituacao(pedidoId, ['ABERTO']);
      this.#inserirItens(antes.id, itens);
      this.#recalcular(antes.id);
      this.#log(user, 'alterar', antes, 'recebeu itens', antes, this.repository.findById(antes.id));
    });
    return this.#publicar(pedidoId);
  }

  substituirPendentes(user, pedidoId, body = {}) {
    this.#exigirAtendente(user);
    const itens = this.montador.montar(body.itens);
    const { eventosMesa } = this.#escreverComMesas((eventos) => {
      const antes = this.#exigirSituacao(pedidoId, ['ABERTO']);
      const campos = {};
      if (body.observacao !== undefined) campos.observacao = observacaoDe(body.observacao);
      if (body.clienteNome !== undefined || (antes.tipo === 'MESA' && body.mesaId !== undefined)) {
        const ident = validarIdentificacao({
          tipo: antes.tipo, mesaId: body.mesaId ?? antes.mesaId, clienteNome: body.clienteNome !== undefined ? body.clienteNome : antes.clienteNome,
        });
        campos.clienteNome = ident.clienteNome;
        if (antes.tipo === 'MESA' && ident.mesaId !== antes.mesaId) this.#moverComanda(user, antes, ident.mesaId, eventos);
      }
      this.repository.update(antes.id, campos);
      this.repository.removerPendentes(antes.id);
      this.#inserirItens(antes.id, itens);
      this.#recalcular(antes.id);
      this.#log(user, 'alterar', antes, 'alterado', antes, this.repository.findById(antes.id));
    });
    return this.#publicar(pedidoId, eventosMesa);
  }

  enviarCozinha(user, pedidoId) {
    this.#exigirAtendente(user);
    const envio = this.#escrever(() => {
      const pedido = this.#exigirSituacao(pedidoId, ['ABERTO']);
      return this.#enviar(user, pedido);
    });
    this.#publicar(pedidoId);
    return envio;
  }

  cancelarItem(user, pedidoId, itemId, motivo) {
    this.#exigirAtendente(user);
    const texto = motivoDe(motivo);
    this.#escrever(() => {
      const antes = this.#exigirSituacao(pedidoId, NAO_PAGOS);
      const item = this.repository.itens(antes.id).find((i) => i.id === Number(itemId));
      if (!item) throw new NotFoundError('Item não encontrado');
      if (item.cancelado) throw new ConflictError('O item já está cancelado');
      if (item.envioId === null) throw new ValidationError('Item ainda não enviado: retire-o editando o pedido');
      this.repository.cancelarItem(item.id, { canceladoEm: this.#agoraIso(), canceladoPor: user.id, motivo: texto });
      this.#recalcular(antes.id);
      this.audit.record({
        actor: user, acao: 'cancelar_item', entidade: 'pedido', entidadeId: antes.id,
        descricao: `Item "${item.pratoNome}" do pedido ${antes.numeroDia} cancelado: ${texto}`, antes: item, depois: this.repository.findById(antes.id),
      });
    });
    return this.#publicar(pedidoId);
  }

  mover(user, pedidoId, mesaId) {
    this.#exigirAtendente(user);
    const { eventosMesa } = this.#escreverComMesas((eventos) => {
      const antes = this.#exigirSituacao(pedidoId, ['ABERTO']);
      if (antes.tipo !== 'MESA') throw new ConflictError('Só comandas de mesa podem ser movidas');
      const destino = validarIdentificacao({ tipo: 'MESA', mesaId }).mesaId;
      if (destino === antes.mesaId) return;
      this.#moverComanda(user, antes, destino, eventos);
    });
    return this.#publicar(pedidoId, eventosMesa);
  }

  finalizar(user, pedidoId) {
    this.#exigirAtendente(user);
    this.#escrever(() => {
      const antes = this.#exigirSituacao(pedidoId, ['ABERTO']);
      const itens = this.repository.itens(antes.id);
      const pendentes = itens.filter((i) => i.envioId === null && !i.cancelado);
      if (antes.tipo === 'MESA' && pendentes.length) throw new ConflictError('Há itens não enviados à cozinha');
      const totais = this.#recalcular(antes.id);
      if (!itens.some((i) => !i.cancelado) || totais.totalCents === 0) throw new ValidationError('O pedido não tem itens a cobrar (total zero)');
      if (antes.tipo === 'BALCAO' && pendentes.length && this.config.get('cozinha.enviar_em') === 'FINALIZADO') this.#enviar(user, antes);
      this.repository.update(antes.id, { situacao: 'AGUARDANDO_PAGAMENTO', finalizadoEm: this.#agoraIso() });
      this.#log(user, 'finalizar', antes, 'finalizado', antes, this.repository.findById(antes.id));
    });
    return this.#publicar(pedidoId);
  }

  reabrir(user, pedidoId) {
    this.#exigirAtendente(user);
    this.#escrever(() => {
      const antes = this.#exigirSituacao(pedidoId, ['AGUARDANDO_PAGAMENTO']);
      if (this.temPagamentoPendente(antes.id)) throw new ConflictError('Há um pagamento em andamento para este pedido');
      this.repository.update(antes.id, { situacao: 'ABERTO', finalizadoEm: null });
      this.#log(user, 'reabrir', antes, 'reaberto', antes, this.repository.findById(antes.id));
    });
    return this.#publicar(pedidoId);
  }

  cancelar(user, pedidoId, motivo) {
    this.#exigirAtendente(user);
    const texto = motivoDe(motivo);
    this.#escrever(() => {
      const antes = this.#exigir(pedidoId);
      if (antes.situacao === 'PAGO' && user?.nivel !== 'A') throw new ForbiddenError('Só o nível A pode cancelar um pedido pago');
      if (!podeTransitar(antes.situacao, 'CANCELADO')) throw new ConflictError('Este pedido não pode ser cancelado');
      this.repository.update(antes.id, { situacao: 'CANCELADO', canceladoEm: this.#agoraIso(), canceladoPor: user.id, motivoCancelamento: texto });
      this.#log(user, 'cancelar', antes, `cancelado: ${texto}`, antes, this.repository.findById(antes.id));
    });
    return this.#publicar(pedidoId);
  }

  aplicarDesconto(user, pedidoId, descontoCents) {
    if (user?.nivel !== 'A') throw new ForbiddenError('Só o nível A pode aplicar desconto');
    centavos(descontoCents, 'O desconto');
    this.#escrever(() => {
      const antes = this.#exigirSituacao(pedidoId, NAO_PAGOS);
      const totais = calcularPedido(this.repository.itens(antes.id), descontoCents);
      this.repository.update(antes.id, totais);
      this.#log(user, 'desconto', antes, `recebeu desconto de ${descontoCents} centavos`, antes, this.repository.findById(antes.id));
    });
    return this.#publicar(pedidoId);
  }

  listar({ de, ate, situacao, mesaId, atendenteId, q } = {}) {
    const hoje = dataLocalDe(this.relogio());
    return this.repository.listar({ de: de || hoje, ate: ate || de || hoje, situacao, mesaId, atendenteId, q })
      .map((p) => ({ ...p, pagamentos: [] }));
  }

  /** Linhas da grade de pedidos (máx. 1000), com o resumo das rodadas da cozinha. */
  listarResumo(filtros = {}) {
    const pedidos = this.listar(filtros).slice(0, LIMITE_LISTA);
    const cozinha = this.repository.resumosCozinha(pedidos.map((p) => p.id));
    return pedidos.map((p) => ({
      id: p.id, numeroDia: p.numeroDia, criadoEm: p.criadoEm, tipo: p.tipo, mesa: p.mesaNumero, clienteNome: p.clienteNome,
      qtdItens: p.qtdItens, totalCents: p.totalCents, situacao: p.situacao, forma: p.forma, cozinha: cozinha.get(p.id) ?? null, atendente: p.atendente,
    }));
  }

  /** Comanda ainda não paga da mesa; 404 se não houver. */
  comandaDaMesa(mesaId) {
    const id = this.repository.comandaNaoPagaDaMesa(mesaId);
    if (id === null) throw new NotFoundError('A mesa não tem comanda aberta');
    return this.obter(id);
  }

  obter(id) {
    const pedido = this.#exigir(id);
    return { ...pedido, itens: this.repository.itens(pedido.id), envios: this.repository.envios(pedido.id), pagamentos: [] };
  }

  #enviar(user, pedido) {
    const pendentes = this.repository.pendentesParaEnvio(pedido.id);
    if (!pendentes.length) throw new ValidationError('Não há itens pendentes para enviar');
    const envio = this.repository.criarEnvio(pedido.id, {
      vaiParaCozinha: pendentes.some((i) => i.vai_para_cozinha), enviadoEm: this.#agoraIso(), enviadoPor: user.id,
    });
    this.audit.record({
      actor: user, acao: 'enviar', entidade: 'pedido', entidadeId: pedido.id,
      descricao: `Pedido ${pedido.numeroDia} enviado (rodada ${envio.rodada})`, antes: null, depois: envio,
    });
    return envio;
  }

  /** Atualiza `mesa_id` primeiro, ocupa a nova e só então libera a antiga. */
  #moverComanda(user, antes, destinoId, eventos) {
    this.#exigirMesaDisponivel(destinoId);
    try {
      this.repository.update(antes.id, { mesaId: destinoId });
    } catch (error) {
      if (ehComandaDuplicada(error)) throw new ConflictError('A mesa de destino já tem comanda aberta');
      throw error;
    }
    this.#ocuparSeNecessario(user, destinoId, eventos);
    this.mesas.liberar(user, antes.mesaId, { eventos });
    this.#log(user, 'mover', antes, `movido para outra mesa`, antes, this.repository.findById(antes.id));
  }

  #exigirMesaDisponivel(mesaId) {
    const mesa = this.mesaRepository.findById(mesaId);
    if (!mesa) throw new NotFoundError('Mesa não encontrada');
    if (!mesa.ativo) throw new ConflictError('Mesa inativa');
    if (this.repository.comandaNaoPagaDaMesa(mesa.id) !== null) throw new ConflictError('A mesa já tem comanda aberta');
    return mesa;
  }

  /** Mesa ocupada à mão (sem comanda) é aceita como está. */
  #ocuparSeNecessario(user, mesaId, eventos) {
    if (this.mesaRepository.findById(mesaId).situacao !== 'OCUPADA') this.mesas.ocupar(user, mesaId, { eventos });
  }

  /** Só níveis A e B escrevem pedidos (a cozinha, nível C, não). */
  #exigirAtendente(user) {
    if (!NIVEIS_PEDIDO.includes(user?.nivel)) throw new ForbiddenError('Sem permissão para alterar pedidos');
  }

  /** Executa na transação coletando os eventos `mesa`, que só são publicados depois do commit. */
  #escreverComMesas(work) {
    const eventos = [];
    const resultado = this.#escrever(() => work(eventos));
    return { resultado, eventosMesa: eventos };
  }

  #inserirItens(pedidoId, itens) {
    let ordem = this.repository.proximaOrdem(pedidoId);
    for (const item of itens) this.repository.insertItem(pedidoId, item, ordem++);
  }

  /** Recalcula e grava subtotal/desconto/total; o desconto é limitado ao novo subtotal. */
  #recalcular(pedidoId) {
    const pedido = this.repository.findById(pedidoId);
    const itens = this.repository.itens(pedidoId);
    const { subtotalCents } = calcularPedido(itens, 0);
    const totais = calcularPedido(itens, Math.min(pedido.descontoCents, subtotalCents));
    this.repository.update(pedidoId, totais);
    return totais;
  }

  #escrever(work) {
    try {
      return this.db.transaction(work);
    } catch (error) {
      if (ehComandaDuplicada(error)) throw new ConflictError('A mesa já tem comanda aberta');
      throw error;
    }
  }

  #publicar(pedidoId, eventosMesa = []) {
    for (const evento of eventosMesa) this.bus?.publish('mesa', evento);
    const pedido = this.obter(pedidoId);
    this.bus?.publish('pedido', { id: pedido.id, situacao: pedido.situacao });
    return pedido;
  }

  #agoraIso() {
    return new Date(this.relogio()).toISOString();
  }

  #log(user, acao, pedido, verbo, antes, depois) {
    this.audit.record({ actor: user, acao, entidade: 'pedido', entidadeId: pedido.id, descricao: `Pedido ${pedido.numeroDia} ${verbo}`, antes, depois });
  }

  #exigirSituacao(id, situacoes) {
    const pedido = this.#exigir(id);
    if (!situacoes.includes(pedido.situacao)) throw new ConflictError('Operação não permitida na situação atual do pedido');
    return pedido;
  }

  #exigir(id) {
    const pedido = this.repository.findById(Number(id));
    if (!pedido) throw new NotFoundError('Pedido não encontrado');
    return pedido;
  }
}

module.exports = PedidoService;
