import qrcode from '../vendor/qrcode.js';
import { api } from '../api.js';
import { esc } from '../format.js';
import { icon } from '../icons.js';
import { view, notify, fail } from '../ui.js';

const ESTADOS = {
  DESCONECTADO: { rotulo: 'Desconectado', classe: 'bad', icone: 'x' },
  AGUARDANDO_QR: { rotulo: 'Aguardando leitura do QR Code', classe: 'info', icone: 'info' },
  CONECTANDO: { rotulo: 'Conectando…', classe: 'info', icone: 'info' },
  CONECTADO: { rotulo: 'Conectado', classe: 'ok', icone: 'check' },
};

/** QR Code como SVG (módulos pretos sobre fundo branco, com margem, para o celular ler em qualquer tema). */
function qrSvg(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

/** Tela de conexão do WhatsApp (nível A): estado, QR Code para parear, conectar/desconectar e mensagem de teste. */
export async function viewWhatsApp() {
  const raiz = view();
  const aoEvento = () => atualizar().catch(fail);
  window.addEventListener('pdv:evento', aoEvento);
  // Sai da tela: para de ouvir os eventos (a view é recriada a cada navegação).
  const sair = () => {
    if (document.getElementById('wa-card')) return;
    window.removeEventListener('pdv:evento', aoEvento);
    window.removeEventListener('hashchange', sair);
  };
  window.addEventListener('hashchange', sair);

  raiz.innerHTML = '<div class="card" id="wa-card"></div>';

  async function atualizar() {
    const card = document.getElementById('wa-card');
    if (!card) return;
    const e = await api.get('/api/whatsapp/estado');
    const info = ESTADOS[e.estado] || ESTADOS.DESCONECTADO;
    const conectado = e.estado === 'CONECTADO';
    const ativo = e.estado !== 'DESCONECTADO';
    card.innerHTML = `<h2>WhatsApp</h2>
      <p><span class="tag ${info.classe}">${icon(info.icone)}${esc(info.rotulo)}</span>
      ${conectado && e.numeroConectado ? ` <small>Número: ${esc(e.numeroConectado)}</small>` : ''}</p>
      ${e.erro ? `<div class="msg err" role="alert">${icon('alert')}<span>${esc(e.erro)}</span></div>` : ''}
      ${e.estado === 'AGUARDANDO_QR' && e.qr ? `<div style="max-width:320px;margin:12px 0;background:#fff;border-radius:8px">${qrSvg(e.qr)}</div>
        <p><small>No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte a câmera para este código.</small></p>` : ''}
      <div class="row" style="margin-top:12px">
        ${ativo ? '<button type="button" class="btn alt" id="wa-off">Desconectar</button>' : '<button type="button" class="btn" id="wa-on">Conectar</button>'}
      </div>
      ${conectado ? `<h3>Mensagem de teste</h3><form id="wa-teste" class="row">
        <label>Telefone com DDD<input name="telefone" data-mask="telefone" inputmode="tel" placeholder="(11) 99999-8888" required></label>
        <button class="btn">Enviar teste</button></form>` : ''}`;

    const on = document.getElementById('wa-on');
    if (on) on.onclick = () => api.post('/api/whatsapp/conectar').then(atualizar).catch(fail);
    const off = document.getElementById('wa-off');
    if (off) off.onclick = () => api.post('/api/whatsapp/desconectar').then(atualizar).catch(fail);
    const teste = document.getElementById('wa-teste');
    if (teste) {
      teste.onsubmit = async (event) => {
        event.preventDefault();
        try {
          await api.post('/api/whatsapp/teste', { telefone: new FormData(teste).get('telefone') });
          notify('Mensagem de teste enviada');
        } catch (error) { fail(error); }
      };
    }
  }

  await atualizar();
}
