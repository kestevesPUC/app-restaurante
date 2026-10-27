import { api } from '../api.js';
import { esc } from '../format.js';
import { view, notify, fail, openDialog, confirmDialog } from '../ui.js';

const TIPOS = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail', TELEFONE: 'Telefone', ALEATORIA: 'Chave aleatória' };

/** Chaves PIX (nível A): cadastrar, editar, excluir e escolher a padrão (usada no QR Code ao finalizar pedidos). */
export async function viewPix() {
  const chaves = await api.get('/api/pix/chaves');
  const reload = () => viewPix().catch(fail);

  view().innerHTML = `<div class="card" id="pix-tela"><div class="row"><h2>Chaves PIX</h2>
    <button type="button" class="btn" data-a="nova">Nova chave</button></div>
    ${chaves.length ? `<table class="grid"><thead><tr><th>Descrição</th><th>Tipo</th><th>Chave</th><th>Recebedor</th><th>Cidade</th><th></th><th></th></tr></thead><tbody>
    ${chaves.map((c) => `<tr><td>${esc(c.descricao)}</td><td>${TIPOS[c.tipo]}</td><td>${esc(c.chave)}</td><td>${esc(c.nomeRecebedor)}</td><td>${esc(c.cidade)}</td>
      <td>${c.padrao ? '<span class="tag ok">Padrão</span>' : `<button type="button" class="btn alt sm" data-a="padrao" data-id="${c.id}">Tornar padrão</button>`}</td>
      <td><button type="button" class="btn alt sm" data-a="editar" data-id="${c.id}">Editar</button>
      <button type="button" class="btn alt sm danger-text" data-a="excluir" data-id="${c.id}">Excluir</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="coming">Nenhuma chave cadastrada. A primeira chave cadastrada vira a padrão.</p>'}</div>`;

  view().onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const chave = chaves.find((c) => c.id === Number(b.dataset.id));
    try {
      if (b.dataset.a === 'nova') return openForm(reload);
      if (b.dataset.a === 'editar') return openForm(reload, chave);
      if (b.dataset.a === 'padrao') { await api.post(`/api/pix/chaves/${chave.id}/padrao`); notify('Chave padrão alterada'); }
      if (b.dataset.a === 'excluir') {
        if (!await confirmDialog({ title: 'Excluir chave PIX', message: `Excluir a chave "${chave.descricao}"?`, confirmLabel: 'Excluir', danger: true })) return;
        await api.del(`/api/pix/chaves/${chave.id}`);
        notify('Chave excluída');
      }
      return reload();
    } catch (error) { return fail(error); }
  };
}

function openForm(reload, c = null) {
  openDialog(`<h2>${c ? `Editar chave ${esc(c.descricao)}` : 'Nova chave PIX'}</h2><div class="form-grid">
    <label>Descrição<input name="descricao" maxlength="60" required autocomplete="off" autofocus placeholder="Ex.: Conta da loja" value="${esc(c?.descricao ?? '')}"></label>
    <label>Tipo<select name="tipo">${Object.entries(TIPOS).map(([v, r]) => `<option value="${v}" ${c?.tipo === v ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="wide">Chave<input name="chave" maxlength="77" required autocomplete="off" value="${esc(c?.chave ?? '')}"></label>
    <label>Nome do recebedor<input name="nomeRecebedor" maxlength="25" required autocomplete="off" value="${esc(c?.nomeRecebedor ?? '')}"></label>
    <label>Cidade<input name="cidade" maxlength="15" required autocomplete="off" value="${esc(c?.cidade ?? '')}"></label>
    </div>`,
  async (d) => {
    const corpo = { descricao: d.descricao, tipo: d.tipo, chave: d.chave, nomeRecebedor: d.nomeRecebedor, cidade: d.cidade };
    return c ? api.put(`/api/pix/chaves/${c.id}`, corpo) : api.post('/api/pix/chaves', corpo);
  },
  async () => { await reload(); notify(c ? 'Chave atualizada' : 'Chave cadastrada'); },
  { confirmLabel: 'Salvar' });
}
