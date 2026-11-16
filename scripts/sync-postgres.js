'use strict';
// Rotina que copia o SQLite do PDV para o Supabase/Postgres, verificando mudanças a cada N segundos.
//
// Modo HTTPS (recomendado; funciona onde a porta do Postgres é bloqueada), no .env:
//   SUPABASE_URL=https://SEU-PROJETO.supabase.co
//   SUPABASE_SECRET_KEY=...   (Project Settings → API Keys → secret / service_role; NUNCA publique)
// Modo Postgres direto:
//   DATABASE_URL=postgres://...
// Opcional: PDV_DB (caminho do sqlite), SYNC_INTERVALO (segundos, padrão 3), PG_SSL=0.
// `--ddl` imprime o SQL que cria as tabelas (para colar no SQL Editor do Supabase) e sai.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const SqlitePostgresSync = require('../src/infrastructure/sync/SqlitePostgresSync');
const { RestDestino } = SqlitePostgresSync;

const raiz = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(raiz, '.env')); } catch { /* .env é opcional */ }

const dbPath = process.env.PDV_DB || path.join(raiz, 'data', 'pdv.sqlite');
const intervalo = Math.max(1, Number(process.env.SYNC_INTERVALO) || 3) * 1000;
const arquivoEstado = path.join(path.dirname(dbPath), 'sync-postgres-estado.json');
const modoRest = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

const lerEstado = () => { try { return JSON.parse(fs.readFileSync(arquivoEstado, 'utf8')); } catch { return {}; } };
const salvarEstado = (estado) => fs.writeFileSync(arquivoEstado, JSON.stringify(estado));
const agora = () => new Date().toLocaleTimeString('pt-BR');

async function main() {
  const sqlite = new DatabaseSync(dbPath, { readOnly: true });

  if (process.argv.includes('--ddl')) {
    console.log(`${new SqlitePostgresSync({ sqlite, destino: {} }).gerarDdl().map((c) => `${c};`).join('\n')}\n`);
    return;
  }
  if (!modoRest && !process.env.DATABASE_URL) {
    console.error('Defina SUPABASE_URL + SUPABASE_SECRET_KEY (HTTPS) ou DATABASE_URL (Postgres direto) no .env.');
    process.exit(1);
  }

  let pg = null;
  let sync;
  if (modoRest) {
    sync = new SqlitePostgresSync({ sqlite, destino: new RestDestino({ url: process.env.SUPABASE_URL, chave: process.env.SUPABASE_SECRET_KEY }), estado: lerEstado() });
  } else {
    const { Client } = require('pg');
    const conectar = async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PG_SSL === '0' ? false : { rejectUnauthorized: false } });
      c.on('error', () => {}); // queda de conexão é tratada no laço
      await c.connect();
      return c;
    };
    pg = await conectar();
    sync = new SqlitePostgresSync({ sqlite, pg, estado: lerEstado() });
    sync.reconectar = async () => { try { await pg.end(); } catch { /* já caiu */ } pg = await conectar(); sync.pg = pg; };
  }
  console.log(`[${agora()}] Sincronizando ${dbPath} → ${modoRest ? 'Supabase (HTTPS)' : 'Postgres'} a cada ${intervalo / 1000}s. Ctrl+C para parar.`);

  let parar = false;
  process.on('SIGINT', () => { parar = true; });
  while (!parar) {
    try {
      const resumo = await sync.sincronizar();
      if (Object.keys(resumo).length) {
        salvarEstado(sync.estado);
        console.log(`[${agora()}]`, Object.entries(resumo).map(([t, r]) => `${t}: +${r.enviados} -${r.removidos}`).join(' | '));
      }
    } catch (erro) {
      console.error(`[${agora()}] Falha (tentará de novo):`, erro.message);
      if (sync.reconectar) { try { await sync.reconectar(); } catch { /* sem internet: tenta na próxima rodada */ } }
    }
    await new Promise((r) => setTimeout(r, intervalo));
  }
  if (pg) await pg.end();
  sqlite.close();
}

main().catch((erro) => { console.error(erro); process.exit(1); });
