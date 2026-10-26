'use strict';
// Raiz de composição: único lugar que conhece as implementações concretas e as injeta (DIP).
const path = require('node:path');

const SqliteDatabase = require('./infrastructure/database/SqliteDatabase');
const UsuarioRepository = require('./infrastructure/repositories/UsuarioRepository');
const AuditRepository = require('./infrastructure/repositories/AuditRepository');
const ConfiguracaoRepository = require('./infrastructure/repositories/ConfiguracaoRepository');
const CategoriaRepository = require('./infrastructure/repositories/CategoriaRepository');
const IngredienteRepository = require('./infrastructure/repositories/IngredienteRepository');
const PratoRepository = require('./infrastructure/repositories/PratoRepository');
const MesaRepository = require('./infrastructure/repositories/MesaRepository');
const PedidoRepository = require('./infrastructure/repositories/PedidoRepository');
const BebidaRepository = require('./infrastructure/repositories/BebidaRepository');
const MovimentacaoRepository = require('./infrastructure/repositories/MovimentacaoRepository');
const ClienteRepository = require('./infrastructure/repositories/ClienteRepository');
const PasswordHasher = require('./infrastructure/security/PasswordHasher');
const SessionStore = require('./infrastructure/security/SessionStore');
const LoginThrottle = require('./infrastructure/security/LoginThrottle');
const EventBus = require('./infrastructure/events/EventBus');

const AuditTrail = require('./application/AuditTrail');
const AuthService = require('./application/AuthService');
const UsuarioService = require('./application/UsuarioService');
const AdminBootstrap = require('./application/AdminBootstrap');
const ConfigService = require('./application/ConfigService');
const CadastroService = require('./application/CadastroService');
const PratoService = require('./application/PratoService');
const MesaService = require('./application/MesaService');
const BebidaService = require('./application/BebidaService');
const EstoqueService = require('./application/EstoqueService');
const ClienteController = require('./presentation/http/controllers/ClienteController');
const ClienteService = require('./application/ClienteService');
const NotificacaoRepository = require('./infrastructure/repositories/NotificacaoRepository');
const MensageiroSimulado = require('./infrastructure/whatsapp/MensageiroSimulado');
const NotificacaoService = require('./application/NotificacaoService');
const WhatsAppController = require('./presentation/http/controllers/WhatsAppController');
const WhatsAppWebMensageiro = require('./infrastructure/whatsapp/WhatsAppWebMensageiro');
const criarClienteWhatsApp = require('./infrastructure/whatsapp/criarClienteWhatsApp');
const NotificacaoController = require('./presentation/http/controllers/NotificacaoController');
const PedidoService = require('./application/PedidoService');
const MontadorDeItens = require('./application/MontadorDeItens');
const ConsultaDePedidos = require('./application/ConsultaDePedidos');
const FotoValidator = require('./domain/validation/FotoValidator');
const { validarCategoria, validarIngrediente } = require('./domain/cardapio/validators');

const Router = require('./presentation/http/Router');
const HttpServer = require('./presentation/http/HttpServer');
const StaticFileHandler = require('./presentation/http/StaticFileHandler');
const CadastroController = require('./presentation/http/controllers/CadastroController');
const PratoController = require('./presentation/http/controllers/PratoController');
const MesaController = require('./presentation/http/controllers/MesaController');
const BebidaController = require('./presentation/http/controllers/BebidaController');
const EstoqueController = require('./presentation/http/controllers/EstoqueController');
const PedidoController = require('./presentation/http/controllers/PedidoController');
const CardapioController = require('./presentation/http/controllers/CardapioController');
const AuthController =require('./presentation/http/controllers/AuthController');
const UsuarioController = require('./presentation/http/controllers/UsuarioController');
const AuditController = require('./presentation/http/controllers/AuditController');
const EventController = require('./presentation/http/controllers/EventController');

const HORA = 60 * 60 * 1000;

/**
 * @param {object} [options]
 * @param {string} [options.dbPath] arquivo SQLite ou ':memory:'
 * @param {() => number} [options.relogio] "agora" em milissegundos (injetável nos testes)
 * @param {string} [options.publicDir] pasta dos arquivos estáticos
 * @param {Pick<Console,'error'>} [options.logger]
 * @param {number} [options.heartbeatMs] intervalo do batimento do canal SSE
 * @param {import('./application/ports/Mensageiro').Mensageiro} [options.mensageiro] padrão: MensageiroSimulado
 * @param {number} [options.notificacaoTimeoutMs] limite de cada envio de WhatsApp
 * @param {{habilitado?: boolean, dataPath?: string, navegador?: string|null}} [options.whatsapp] `habilitado` troca o simulado pelo real
 */
function buildApplication({
  dbPath = ':memory:', relogio = Date.now, publicDir = path.join(__dirname, '..', 'public'), logger = console, heartbeatMs,
  mensageiro: mensageiroInjetado, notificacaoTimeoutMs, whatsapp = {},
} = {}) {
  const clock = () => new Date(relogio());
  const db = new SqliteDatabase(dbPath);

  const repositories = {
    usuarios: new UsuarioRepository(db),
    auditoria: new AuditRepository(db),
    configuracoes: new ConfiguracaoRepository(db),
    categorias: new CategoriaRepository(db),
    ingredientes: new IngredienteRepository(db),
    pratos: new PratoRepository(db),
    mesas: new MesaRepository(db),
    pedidos: new PedidoRepository(db),
    bebidas: new BebidaRepository(db),
    movimentacoes: new MovimentacaoRepository(db),
    clientes: new ClienteRepository(db),
    notificacoes: new NotificacaoRepository(db),
  };
  const hasher = new PasswordHasher();
  const sessions = new SessionStore({ ttlPorNivel: { A: 12 * HORA, B: 12 * HORA, C: null }, now: relogio });
  const throttle = new LoginThrottle({ now: relogio });
  const bus = new EventBus({ logger });
  // WhatsApp real só quando habilitado (Electron); testes e `npm start` ficam com o mensageiro simulado.
  const whatsappReal = Boolean(whatsapp.habilitado) && !mensageiroInjetado;
  const mensageiro = mensageiroInjetado ?? (whatsappReal
    ? new WhatsAppWebMensageiro({
      criarCliente: () => {
        if (!whatsapp.navegador) throw new Error('Navegador não encontrado');
        return criarClienteWhatsApp({ dataPath: whatsapp.dataPath, navegador: whatsapp.navegador });
      },
      relogio, bus, logger,
    })
    : new MensageiroSimulado());
  const erroWhatsApp = () => (whatsappReal && !whatsapp.navegador ? 'Navegador não encontrado' : null);

  const audit = new AuditTrail({ repository: repositories.auditoria, clock });
  const services = {
    hasher,
    audit,
    auth: new AuthService({ usuarios: repositories.usuarios, hasher, sessions, throttle, audit }),
    usuarios: new UsuarioService({ usuarios: repositories.usuarios, hasher, audit, sessions, clock }),
    config: new ConfigService({ repository: repositories.configuracoes, audit }),
    categorias: new CadastroService({ entity: 'categoria', repository: repositories.categorias, validate: validarCategoria, audit }),
    ingredientes: new CadastroService({ entity: 'ingrediente', repository: repositories.ingredientes, validate: validarIngrediente, audit }),
    pratos: new PratoService({
      repository: repositories.pratos, categorias: repositories.categorias, ingredientes: repositories.ingredientes, fotoValidator: new FotoValidator(), audit,
      pratoJaPedido: (id) => repositories.pedidos.pratoJaPedido(id),
    }),
    mesas: new MesaService({ repository: repositories.mesas, audit, bus }),
    adminBootstrap: new AdminBootstrap({ usuarios: repositories.usuarios, hasher, audit, clock }),
  };
  services.bebidas = new BebidaService({ db, repository: repositories.bebidas, movimentacoes: repositories.movimentacoes, audit, bus, clock });
  services.estoque = new EstoqueService({ db, bebidas: repositories.bebidas, movimentacoes: repositories.movimentacoes, audit, bus, clock });
  services.clientes = new ClienteService({ repository: repositories.clientes, audit, clock });
  const consulta = new ConsultaDePedidos({ repository: repositories.pedidos, config: services.config, relogio });
  // PedidoService chama a porta `aposMudarStatus` e NotificacaoService precisa do pedido carregado (consulta.carregar):
  // a função abaixo só resolve `services.notificacoes` no momento da chamada, depois de tudo construído.
  const aposMudarStatus = (pedido, user) => services.notificacoes.aoMudarStatus(pedido, user);
  services.notificacoes = new NotificacaoService({
    repository: repositories.notificacoes, mensageiro, carregarPedido: (id) => {
      try { return consulta.carregar(id); } catch (error) { if (error?.status === 404) return null; throw error; }
    },
    config: services.config, audit, bus, relogio, logger, ...(notificacaoTimeoutMs && { timeoutMs: notificacaoTimeoutMs }),
  });
  services.pedidos = new PedidoService({
    db, repository: repositories.pedidos, estoque: services.estoque, clientes: services.clientes, config: services.config, audit, bus, relogio, logger,
    consulta, aposMudarStatus,
    montador: new MontadorDeItens({
      pratos: repositories.pratos, categorias: repositories.categorias, ingredientes: repositories.ingredientes, bebidas: repositories.bebidas,
    }),
  });

  const router = new Router();
  new AuthController(services.auth).register(router);
  new UsuarioController(services.usuarios).register(router);
  new CadastroController('categorias', services.categorias).register(router);
  new CadastroController('ingredientes', services.ingredientes).register(router);
  new PratoController(services.pratos).register(router);
  new CardapioController(services.pratos).register(router);
  new MesaController(services.mesas).register(router);
  new PedidoController(services.pedidos).register(router);
  new NotificacaoController(services.notificacoes, services.config).register(router);
  new WhatsAppController(mensageiro, services.config, { erro: erroWhatsApp, logger }).register(router);
  new ClienteController(services.clientes).register(router);
  new BebidaController(services.bebidas, services.estoque).register(router);
  new EstoqueController(services.estoque).register(router);
  new AuditController(repositories.auditoria).register(router);
  new EventController(bus, { heartbeatMs }).register(router);

  const server = new HttpServer({ router, authService: services.auth, staticHandler: new StaticFileHandler(publicDir), logger });

  return {
    server, services, repositories, bus, db, mensageiro,
    async close() {
      await server.close();
      await Promise.race([services.notificacoes.aguardarPendentes(), new Promise((r) => setTimeout(r, 2000).unref())]);
      db.close();
    },
  };
}

module.exports = { buildApplication };
