import { api } from '../api.js';
import { notify, fail } from '../ui.js';

/** Reenvia o aviso de pedido pronto ao cliente (botão com data-id) e informa o resultado. */
export async function reenviarAviso(botao) {
  botao.disabled = true;
  try {
    const linha = await api.post(`/api/pedidos/${botao.dataset.id}/notificacoes/reenviar`);
    if (linha.situacao === 'ENVIADA') notify('Cliente avisado pelo WhatsApp');
    else notify(`Não foi possível avisar o cliente: ${linha.erro}`, 'err');
  } catch (error) { fail(error); }
  botao.disabled = false;
}
