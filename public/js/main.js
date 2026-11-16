import { api, SESSAO_EXPIRADA } from './api.js';
import { esc } from './format.js';
import { icon } from './icons.js';
import { restoreTheme, themeButton, wireThemeButtons } from './theme.js';
import { state } from './state.js';
import { montarTitulo } from './titulo.js';
import { notify, fail } from './ui.js';
import { ROTAS, menuPara, nivelNome, podeAcessar, rotaInicial } from './niveis.js';
import { conectar } from './events.js';
import { somNovoPedido } from './som.js';
import { initPasswordToggles } from './components/passwordToggle.js';
import { initMasks } from './mask.js';
import { renderLogin, renderTrocaSenha } from './views/login.js';
import { viewUsuarios } from './views/usuarios.js';
import { viewAuditoria } from './views/auditoria.js';
import { viewSobre } from './views/sobre.js';
import { viewAparencia } from './views/aparencia.js';
import { viewAndon } from './views/andon.js';
import { viewPratos } from './views/pratos.js';
import { viewIngredientes } from './views/ingredientes.js';
import { viewCategorias } from './views/categorias.js';
import { viewPedidoNovo } from './views/pedidoNovo.js';
import { viewPedidos } from './views/pedidos.js';
import { viewWhatsApp } from './views/whatsapp.js';
import { viewClientes } from './views/clientes.js';
import { viewDashboard } from './views/dashboard.js';
import { viewRelatorios } from './views/relatorios.js';
import { viewPix } from './views/pix.js';

const root = document.getElementById('app');

// Telas por id de rota (os ids e as permissões ficam em ROTAS, em niveis.js).
const VIEWS = { 'pedido-novo': viewPedidoNovo, pedidos: viewPedidos, whatsapp: viewWhatsApp, clientes: viewClientes, pix: viewPix, dashboard: viewDashboard, relatorios: viewRelatorios, pratos: viewPratos, ingredientes: viewIngredientes, categorias: viewCategorias, usuarios: viewUsuarios, auditoria: viewAuditoria, sobre: viewSobre, aparencia: viewAparencia, andon: viewAndon };

let eventos = null;

const idDaRota = () => location.hash.replace(/^#\//, '');

function menuHtml(nivel) {
  let grupo = null;
  return menuPara(nivel).map((r) => {
    const titulo = r.grupo !== grupo && r.grupo ? `<div class="group">${esc(r.grupo)}</div>` : '';
    grupo = r.grupo;
    return `${titulo}<a href="#/${r.id}" data-r="${r.id}">${icon(r.icone)}<span>${esc(r.rotulo)}</span></a>`;
  }).join('');
}

function renderShell() {
  const { me } = state;
  const comMenu = menuPara(me.nivel).length > 0;
  const sair = `<button type="button" id="out">${icon('out')}<span>Sair</span></button>`;
  const lateral = comMenu
    ? `<aside class="side"><div class="brand"><span class="logo"><img src="/img/logo.svg" alt="" width="36" height="36"></span><div><b>PDV Restaurante</b><small>Pedidos e cozinha</small></div></div>
      <nav aria-label="Principal">${menuHtml(me.nivel)}</nav>
      <div class="foot"><div class="who"><span class="avatar" aria-hidden="true">${esc(me.usuario.slice(0, 2))}</span><span>${esc(me.usuario)} · ${esc(nivelNome(me.nivel))}</span></div>
      ${themeButton()}${sair}<a class="credito" href="https://kaio-gomes-site.vercel.app" target="_blank" rel="noopener noreferrer">Desenvolvido por Kaio Gomes</a></div></aside>`
    : '';
  root.innerHTML = `<div class="shell${comMenu ? '' : ' solo'}">${lateral}
    <main class="content"><div class="page-head"><div><h1 id="ptitle" tabindex="-1"></h1><p id="psub"></p></div>
    ${comMenu ? '' : `<div class="top-actions">${themeButton('btn alt sm')}${sair.replace('<button', '<button class="btn alt sm"')}</div>`}</div>
    <div id="msg" aria-live="polite"></div><div id="view"></div></main></div>`;
  wireThemeButtons();
  document.getElementById('out').onclick = sair_;
}

async function sair_() {
  try { await api.post('/api/logout'); } catch { /* sessão já encerrada */ }
  voltarAoLogin();
}

function voltarAoLogin(erro = '') {
  eventos?.fechar();
  eventos = null;
  state.me = null;
  history.replaceState(null, '', location.pathname);
  renderLogin(root, entrarCom, erro);
}

function atualizarTitulo() {
  const app = state.tituloApp || 'PDV Restaurante';
  document.title = state.rotuloAtual ? `${state.rotuloAtual} — ${app}` : app;
}

/** Mostra a tela da rota atual, respeitando o nível do usuário. */
function mostrar() {
  const { me } = state;
  if (!me || me.mustChange) return;
  let id = idDaRota();
  if (!podeAcessar(me.nivel, id) || !VIEWS[id]) {
    id = rotaInicial(me.nivel);
    history.replaceState(null, '', `#/${id}`);
  }
  const rota = ROTAS.find((r) => r.id === id);
  document.querySelectorAll('.side nav a').forEach((a) => {
    if (a.dataset.r === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.getElementById('ptitle').textContent = rota.rotulo;
  document.getElementById('psub').textContent = rota.subtitulo;
  state.rotuloAtual = rota.rotulo;
  atualizarTitulo();
  notify('');
  document.getElementById('view').innerHTML = '';
  VIEWS[id]().catch(fail);
}

/** Nome e versão do sistema (mesmo texto da janela do desktop): "PDV Restaurante — v0.1.0". */
function carregarTitulo() {
  if (state.tituloApp) return;
  api.get('/api/sistema').then(({ nome, versao }) => {
    state.tituloApp = montarTitulo(nome, versao);
    atualizarTitulo();
  }).catch(() => {});
}

function entrarCom(me) {
  state.me = me;
  carregarTitulo();
  if (me.mustChange) {
    renderTrocaSenha(root, async () => {
      // A troca reemite o cookie da sessão: segue logado, só atualiza os dados do usuário.
      state.me = await api.get('/api/me');
      iniciar();
    });
    return;
  }
  iniciar();
}

function iniciar() {
  carregarTitulo(); // repete se a 1ª tentativa falhou (ex.: senha provisória pendente)
  renderShell();
  eventos?.fechar();
  eventos = conectar((tipo, dados) => window.dispatchEvent(new CustomEvent('pdv:evento', { detail: { tipo, dados } })));
  mostrar();
}

window.addEventListener('hashchange', mostrar);

// Aviso ao cliente que não saiu (ex.: WhatsApp desconectado): mostra ao atendente, que pode reenviar.
window.addEventListener('pdv:evento', ({ detail }) => {
  // Novo pedido: confirmado (RECEBIDO) e a caminho da cozinha.
  if (detail.tipo === 'pedido' && detail.dados?.status === 'RECEBIDO') somNovoPedido();
  if (detail.tipo === 'notificacao' && detail.dados?.situacao === 'FALHOU') {
    notify(`Não foi possível avisar o cliente do pedido ${detail.dados.pedidoId}: ${detail.dados.erro}. Use "Reenviar WhatsApp".`, 'err');
  }
});

// Sessão expirada (401 em qualquer chamada): volta ao login com aviso.
window.addEventListener(SESSAO_EXPIRADA, () => {
  if (state.me) voltarAoLogin('Sua sessão expirou. Entre novamente.');
});

// Atalho: a tecla "/" foca a pesquisa da tela atual.
document.addEventListener('keydown', (event) => {
  const digitando = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  const busca = document.querySelector('[data-grid="search"]');
  if (event.key === '/' && !digitando && busca && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    busca.focus();
  }
});

restoreTheme();
initPasswordToggles();
initMasks();
api.get('/api/me').then(entrarCom).catch(() => renderLogin(root, entrarCom));
