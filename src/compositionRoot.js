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
 */
function buildApplication({
  dbPath = ':memory:', relogio = Date.now, publicDir = path.join(__dirname, '..', 'public'), logger = console, heartbeatMs,
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
  };
  const hasher = new PasswordHasher();
  const sessions = new SessionStore({ ttlPorNivel: { A: 12 * HORA, B: 12 * HORA, C: null }, now: relogio });
  const throttle = new LoginThrottle({ now: relogio });
  const bus = new EventBus({ logger });

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
  services.pedidos = new PedidoService({
    db, repository: repositories.pedidos, estoque: services.estoque, clientes: services.clientes, config: services.config, audit, bus, relogio, logger,
    consulta: new ConsultaDePedidos({ repository: repositories.pedidos, config: services.config, relogio }),
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
  new ClienteController(services.clientes).register(router);
  new BebidaController(services.bebidas, services.estoque).register(router);
  new EstoqueController(services.estoque).register(router);
  new AuditController(repositories.auditoria).register(router);
  new EventController(bus, { heartbeatMs }).register(router);

  const server = new HttpServer({ router, authService: services.auth, staticHandler: new StaticFileHandler(publicDir), logger });

  return {
    server, services, repositories, bus, db,
    async close() {
      await server.close();
      db.close();
    },
  };
}

module.exports = { buildApplication };
