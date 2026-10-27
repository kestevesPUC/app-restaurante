'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const carregar = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'niveis.js')).href);
const ids = (itens) => itens.map((r) => r.id);

test('menu por nível: A vê Atendimento, Cardápio e Gestão, B só Atendimento e Cardápio, C não tem menu', async () => {
  const { menuPara, rotaInicial, podeAcessar } = await carregar();
  assert.deepEqual(ids(menuPara('A')), ['pedido-novo', 'pedidos', 'andon', 'pratos', 'ingredientes', 'categorias', 'usuarios', 'whatsapp', 'clientes', 'relatorios', 'auditoria', 'sobre']);
  assert.deepEqual(ids(menuPara('B')), ['pedido-novo', 'pedidos', 'andon', 'pratos', 'ingredientes', 'categorias', 'sobre']);
  assert.deepEqual(menuPara('C'), []);
  assert.equal(rotaInicial('C'), 'andon');
  assert.equal(podeAcessar('B', 'usuarios'), false);
  assert.equal(podeAcessar('C', 'sobre'), false);
  assert.equal(podeAcessar('C', 'pratos'), false);
  assert.equal(podeAcessar('B', 'pratos'), true);
  assert.equal(podeAcessar('C', 'andon'), true);
});
