import { api } from '../api.js';
import { notify, fail } from '../ui.js';
import { themeButton, wireThemeButtons } from '../theme.js';

function authShell(root, titulo, subtitulo, corpo) {
  root.innerHTML = `<div class="auth"><section class="hero"><div class="logo"><img src="/img/logo.svg" alt="" width="64" height="64"></div>
    <h1>PDV Restaurante</h1><p>Pedidos, cozinha e pagamentos em um só lugar.</p></section>
    <section class="panel"><form id="f"><h2>${titulo}</h2><p>${subtitulo}</p><div id="msg" aria-live="polite"></div>${corpo}</form></section></div>${themeButton('btn alt sm theme-fab')}`;
  wireThemeButtons();
}

/** Tela de entrada. `onLogin(usuario)` recebe o usuário autenticado (inclui `mustChange`). */
export function renderLogin(root, onLogin, erro = '') {
  authShell(root, 'Bem-vindo', 'Entre com seu usuário e senha.', `
    <label>Usuário<input name="usuario" autocomplete="username" required autofocus></label>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
    <button class="btn">Entrar</button>`);
  if (erro) notify(erro, 'err');
  document.getElementById('f').onsubmit = async (event) => {
    event.preventDefault();
    try {
      onLogin(await api.post('/api/login', Object.fromEntries(new FormData(event.target))));
    } catch (e) { fail(e); }
  };
}

/**
 * Troca obrigatória da senha provisória. O servidor devolve um novo cookie de sessão,
 * então a interface segue logada: `onDone()` só continua o fluxo.
 */
export function renderTrocaSenha(root, onDone) {
  authShell(root, 'Defina uma nova senha', 'A senha provisória precisa ser trocada antes de continuar.', `
    <label>Senha atual (provisória)<input name="atual" type="password" autocomplete="current-password" required autofocus></label>
    <label>Nova senha<input name="nova" type="password" minlength="6" autocomplete="new-password" required></label>
    <label>Repita a nova senha<input name="repetir" type="password" minlength="6" autocomplete="new-password" required></label>
    <button class="btn">Salvar senha</button>`);
  document.getElementById('f').onsubmit = async (event) => {
    event.preventDefault();
    const { atual, nova, repetir } = Object.fromEntries(new FormData(event.target));
    if (nova !== repetir) return notify('As senhas novas não conferem.', 'err');
    try {
      await api.post('/api/me/senha', { atual, nova });
      return await onDone();
    } catch (e) { return fail(e); }
  };
}
