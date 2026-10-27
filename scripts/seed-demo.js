'use strict';
// Popula um banco com dados de demonstração (categorias, ingredientes, pratos, bebidas).
// Uso: node scripts/seed-demo.js [caminho do pdv.sqlite]   (padrão: %APPDATA%\pdv-restaurante\pdv.sqlite)
// Recusa rodar se o cardápio já tiver dados. Feche o programa antes de executar.
const path = require('node:path');
const { buildApplication } = require('../src/compositionRoot');

const dbPath = process.argv[2] || path.join(process.env.APPDATA, 'pdv-restaurante', 'pdv.sqlite');
const app = buildApplication({ dbPath, logger: { error: console.error, info() {} } });
const { services, repositories } = app;

if (repositories.categorias.findAll().length || repositories.pratos.findAll().length) {
  console.error('O cardápio já tem dados; nada foi alterado.');
  app.close();
  process.exit(1);
}

const admin = repositories.usuarios.findAll().find((u) => u.nivel === 'A');
const ator = { id: admin.id, usuario: admin.usuario, nivel: 'A' };

const cat = Object.fromEntries([['lanches', 'Lanches', 1], ['porcoes', 'Porções', 2], ['pratos', 'Pratos executivos', 3], ['sobremesas', 'Sobremesas', 4]]
  .map(([k, nome, ordem]) => [k, services.categorias.create(ator, { nome, ordem }).id]));

const ing = Object.fromEntries([
  ['pao', 'Pão', 0], ['carne', 'Hambúrguer', 0], ['queijo', 'Queijo', 300], ['bacon', 'Bacon', 400], ['alface', 'Alface', 0], ['tomate', 'Tomate', 0],
  ['cebola', 'Cebola', 100], ['maionese', 'Maionese', 0], ['batata', 'Batata frita', 0], ['frango', 'Frango', 0], ['arroz', 'Arroz', 0],
  ['feijao', 'Feijão', 0], ['bife', 'Bife', 0], ['ovo', 'Ovo', 250], ['pudim', 'Pudim', 0], ['mousse', 'Mousse de chocolate', 0],
].map(([k, nome, extra]) => [k, services.ingredientes.create(ator, {
  nome, unidadeMedida: 'UN', precoAdicionalCents: extra, podeSerAdicional: extra > 0, ativo: true,
}).id]));

const prato = (nome, codigo, categoria, precoCents, tempoPreparoMin, descricao, itens) => services.pratos.create(ator, {
  nome, codigo, categoriaId: cat[categoria], precoCents, tempoPreparoMin, descricao, ativo: true,
  ingredientes: itens.map(([k, removivel = true]) => ({ ingredienteId: ing[k], removivel })),
});

prato('X-Burger', 'L01', 'lanches', 2400, 12, 'Hambúrguer, queijo, alface e tomate', [['pao', false], ['carne', false], ['queijo'], ['alface'], ['tomate'], ['maionese']]);
prato('X-Bacon', 'L02', 'lanches', 2900, 14, 'Hambúrguer, queijo e bacon', [['pao', false], ['carne', false], ['queijo'], ['bacon'], ['cebola']]);
prato('X-Frango', 'L03', 'lanches', 2600, 14, 'Filé de frango, queijo e alface', [['pao', false], ['frango', false], ['queijo'], ['alface'], ['tomate']]);
prato('Batata frita', 'P01', 'porcoes', 2200, 10, 'Porção para dividir', [['batata', false]]);
prato('Frango à passarinho', 'P02', 'porcoes', 3800, 20, 'Porção com cebola', [['frango', false], ['cebola']]);
prato('Prato do dia - Bife', 'E01', 'pratos', 3200, 18, 'Bife, arroz, feijão e ovo', [['bife', false], ['arroz'], ['feijao'], ['ovo']]);
prato('Prato do dia - Frango', 'E02', 'pratos', 2900, 18, 'Frango grelhado, arroz e feijão', [['frango', false], ['arroz'], ['feijao']]);
prato('Pudim', 'S01', 'sobremesas', 1200, 3, 'Fatia de pudim', [['pudim', false]]);
prato('Mousse de chocolate', 'S02', 'sobremesas', 1300, 3, 'Porção individual', [['mousse', false]]);

[['Coca-Cola lata', 600, 48, 12], ['Guaraná lata', 600, 36, 12], ['Suco de laranja', 900, 20, 5], ['Água mineral', 400, 60, 12], ['Cerveja long neck', 1000, 30, 10]]
  .forEach(([nome, precoCents, estoqueQtd, estoqueMinimo]) => services.bebidas.create(ator, { nome, precoCents, estoqueQtd, estoqueMinimo, ativo: true }));

console.log(`Pronto: ${Object.keys(cat).length} categorias, ${Object.keys(ing).length} ingredientes, 9 pratos e 5 bebidas em ${dbPath}`);
app.close();
