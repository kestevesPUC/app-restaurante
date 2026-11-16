'use strict';
const path = require('node:path');
const { buildApplication } = require('./compositionRoot');
const JsonLineLogger = require('./infrastructure/logging/JsonLineLogger');
const { lerConfiguracaoSincronizacao, estadoEmArquivo } = require('./infrastructure/sync/configSincronizacao');

// HOST=0.0.0.0 libera o acesso de outros aparelhos da mesma rede (ex.: tablet da cozinha).
const HOST = process.env.HOST || '127.0.0.1';

/** Desenvolvimento: grava no arquivo (JSON) e mantém a saída no console. */
function criarLogger() {
  const arquivo = new JsonLineLogger({ pasta: process.env.PDV_LOGS || path.join(__dirname, '..', 'data', 'logs'), relogio: Date.now });
  const duplo = (nivel) => (...args) => { arquivo[nivel](...args); console[nivel === 'debug' ? 'log' : nivel](...args); };
  return { debug: duplo('debug'), info: duplo('info'), warn: duplo('warn'), error: duplo('error'), fechar: () => arquivo.fechar() };
}

async function main() {
  const dbPath = process.env.PDV_DB || path.join(__dirname, '..', 'data', 'pdv.sqlite');
  const port = Number(process.env.PORT) || 3000;
  const logger = criarLogger();
  const nuvem = lerConfiguracaoSincronizacao({ pastas: [path.join(__dirname, '..')] });
  const sincronizacao = nuvem && { ...nuvem, ...estadoEmArquivo(path.join(path.dirname(dbPath), 'sync-postgres-estado.json')) };
  const app = buildApplication({ dbPath, logger, sincronizacao });

  const inicial = app.services.adminBootstrap.run();
  if (inicial) console.log(`Usuário inicial criado: ADMIN / ${inicial.senhaProvisoria}  (troca obrigatória no 1º acesso)`);

  const { port: ouvindo } = await app.server.listen(port, HOST);
  app.services.sincronizacao.iniciar();
  console.log(`PDV Restaurante em http://localhost:${ouvindo}  (banco: ${dbPath})`);

  logger.info('aplicativo iniciado', { porta: ouvindo });
  const encerrar = () => app.close().finally(() => { logger.info('aplicativo encerrado'); logger.fechar().finally(() => process.exit(0)); });
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
