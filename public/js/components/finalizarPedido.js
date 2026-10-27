import qrcode from '../vendor/qrcode.js';
import { api } from '../api.js';
import { brl, esc } from '../format.js';
import { openDialog } from '../ui.js';

export const FORMAS_PAGAMENTO = [
  { id: 'DINHEIRO', rotulo: 'Dinheiro' },
  { id: 'PIX', rotulo: 'PIX' },
  { id: 'CARTAO_DEBITO', rotulo: 'Cartão de débito' },
  { id: 'CARTAO_CREDITO', rotulo: 'Cartão de crédito' },
];

/** QR Code como SVG (preto sobre branco, com margem, para o celular ler em qualquer tema). */
function qrSvg(texto) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

/**
 * Finalizar pedido: mostra o valor final, pede a forma de pagamento e, se PIX, o QR Code da chave padrão.
 * `aoConcluir` roda depois de o pedido ser finalizado.
 */
export async function finalizarPedido(pedidoId, aoConcluir) {
  const pedido = await api.get(`/api/pedidos/${pedidoId}`);
  openDialog(`<h2>Finalizar pedido${pedido.senha ? ` — senha ${pedido.senha}` : ''}</h2>
    <p class="cart-total"><span>Valor final</span><b>${brl(pedido.totalCents)}</b></p>
    <fieldset class="pagamento"><legend>Forma de pagamento</legend>
      ${FORMAS_PAGAMENTO.map((f, n) => `<label class="check"><input type="radio" name="formaPagamento" value="${f.id}" ${n === 0 ? 'checked' : ''}> ${esc(f.rotulo)}</label>`).join('')}
    </fieldset>
    <div id="fp-pix" hidden></div>`,
  async (d) => {
    await api.post(`/api/pedidos/${pedidoId}/status`, { status: 'FINALIZADO', formaPagamento: d.formaPagamento });
  }, aoConcluir, { confirmLabel: 'Finalizar' });

  const area = document.getElementById('fp-pix');
  let cobranca = null;
  document.querySelectorAll('#df input[name="formaPagamento"]').forEach((r) => {
    r.onchange = async () => {
      area.hidden = r.value !== 'PIX' || !r.checked;
      if (area.hidden || cobranca) return;
      area.innerHTML = '<p class="coming">Gerando QR Code…</p>';
      try {
        cobranca = await api.get(`/api/pedidos/${pedidoId}/pix`);
        area.innerHTML = `<div class="pix-qr">${qrSvg(cobranca.payload)}</div>
          <p class="pix-info">${esc(cobranca.chave.nomeRecebedor)} · ${esc(cobranca.chave.descricao)}<br><small>Chave: ${esc(cobranca.chave.chave)}</small></p>
          <label>PIX copia e cola<textarea readonly rows="3" id="fp-copia">${esc(cobranca.payload)}</textarea></label>
          <button type="button" class="btn alt sm" id="fp-copiar">Copiar código</button>`;
        document.getElementById('fp-copiar').onclick = () => navigator.clipboard?.writeText(cobranca.payload);
      } catch (error) {
        area.innerHTML = `<div class="msg err" role="alert"><span>${esc(error.message)}</span></div>`;
      }
    };
  });
}
