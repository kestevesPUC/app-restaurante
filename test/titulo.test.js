'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tituloDaJanela } = require('../src/desktop/titulo');

test('tituloDaJanela junta nome e versão com travessão', () => {
  assert.equal(tituloDaJanela('PDV Restaurante', '1.2.3'), 'PDV Restaurante — v1.2.3');
  assert.equal(tituloDaJanela('PDV Restaurante', '0.1.0'), 'PDV Restaurante — v0.1.0');
});

test('tituloDaJanela apara nome e versão', () => {
  assert.equal(tituloDaJanela('  PDV Restaurante ', ' 1.2.3 '), 'PDV Restaurante — v1.2.3');
});

test('tituloDaJanela sem versão devolve só o nome', () => {
  assert.equal(tituloDaJanela('PDV Restaurante', ''), 'PDV Restaurante');
  assert.equal(tituloDaJanela('PDV Restaurante', undefined), 'PDV Restaurante');
  assert.equal(tituloDaJanela('PDV Restaurante', '   '), 'PDV Restaurante');
});

test('montarTitulo do front-end segue o mesmo formato da janela', async () => {
  const { montarTitulo } = await import('../public/js/titulo.js');
  assert.equal(montarTitulo('PDV Restaurante', ' 1.2.3 '), 'PDV Restaurante — v1.2.3');
  assert.equal(montarTitulo('PDV Restaurante', ''), 'PDV Restaurante');
});
