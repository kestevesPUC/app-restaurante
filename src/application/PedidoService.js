'use strict';
const { formatarNome } = require('../domain/nomePessoa');
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const ValidationError = require('../domain/errors/ValidationError');
const ForbiddenError = require('../domain/errors/ForbiddenError');
const { OBSERVACAO_MAX } = require('../domain/pedido/ItemValidator');
const { calcularPedido } = require('../domain/pedido/calculos');
const { podeTransitar, podeMudarStatus } = require('../domain/pedido/status');
const { estimarPreparo } = require('../domain/pedido/estimativa');
const { normalizarTelefone } = require('../domain/phone');
const { dataLocalDe } = require('./ConsultaDePedidos');

const MOTIVO_MAX = 200;
const CLIENTE_NOME_MAX = 80;
const NIVEIS_PEDIDO = ['A', 'B'];
const ALVOS_MUDAR_STATUS = ['EM_PREPARO', 'PRONTO_RETIRADA', 'PRONTO_ENTREGA', 'FINALIZADO'];

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

/** Cliente opcional do rascunho: nome 1–80 e telefone normalizado, cada um se informado. */
function clienteDe(valor) {
  if (valor === undefined || valor === null) return { clienteNome: null, clienteTelefone: null };
  if (typeof valor !== 'object' || Array.isArray(valor)) throw new ValidationError('Os dados do cliente são inválidos');
  const { nome, telefone } = valor;
  if (nome !== undefined && nome !== null && typeof nome !== 'string') throw new ValidationError('O nome do cliente deve ser um texto');
  const texto = typeof nome === 'string' ? nome.trim() : '';
  if ([...texto].length > CLIENTE_NOME_MAX) throw new ValidationError(`O nome do cliente deve ter no máximo ${CLIENTE_NOME_MAX} caracteres`);
  const vazio = telefone === undefined || telefone === null || (typeof telefone === 'string' && !telefone.trim());
  return { clienteNome: formatarNome(texto) || null, clienteTelefone: vazio ? null : normalizarTelefone(telefone) };
}

/**
 * Casos de uso do pedido da lanchonete (design §4): rascunho, confirmar (baixa de estoque, cliente), reabrir, cancelar e
 * status operacional. Escritas em uma transação; eventos `estoque`/`pedido` e a porta `aposMudarStatus` só depois do commit.
 */
class PedidoService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/database/SqliteDatabase')} deps.db
   * @param {import('../infrastructure/repositories/PedidoRepository')} deps.repository
   * @param {import('./MontadorDeItens')} deps.montador
   * @param {import('./ConsultaDePedidos')} deps.consulta
   * @param {import('./EstoqueService')} deps.estoque
   * @param {import('./ClienteService')} deps.clientes
   * @param {import('./ConfigService')} deps.config
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/events/EventBus')} [deps.bus]
   * @param {() => number} [deps.relogio] "agora" em ms
   * @param {(pedido:object, user:object) => void} [deps.aposMudarStatus] porta pós-commit (WhatsApp, Tarefa 8)
   * @param {Pick<Console,'error'>} [deps.logger]
   */
  constructor({
    db, repository, montador, consulta, estoque, clientes, config, audit, bus = null, relogio = Date.now, aposMudarStatus = () => {}, logger = console,
  }) {
    Object.assign(this, { db, repository, montador, consulta, estoque, clientes, config, audit, bus, relogio, aposMudarStatus, logger });
  }

  criarRascunho(user, body = {}) {
    this.#exigirAtendente(user);
    const cliente = clienteDe(body.cliente);
    const observacao = observacaoDe(body.observacao);
    const itens = this.montador.montar(body.itens);
    const id = this.db.transaction(() => {
      const agora = this.relogio();
      const pedidoId = this.repository.insert({
        ...cliente, observacao, dataLocal: dataLocalDe(agora), criadoPor: user.id, criadoEm: new Date(agora).toISOString(),
      });
      this.#gravarItens(pedidoId, itens);
      const criado = this.repository.findById(pedidoId);
      this.#log(user, 'criar', criado, 'criado', null, criado);
      return pedidoId;
    });
    return this.#publicar(id);
  }

  atualizarRascunho(user, id, body = {}) {
    this.#exigirAtendente(user);
    const campos = {};
    if (body.cliente !== undefined) Object.assign(campos, clienteDe(body.cliente));
    if (body.observacao !== undefined) campos.observacao = observacaoDe(body.observacao);
    const itens = body.itens === undefined ? null : this.montador.montar(body.itens);
    this.db.transaction(() => {
      const antes = this.#exigirStatus(id, 'ABERTO', 'Só pedidos em rascunho podem ser editados');
      this.repository.update(antes.id, campos);
      if (itens) {
        this.repository.removerItens(antes.id);
        this.#gravarItens(antes.id, itens);
      }
      this.#log(user, 'alterar', antes, 'alterado', antes, this.repository.findById(antes.id));
    });
    return this.#publicar(Number(id));
  }

  confirmar(user, id) {
    this.#exigirAtendente(user);
    return this.#transitar(user, id, 'RECEBIDO', 'confirmar', 'confirmado', (antes, eventos) => {
      if (!antes.clienteNome || !antes.clienteTelefone) throw new ValidationError('Informe o nome e o telefone do cliente');
      const itens = this.repository.itens(antes.id);
      if (!itens.length) throw new ValidationError('Informe ao menos um item');
      const cliente = this.clientes.registrar(user, { nome: antes.clienteNome, telefone: antes.clienteTelefone });
      const bebidas = itens.filter((i) => i.tipo === 'BEBIDA').map((i) => ({ bebidaId: i.itemId, quantidade: i.quantidade }));
      eventos.push(...this.estoque.baixarParaPedido(user, antes.id, bebidas));
      return {
        clienteId: cliente.id, clienteNome: cliente.nome, clienteTelefone: cliente.telefone,
        tempoEstimadoMin: estimarPreparo(itens, this.config.get('cozinha.estimativa')), confirmadoEm: this.#agoraIso(),
        senha: antes.senha ?? this.repository.proximaSenha(antes.dataLocal),
      };
    });
  }

  reabrir(user, id) {
    this.#exigirAtendente(user);
    return this.#transitar(user, id, 'ABERTO', 'reabrir', 'reaberto', (antes, eventos) => {
      eventos.push(...this.estoque.estornarPedido(user, antes.id));
      return { confirmadoEm: null, tempoEstimadoMin: 0 };
    });
  }

  cancelar(user, id, motivo) {
    this.#exigirAtendente(user);
    const texto = motivoDe(motivo);
    return this.#transitar(user, id, 'CANCELADO', 'cancelar', `cancelado: ${texto}`, (antes, eventos) => {
      if (antes.status !== 'ABERTO') eventos.push(...this.estoque.estornarPedido(user, antes.id));
      return { canceladoEm: this.#agoraIso(), canceladoPor: user.id, motivoCancelamento: texto };
    });
  }

  /** Status operacional (cozinha/finalização). Confirmar, reabrir e cancelar têm métodos próprios. */
  mudarStatus(user, id, status) {
    if (!ALVOS_MUDAR_STATUS.includes(status)) throw new ValidationError('Use confirmar, reabrir ou cancelar');
    return this.#transitar(user, id, status, 'mudar_status', `passou para ${status}`, (antes) => {
      if (!podeMudarStatus(user?.nivel, antes.status, status)) throw new ForbiddenError('Sem permissão para esta mudança de status');
      return {};
    });
  }

  listar(user, filtros = {}) {
    return this.consulta.listar(user, filtros);
  }

  obter(user, id) {
    return this.consulta.obter(user, id);
  }

  listarCozinha(user) {
    return this.consulta.listarCozinha(user);
  }

  /**
   * Mudança de status numa transação: valida a transição (409), aplica `preparar` (que devolve os campos extras e pode
   * acumular eventos `estoque`), grava status + histórico + auditoria. Depois do commit: eventos e `aposMudarStatus`.
   */
  #transitar(user, id, para, acao, verbo, preparar) {
    const eventos = [];
    const pedidoId = this.db.transaction(() => {
      const antes = this.#exigir(id);
      if (!podeTransitar(antes.status, para)) throw new ConflictError(`Não é possível passar de ${antes.status} para ${para}`);
      const campos = preparar(antes, eventos);
      this.repository.update(antes.id, { ...campos, status: para });
      this.repository.registrarHistorico(antes.id, { de: antes.status, para, actor: user, em: this.#agoraIso() });
      this.#log(user, acao, antes, verbo, antes, this.repository.findById(antes.id));
      return antes.id;
    });
    for (const evento of eventos) this.bus?.publish('estoque', evento);
    const pedido = this.#publicar(pedidoId);
    try {
      this.aposMudarStatus(pedido, user);
    } catch (error) {
      this.logger?.error?.(error);
    }
    return pedido;
  }

  #gravarItens(pedidoId, itens) {
    itens.forEach((item, ordem) => this.repository.insertItem(pedidoId, item, ordem));
    this.repository.update(pedidoId, calcularPedido(this.repository.itens(pedidoId), 0));
  }

  /** Só níveis A e B escrevem pedidos (a cozinha, nível C, só muda status operacional). */
  #exigirAtendente(user) {
    if (!NIVEIS_PEDIDO.includes(user?.nivel)) throw new ForbiddenError('Sem permissão para alterar pedidos');
  }

  #publicar(pedidoId) {
    const pedido = this.consulta.carregar(pedidoId);
    this.bus?.publish('pedido', { id: pedido.id, status: pedido.status });
    return pedido;
  }

  #agoraIso() {
    return new Date(this.relogio()).toISOString();
  }

  #log(user, acao, pedido, verbo, antes, depois) {
    this.audit.record({ actor: user, acao, entidade: 'pedido', entidadeId: pedido.id, descricao: `Pedido ${pedido.id} ${verbo}`, antes, depois });
  }

  #exigirStatus(id, status, mensagem) {
    const pedido = this.#exigir(id);
    if (pedido.status !== status) throw new ConflictError(mensagem);
    return pedido;
  }

  #exigir(id) {
    const pedido = this.repository.findById(Number(id));
    if (!pedido) throw new NotFoundError('Pedido não encontrado');
    return pedido;
  }
}

module.exports = PedidoService;
