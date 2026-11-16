'use strict';
const ForbiddenError = require('../domain/errors/ForbiddenError');
const NotFoundError = require('../domain/errors/NotFoundError');
const { TIPOS, obterTipo, validarAgrupar, validarLimite, ticketMedio } = require('../domain/relatorio/tipos');
const { resolverPeriodo, chaveLocal, agruparPorChave } = require('../domain/relatorio/periodo');

const PRONTOS = new Set(['PRONTO_RETIRADA', 'PRONTO_ENTREGA']);
const porNome = (a, b) => a.localeCompare(b, 'pt-BR');
const soma = (linhas, campo) => linhas.reduce((t, l) => t + l[campo], 0);

function exigirAdmin(user) {
  if (!user || user.nivel !== 'A') throw new ForbiddenError('Sem permissão para relatórios');
}

/** Relatórios (só nível A): `{ titulo, periodo, colunas, linhas, totais }` com dinheiro em centavos e duração em segundos. */
class RelatorioService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/RelatorioRepository')} deps.repository
   * @param {() => number} deps.relogio
   */
  constructor({ repository, relogio }) {
    Object.assign(this, { repository, relogio });
  }

  /** Tipos disponíveis com título e filtros aceitos. */
  listar(user) {
    exigirAdmin(user);
    return TIPOS.map(({ tipo, titulo, filtros }) => ({ tipo, titulo, filtros: [...filtros] }));
  }

  gerar(user, tipo, filtros = {}) {
    exigirAdmin(user);
    const def = obterTipo(tipo);
    if (!def) throw new NotFoundError('Relatório não encontrado');
    const semPeriodo = def.filtros.length === 0;
    const periodo = semPeriodo ? null : resolverPeriodo(filtros, this.relogio());
    const opcoes = { agrupar: validarAgrupar(filtros.agrupar), limite: validarLimite(filtros.limite) };
    const { linhas, totais } = this.#montar(tipo, periodo, opcoes);
    return { titulo: def.titulo, periodo: periodo && { de: periodo.de, ate: periodo.ate }, colunas: def.colunas.map((c) => ({ ...c })), linhas, totais };
  }

  /**
   * Dashboard de vendas (pedidos FINALIZADOS). Filtros: período, `tipo` (PRATO|BEBIDA), `categoriaId` (pratos) e `itens` (lista "PRATO:id"/"BEBIDA:id").
   * Sem filtro de item, faturamento = total dos pedidos; com filtro, = soma dos itens que passam no filtro.
   */
  dashboard(user, filtros = {}) {
    exigirAdmin(user);
    const p = resolverPeriodo(filtros, this.relogio());
    const escolhidos = new Set(filtros.itens ?? []);
    const passa = (i) => (!filtros.tipo || i.item_tipo === filtros.tipo)
      && (!filtros.categoriaId || i.categoria_id === filtros.categoriaId)
      && (escolhidos.size === 0 || escolhidos.has(`${i.item_tipo}:${i.prato_id ?? i.bebida_id}`));
    const filtrado = Boolean(filtros.tipo || filtros.categoriaId || escolhidos.size);
    const itens = this.repository.itensFinalizados(p.inicioIso, p.fimIso).filter(passa);

    const ranking = new Map();
    for (const i of itens) {
      const id = i.prato_id ?? i.bebida_id;
      const chave = `${i.item_tipo}:${id}`;
      const r = ranking.get(chave) ?? { tipo: i.item_tipo, itemId: id, nome: i.item_nome, categoria: i.categoria_nome ?? null, quantidade: 0, totalCents: 0, pedidos: new Set() };
      r.nome = i.item_nome; r.quantidade += i.quantidade; r.totalCents += i.total_cents; r.pedidos.add(i.pedido_id);
      ranking.set(chave, r);
    }
    const linhas = [...ranking.values()].map(({ pedidos, ...r }) => ({ ...r, pedidos: pedidos.size }))
      .sort((a, b) => b.quantidade - a.quantidade || b.totalCents - a.totalCents || porNome(a.nome, b.nome));

    // Um "pedido" por id; o valor vem do total do pedido (sem filtro de item) ou da soma dos itens filtrados.
    const doPedido = new Map();
    if (filtrado) {
      for (const i of itens) {
        const x = doPedido.get(i.pedido_id) ?? { em: i.finalizado_em, cents: 0 };
        x.cents += i.total_cents; doPedido.set(i.pedido_id, x);
      }
    } else {
      for (const r of this.repository.pedidosFinalizados(p.inicioIso, p.fimIso)) doPedido.set(r.id, { em: r.finalizado_em, cents: r.total_cents });
    }
    const pedidos = [...doPedido.values()];
    const faturamentoCents = soma(pedidos.map((x) => ({ c: x.cents })), 'c');
    const porDia = [...agruparPorChave(pedidos, (x) => chaveLocal(x.em, 'dia')).entries()]
      .map(([dia, g]) => ({ dia, pedidos: g.length, faturamentoCents: g.reduce((t, x) => t + x.cents, 0) }));
    const porCategoria = new Map();
    for (const l of linhas) {
      const nome = l.tipo === 'BEBIDA' ? 'Bebidas' : (l.categoria ?? 'Sem categoria');
      const c = porCategoria.get(nome) ?? { categoria: nome, quantidade: 0, totalCents: 0 };
      c.quantidade += l.quantidade; c.totalCents += l.totalCents; porCategoria.set(nome, c);
    }
    return {
      periodo: { de: p.de, ate: p.ate },
      resumo: { pedidos: pedidos.length, faturamentoCents, ticketMedioCents: ticketMedio(faturamentoCents, pedidos.length), itensVendidos: soma(linhas, 'quantidade') },
      ranking: linhas,
      porDia,
      porCategoria: [...porCategoria.values()].sort((a, b) => b.totalCents - a.totalCents),
      catalogo: this.repository.catalogo(),
    };
  }

  #montar(tipo, p, { agrupar, limite }) {
    switch (tipo) {
      case 'pedidos-periodo': return this.#pedidosPeriodo(p);
      case 'pedidos-finalizados': return this.#finalizados(p);
      case 'pedidos-cancelados': return this.#cancelados(p);
      case 'tempo-medio-preparo': return this.#tempoPreparo(p);
      case 'faturamento': return this.#faturamento(p, agrupar);
      case 'ticket-medio': return this.#ticketMedio(p);
      case 'bebidas-mais-vendidas': return this.#bebidasMaisVendidas(p, limite);
      case 'estoque-atual': return this.#estoque(false);
      case 'estoque-critico': return this.#estoque(true);
      case 'clientes-frequentes': return this.#clientes(p, limite, (a, b) => b.quantidade - a.quantidade || b.gastoCents - a.gastoCents);
      default: return this.#clientes(p, limite, (a, b) => b.gastoCents - a.gastoCents || b.quantidade - a.quantidade);
    }
  }

  #pedidosPeriodo(p) {
    const linhas = this.repository.pedidosConfirmados(p.inicioIso, p.fimIso).map((r) => ({
      numero: r.id, dataHora: r.confirmado_em, cliente: r.cliente_nome, telefone: r.cliente_telefone, itens: r.itens, totalCents: r.total_cents, status: r.status,
    }));
    const porStatus = {};
    for (const l of linhas) {
      porStatus[l.status] ??= { quantidade: 0, totalCents: 0 };
      porStatus[l.status].quantidade += 1;
      porStatus[l.status].totalCents += l.totalCents;
    }
    return { linhas, totais: { quantidade: linhas.length, totalCents: soma(linhas, 'totalCents'), porStatus } };
  }

  #finalizados(p) {
    const linhas = this.repository.pedidosFinalizados(p.inicioIso, p.fimIso).map((r) => ({
      numero: r.id, finalizadoEm: r.finalizado_em, cliente: r.cliente_nome, telefone: r.cliente_telefone, itens: r.itens, totalCents: r.total_cents,
    }));
    return { linhas, totais: { quantidade: linhas.length, totalCents: soma(linhas, 'totalCents') } };
  }

  #cancelados(p) {
    const linhas = this.repository.pedidosCancelados(p.inicioIso, p.fimIso).map((r) => ({
      numero: r.id, canceladoEm: r.cancelado_em, cliente: r.cliente_nome, telefone: r.cliente_telefone, totalCents: r.total_cents, motivo: r.motivo_cancelamento,
    }));
    return { linhas, totais: { quantidade: linhas.length, totalCents: soma(linhas, 'totalCents') } };
  }

  /** Por pedido: primeiro EM_PREPARO → primeiro PRONTO_* posterior; a linha entra se esse PRONTO cai no período. */
  #tempoPreparo(p) {
    const linhas = [];
    for (const historico of agruparPorChave(this.repository.historicoDePreparo(p.inicioIso, p.fimIso), (h) => h.pedido_id).values()) {
      const inicio = historico.find((h) => h.status_novo === 'EM_PREPARO');
      const pronto = inicio && historico.find((h) => PRONTOS.has(h.status_novo) && h.em >= inicio.em && h !== inicio);
      if (!pronto || pronto.em < p.inicioIso || pronto.em >= p.fimIso) continue;
      linhas.push({
        numero: inicio.pedido_id, cliente: inicio.cliente_nome, inicioPreparo: inicio.em, prontoEm: pronto.em,
        duracaoSegundos: Math.round((Date.parse(pronto.em) - Date.parse(inicio.em)) / 1000),
      });
    }
    linhas.sort((a, b) => (a.prontoEm < b.prontoEm ? -1 : a.prontoEm > b.prontoEm ? 1 : a.numero - b.numero));
    const duracoes = linhas.map((l) => l.duracaoSegundos);
    return {
      linhas,
      totais: duracoes.length === 0
        ? { quantidade: 0, mediaSegundos: null, minimoSegundos: null, maximoSegundos: null }
        : { quantidade: duracoes.length, mediaSegundos: Math.round(soma(linhas, 'duracaoSegundos') / duracoes.length), minimoSegundos: Math.min(...duracoes), maximoSegundos: Math.max(...duracoes) },
    };
  }

  #vendas(pedidos) {
    const faturamentoCents = soma(pedidos, 'total_cents');
    return { quantidade: pedidos.length, faturamentoCents, ticketMedioCents: ticketMedio(faturamentoCents, pedidos.length) };
  }

  #faturamento(p, agrupar) {
    const pedidos = this.repository.pedidosFinalizados(p.inicioIso, p.fimIso);
    const grupos = agruparPorChave(pedidos, (r) => chaveLocal(r.finalizado_em, agrupar));
    const linhas = [...grupos.entries()].map(([periodo, doGrupo]) => ({ periodo, ...this.#vendas(doGrupo) }));
    return { linhas, totais: this.#vendas(pedidos) };
  }

  #ticketMedio(p) {
    const totais = this.#vendas(this.repository.pedidosFinalizados(p.inicioIso, p.fimIso));
    return { linhas: totais.quantidade ? [{ ...totais }] : [], totais };
  }

  #bebidasMaisVendidas(p, limite) {
    const linhas = this.repository.bebidasVendidas(p.inicioIso, p.fimIso)
      .map((r) => ({ bebidaId: r.bebida_id, bebida: r.nome, quantidade: r.quantidade, totalCents: r.total_cents }))
      .sort((a, b) => b.quantidade - a.quantidade || porNome(a.bebida, b.bebida))
      .slice(0, limite);
    return { linhas, totais: { quantidade: soma(linhas, 'quantidade'), totalCents: soma(linhas, 'totalCents') } };
  }

  #estoque(soCritico) {
    const linhas = this.repository.bebidas()
      .map((b) => ({
        bebidaId: b.id, bebida: b.nome, saldo: b.estoque_qtd, minimo: b.estoque_minimo,
        situacao: !b.ativo ? 'INATIVA' : b.estoque_qtd <= b.estoque_minimo ? 'CRITICO' : 'OK',
      }))
      .filter((l) => !soCritico || l.situacao === 'CRITICO')
      .sort((a, b) => porNome(a.bebida, b.bebida) || a.bebidaId - b.bebidaId);
    return { linhas, totais: { quantidade: linhas.length } };
  }

  #clientes(p, limite, ordem) {
    const comCliente = this.repository.pedidosFinalizados(p.inicioIso, p.fimIso).filter((r) => r.cliente_id !== null);
    const linhas = [...agruparPorChave(comCliente, (r) => r.cliente_id).values()]
      .map((pedidos) => ({
        clienteId: pedidos[0].cliente_id, cliente: pedidos[0].cliente_nome, telefone: pedidos[0].cliente_telefone,
        quantidade: pedidos.length, gastoCents: soma(pedidos, 'total_cents'),
      }))
      .sort((a, b) => ordem(a, b) || porNome(a.cliente, b.cliente))
      .slice(0, limite);
    return { linhas, totais: { quantidade: soma(linhas, 'quantidade'), gastoCents: soma(linhas, 'gastoCents') } };
  }
}

module.exports = RelatorioService;
