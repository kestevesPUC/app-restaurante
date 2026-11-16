'use strict';
const crypto = require('node:crypto');

// Colunas que nunca saem do notebook (segurança / peso).
const IGNORAR = { usuarios: ['senha_hash'], pratos: ['foto'] };

const tipoPg = (tipoSqlite) => {
  const t = String(tipoSqlite).toUpperCase();
  if (t.includes('INT')) return 'BIGINT';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION';
  if (t.includes('BLOB')) return 'BYTEA';
  return 'TEXT';
};
const q = (nome) => `"${String(nome).replace(/"/g, '""')}"`;
const hash = (linha) => crypto.createHash('sha1').update(JSON.stringify(linha)).digest('hex');
const paraHash = (v) => (v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v);
// Tabelas de pedidos que podem ser trazidas da nuvem (pais antes dos filhos, por causa das chaves estrangeiras).
const ORDEM_PUXAR = ['clientes', 'pedidos', 'pedido_envios', 'pedido_itens', 'item_modificacoes', 'pedido_status_historico'];
const valor = (v) => (v instanceof Uint8Array ? Buffer.from(v) : v);

/** Destino direto no Postgres (porta 5432). `obterPg()` devolve o cliente atual (permite reconectar). */
class PgDestino {
  constructor(obterPg) { this.obterPg = obterPg; }

  async preparar(_tabelas, ddl) {
    for (const comando of ddl) await this.obterPg().query(comando);
  }

  /** Todas as linhas da tabela no destino (para trazer mudanças feitas por outros aparelhos). */
  async ler(t) {
    const r = await this.obterPg().query(`SELECT ${t.colunas.map((c) => q(c.nome)).join(', ')} FROM ${q(t.nome)}`);
    return r.rows;
  }

  /** Aplica uma tabela inteira numa transação: ou vai tudo, ou nada. */
  async aplicar(t, linhas, removidas) {
    const pg = this.obterPg();
    const cols = t.colunas.map((c) => c.nome);
    await pg.query('BEGIN');
    try {
      const sets = cols.filter((c) => !t.pk.includes(c)).map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
      const conflito = sets.length ? `DO UPDATE SET ${sets.join(', ')}` : 'DO NOTHING';
      const sql = `INSERT INTO ${q(t.nome)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (${t.pk.map(q).join(', ')}) ${conflito}`;
      for (const linha of linhas) await pg.query(sql, cols.map((c) => valor(linha[c])));
      const onde = t.pk.map((k, i) => `${q(k)} = $${i + 1}`).join(' AND ');
      for (const chave of removidas) await pg.query(`DELETE FROM ${q(t.nome)} WHERE ${onde}`, chave);
      await pg.query('COMMIT');
    } catch (erro) {
      await pg.query('ROLLBACK').catch(() => {});
      throw erro;
    }
  }
}

/**
 * Destino via API REST do Supabase (HTTPS, porta 443) — funciona onde a porta do Postgres é bloqueada.
 * Precisa da chave secreta (service role). As tabelas devem existir (veja `npm run sync:ddl`).
 */
class RestDestino {
  constructor({ url, chave, fetchImpl = globalThis.fetch, lote = 500, timeoutMs = 20000 }) {
    this.base = `${String(url).replace(/\/+$/, '')}/rest/v1`;
    this.fetch = fetchImpl;
    this.lote = lote;
    this.timeoutMs = timeoutMs;
    // Chaves novas (sb_secret_...) vão só em `apikey`; as antigas (JWT) também em Authorization.
    this.cabecalhos = { apikey: chave, ...(String(chave).startsWith('eyJ') ? { Authorization: `Bearer ${chave}` } : {}) };
  }

  async requisitar(metodo, caminho, { corpo, extra = {} } = {}) {
    const resposta = await this.fetch(`${this.base}/${caminho}`, {
      method: metodo,
      headers: { ...this.cabecalhos, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      body: corpo === undefined ? undefined : JSON.stringify(corpo, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resposta.ok) {
      const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);
      const erro = new Error(`Supabase respondeu ${resposta.status} em ${metodo} ${caminho.split('?')[0]}: ${detalhe}`);
      erro.status = resposta.status;
      throw erro;
    }
    return resposta;
  }

  /** Confere se todas as tabelas e colunas existem (a API REST não cria tabelas). */
  async preparar(tabelas) {
    for (const t of tabelas) {
      try {
        await this.requisitar('GET', `${encodeURIComponent(t.nome)}?select=${t.colunas.map((c) => encodeURIComponent(c.nome)).join(',')}&limit=0`);
      } catch (erro) {
        if (erro.status >= 400 && erro.status < 500) {
          throw new Error(`Tabela/coluna ausente no Supabase (${t.nome}). Rode "npm run sync:ddl", cole o SQL no SQL Editor do Supabase e tente de novo. Detalhe: ${erro.message}`);
        }
        throw erro;
      }
    }
  }

  async ler(t) {
    const tabela = encodeURIComponent(t.nome);
    const cols = t.colunas.map((c) => encodeURIComponent(c.nome)).join(',');
    const ordem = t.pk.map(encodeURIComponent).join(',');
    const todas = [];
    for (let desde = 0; ; desde += 1000) {
      const resposta = await this.requisitar('GET', `${tabela}?select=${cols}&order=${ordem}&limit=1000&offset=${desde}`);
      const parte = await resposta.json();
      todas.push(...parte);
      if (parte.length < 1000) return todas;
    }
  }

  async aplicar(t, linhas, removidas) {
    const tabela = encodeURIComponent(t.nome);
    for (let i = 0; i < linhas.length; i += this.lote) {
      const parte = linhas.slice(i, i + this.lote).map((l) => Object.fromEntries(t.colunas.map((c) => [c.nome, l[c.nome]])));
      await this.requisitar('POST', `${tabela}?on_conflict=${t.pk.map(encodeURIComponent).join(',')}`, {
        corpo: parte, extra: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
    for (const chave of removidas) {
      const filtro = t.pk.map((k, i) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(chave[i])}`).join('&');
      await this.requisitar('DELETE', `${tabela}?${filtro}`);
    }
  }
}

/**
 * Espelha as tabelas do SQLite em um Postgres, enviando apenas o que mudou desde a última rodada.
 * `sqlite`: DatabaseSync (somente leitura). Destino: `pg` (objeto com `query(sql, params)`) ou `destino`
 * (PgDestino/RestDestino). `estado`: { [tabela]: { [chave]: hash } } — mantido pelo chamador entre rodadas.
 */
class SqlitePostgresSync {
  /**
   * `puxar`: nomes das tabelas que também são TRAZIDAS da nuvem para o SQLite (precisa de `sqlite` gravável).
   * Regra de conflito (linha alterada nos dois lados desde a última sincronização): o SQLite local vence.
   */
  constructor({ sqlite, pg, destino, estado = {}, puxar = [], ajustarImportacao = null }) {
    this.ajustarImportacao = ajustarImportacao; // (tabela, linha, erro) → { linha, aviso } | null: conserta linhas que violam uma regra local
    this.avisosPull = [];
    this.sqlite = sqlite;
    this.pg = pg;
    this.destino = destino || new PgDestino(() => this.pg);
    this.estado = estado;
    this.puxar = new Set(puxar);
    this.tabelas = null;
    this.estadoMudou = false;
    this.ultimoPull = { importados: 0, conflitos: 0 };
    this.falhasPull = [];
  }

  /** Lê o SQLite: Map(chave → { linha, hash }). */
  lerLocais(t) {
    const cols = t.colunas.map((c) => c.nome);
    const mapa = new Map();
    for (const linha of this.sqlite.prepare(`SELECT ${cols.map(q).join(', ')} FROM ${q(t.nome)}`).all()) {
      mapa.set(JSON.stringify(t.pk.map((k) => linha[k])), { linha, hash: hash(cols.map((c) => paraHash(linha[c]))) });
    }
    return mapa;
  }

  /** Converte os tipos que o Postgres devolve (ex.: bigint como texto) para os do SQLite. */
  normalizarRemota(t, linha) {
    const saida = {};
    for (const c of t.colunas) {
      const v = linha[c.nome] ?? null;
      saida[c.nome] = v !== null && (c.tipo === 'BIGINT' || c.tipo === 'DOUBLE PRECISION') ? Number(v) : v;
    }
    return saida;
  }

  /**
   * Traz da nuvem o que foi criado/alterado por OUTROS aparelhos (3 vias: último estado sincronizado × local × nuvem).
   * Tudo numa transação com chaves estrangeiras adiadas; linhas que violam uma restrição local não são importadas
   * (ficam em `falhasPull` e são tentadas de novo na próxima rodada).
   */
  async puxarDoDestino() {
    const tabelas = ORDEM_PUXAR.filter((n) => this.puxar.has(n)).map((n) => this.tabelas.find((t) => t.nome === n)).filter(Boolean);
    const plano = [];
    let conflitos = 0;
    for (const t of tabelas) {
      const cols = t.colunas.map((c) => c.nome);
      const base = (this.estado[t.nome] = this.estado[t.nome] || {});
      const locais = this.lerLocais(t);
      const remotas = new Set();
      const gravar = [];
      for (const bruta of await this.destino.ler(t)) {
        const r = this.normalizarRemota(t, bruta);
        const chave = JSON.stringify(t.pk.map((k) => r[k]));
        remotas.add(chave);
        const h = hash(cols.map((c) => paraHash(r[c])));
        const local = locais.get(chave);
        if (base[chave] === h) continue; // a nuvem não mudou desde a última sincronização
        if (local && local.hash === h) { base[chave] = h; this.estadoMudou = true; continue; } // já iguais
        if ((local && local.hash !== base[chave]) || (!local && base[chave] !== undefined)) { conflitos += 1; continue; } // o local também mudou (ou apagou): o local vence
        gravar.push({ chave, hash: h, linha: r });
      }
      // Sumiu da nuvem mas existe aqui: esquece o estado para que o envio o recrie.
      for (const chave of Object.keys(base)) if (!remotas.has(chave)) { delete base[chave]; this.estadoMudou = true; }
      if (gravar.length) plano.push({ t, cols, gravar });
    }
    this.ultimoPull = { importados: 0, conflitos };
    this.falhasPull = [];
    if (!plano.length) return;

    const falhas = new Map(); // "tabela#chave" → mensagem
    const db = this.sqlite;
    db.exec('BEGIN');
    try {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const { t, cols, gravar } of plano) {
        const sets = cols.filter((c) => !t.pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`);
        const conflito = sets.length ? `DO UPDATE SET ${sets.join(', ')}` : 'DO NOTHING';
        const stmt = db.prepare(`INSERT INTO ${q(t.nome)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (${t.pk.map(q).join(', ')}) ${conflito}`);
        for (const item of gravar) {
          db.exec('SAVEPOINT puxar');
          try {
            stmt.run(...cols.map((c) => item.linha[c]));
            db.exec('RELEASE puxar');
          } catch (erro) {
            db.exec('ROLLBACK TO puxar');
            let resolvido = false;
            const ajuste = this.ajustarImportacao?.(t, item.linha, erro);
            if (ajuste) {
              try {
                stmt.run(...cols.map((c) => ajuste.linha[c]));
                item.gravada = ajuste.linha;
                this.avisosPull = [...this.avisosPull, ajuste.aviso].slice(-5);
                resolvido = true;
              } catch (erro2) { db.exec('ROLLBACK TO puxar'); erro = erro2; }
            }
            db.exec('RELEASE puxar');
            if (!resolvido) falhas.set(`${t.nome}#${item.chave}`, erro.message);
          }
        }
      }
      // Linhas que apontam para algo que não existe aqui (ex.: prato ausente) saem; os filhos delas também.
      for (let volta = 0; volta < 10; volta += 1) {
        const violacoes = db.prepare('PRAGMA foreign_key_check').all();
        if (!violacoes.length) break;
        for (const v of violacoes) {
          db.prepare(`DELETE FROM ${q(v.table)} WHERE rowid = ?`).run(v.rowid);
          falhas.set(`${v.table}#rowid`, `referencia ${v.parent} inexistente neste computador`);
        }
      }
      db.exec('COMMIT');
    } catch (erro) {
      try { db.exec('ROLLBACK'); } catch { /* já encerrada */ }
      throw erro;
    }

    // Confere o que realmente ficou gravado; só isso vira "sincronizado".
    for (const { t, cols, gravar } of plano) {
      const locais = this.lerLocais(t);
      for (const item of gravar) {
        const esperado = item.gravada ? hash(cols.map((c) => paraHash(item.gravada[c]))) : item.hash;
        // Linha ajustada: o estado guarda o hash da NUVEM; assim a versão corrigida é enviada de volta no passo seguinte.
        if (locais.get(item.chave)?.hash === esperado) {
          this.estado[t.nome][item.chave] = item.hash;
          this.estadoMudou = true;
          this.ultimoPull.importados += 1;
        } else {
          const motivo = falhas.get(`${t.nome}#${item.chave}`) || falhas.get(`${t.nome}#rowid`) || 'rejeitado pelo banco local';
          this.falhasPull.push(`${t.nome} ${item.chave}: ${motivo}`);
        }
      }
    }
  }

  lerTabelas() {
    const nomes = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return nomes.map(({ name }) => {
      const info = this.sqlite.prepare(`PRAGMA table_info(${q(name)})`).all();
      const ignorar = IGNORAR[name] || [];
      const colunas = info.filter((c) => !ignorar.includes(c.name)).map((c) => ({ nome: c.name, tipo: tipoPg(c.type), pk: c.pk }));
      const pk = colunas.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.nome);
      return { nome: name, colunas, pk };
    }).filter((t) => t.pk.length > 0);
  }

  /** SQL que cria/atualiza as tabelas no Postgres (idempotente) e as tranca com RLS. */
  gerarDdl(tabelas = this.lerTabelas()) {
    const ddl = [];
    for (const t of tabelas) {
      const defs = t.colunas.map((c) => `${q(c.nome)} ${c.tipo}`).join(', ');
      ddl.push(`CREATE TABLE IF NOT EXISTS ${q(t.nome)} (${defs}, PRIMARY KEY (${t.pk.map(q).join(', ')}))`);
      for (const c of t.colunas) ddl.push(`ALTER TABLE ${q(t.nome)} ADD COLUMN IF NOT EXISTS ${q(c.nome)} ${c.tipo}`);
      // Sem políticas, ninguém além do dono lê a tabela — nem pela API pública do Supabase.
      ddl.push(`ALTER TABLE ${q(t.nome)} ENABLE ROW LEVEL SECURITY`);
    }
    return ddl;
  }

  async prepararDestino() {
    this.tabelas = this.lerTabelas();
    await this.destino.preparar(this.tabelas, this.gerarDdl(this.tabelas));
  }

  /** Uma rodada de sincronização. Retorna { [tabela]: { enviados, removidos } } só das tabelas que mudaram. */
  async sincronizar() {
    if (!this.tabelas) await this.prepararDestino();
    if (this.puxar.size) await this.puxarDoDestino(); // primeiro traz o que veio da nuvem, para não sobrescrevê-lo
    const resumo = {};
    for (const t of this.tabelas) {
      const anterior = this.estado[t.nome] || {};
      const atual = {};
      const mudadas = [];
      for (const [chave, { linha, hash: h }] of this.lerLocais(t)) {
        atual[chave] = h;
        if (anterior[chave] !== h) mudadas.push(linha);
      }
      const removidas = Object.keys(anterior).filter((k) => !(k in atual)).map((k) => JSON.parse(k));
      if (!mudadas.length && !removidas.length) continue;

      await this.destino.aplicar(t, mudadas, removidas);
      this.estado[t.nome] = atual;
      this.estadoMudou = true;
      resumo[t.nome] = { enviados: mudadas.length, removidos: removidas.length };
    }
    return resumo;
  }
}

module.exports = SqlitePostgresSync;
module.exports.PgDestino = PgDestino;
module.exports.RestDestino = RestDestino;
