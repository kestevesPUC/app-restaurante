'use strict';
const path = require('node:path');
const { buildApplication } = require('./compositionRoot');

const HOST = '127.0.0.1';

async function main() {
  const dbPath = process.env.PDV_DB || path.join(__dirname, '..', 'data', 'pdv.sqlite');
  const port = Number(process.env.PORT) || 3000;
  const app = buildApplication({ dbPath });

  const inicial = app.services.adminBootstrap.run();
  if (inicial) console.log(`Usuário inicial criado: ADMIN / ${inicial.senhaProvisoria}  (troca obrigatória no 1º acesso)`);

  const { port: ouvindo } = await app.server.listen(port, HOST);
  console.log(`PDV Restaurante em http://localhost:${ouvindo}  (banco: ${dbPath})`);

  const encerrar = () => app.close().finally(() => process.exit(0));
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
