'use strict';
const ValidationError = require('../domain/errors/ValidationError');
const ForbiddenError = require('../domain/errors/ForbiddenError');
const NotFoundError = require('../domain/errors/NotFoundError');
const { normalizarTelefone } = require('../domain/phone');
const { normalizarNome } = require('../domain/cardapio/validators');
const { formatarNome } = require('../domain/nomePessoa');

const NOME_MAX = 80;
const LIMITE_MAX = 200;
const ULTIMOS_PEDIDOS = 10;

function exigirAtendimento(user) {
  if (!user || (user.nivel !== 'A' && user.nivel !== 'B')) throw new ForbiddenError('Sem permissão para consultar clientes');
}

function validarNomeCliente(valor) {
  const nome = typeof valor === 'string' ? valor.trim() : '';
  if (!nome) throw new ValidationError('Informe o nome do cliente');
  if ([...nome].length > NOME_MAX) throw new ValidationError(`O nome do cliente deve ter no máximo ${NOME_MAX} caracteres`);
  return formatarNome(nome);
}

/** Cadastro de clientes por telefone. `registrar` é síncrono e não abre transação: roda dentro da transação do pedido. */
class ClienteService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/ClienteRepository')} deps.repository
   * @param {import('./AuditTrail')} deps.audit
   * @param {() => Date} deps.clock
   */
  constructor({ repository, audit, clock }) {
    this.repository = repository;
    this.audit = audit;
    this.clock = clock;
  }

  /** Upsert por telefone normalizado. Audita só a criação e a mudança de nome. */
  registrar(actor, { nome, telefone } = {}) {
    const fone = normalizarTelefone(telefone);
    const nomeValido = validarNomeCliente(nome);
    const em = this.clock().toISOString();
    const atual = this.repository.findByTelefone(fone);
    if (!atual) {
      const criado = this.repository.create(nomeValido, fone, em);
      this.audit.record({ actor, acao: 'cliente_criado', entidade: 'cliente', entidadeId: criado.id, descricao: `Cliente "${criado.nome}" (${fone}) cadastrado`, antes: null, depois: criado });
      return criado;
    }
    if (atual.nome === nomeValido) return atual;
    this.repository.atualizarNome(atual.id, nomeValido, em);
    const depois = { ...atual, nome: nomeValido, atualizadoEm: em };
    this.audit.record({ actor, acao: 'cliente_nome_alterado', entidade: 'cliente', entidadeId: atual.id, descricao: `Nome do cliente ${fone} alterado de "${atual.nome}" para "${nomeValido}"`, antes: atual, depois });
    return depois;
  }

  /** `q` vazio: mais recentes; só dígitos: telefone contém; senão nome sem acento/maiúsculas. */
  buscar(user, { q = '', limite = 50 } = {}) {
    exigirAtendimento(user);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAX) throw new ValidationError(`O limite deve ser um inteiro entre 1 e ${LIMITE_MAX}`);
    const termo = typeof q === 'string' ? q.trim() : '';
    if (!termo) return this.repository.recentes(limite);
    const digitos = termo.replace(/\D/g, '');
    if (/^[\d\s()+-]+$/.test(termo)) return digitos ? this.repository.porDigitos(digitos, limite) : [];
    const alvo = normalizarNome(termo);
    return this.repository.todos().filter((c) => normalizarNome(c.nome).includes(alvo)).slice(0, limite);
  }

  /** Histórico do cliente: qtd, gasto e última compra só de FINALIZADOS; 10 últimos pedidos confirmados. */
  historico(user, id) {
    exigirAtendimento(user);
    const cliente = this.repository.buscarPorId(id);
    if (!cliente) throw new NotFoundError('Cliente não encontrado');
    return { cliente, ...this.repository.resumo(id), ultimosPedidos: this.repository.ultimosPedidos(id, ULTIMOS_PEDIDOS) };
  }
}

module.exports = ClienteService;
