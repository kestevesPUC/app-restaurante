import { api } from '../api.js';
import { esc, reaisParaCents, centsParaReais } from '../format.js';
import { icon } from '../icons.js';
import { notify, openDialog } from '../ui.js';
import { createIngredientePicker } from '../components/ingredientePicker.js';
import { adicionarIngrediente, moverItem, ordenarPorOrdem, removerIngrediente, renumerar } from '../listaOrdenada.js';

export const FOTO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'];

/** Valida a foto escolhida no cliente (o servidor valida de novo). Devolve a mensagem de erro ou ''. */
export function validarFoto(file) {
  if (!FOTO_TIPOS.includes(file.type)) return 'A foto deve ser PNG, JPEG ou WebP';
  return '';
}

const lerComoDataUri = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
  reader.readAsDataURL(file);
});

/**
 * Modal de prato com abas Dados e Ingredientes. `prato` ausente = novo; `somenteLeitura` = consulta (nível B).
 * A foto é enviada em chamada separada depois de salvar o prato.
 */
export function openPratoForm({ prato = null, categorias, ingredientes, reload, somenteLeitura = false }) {
  let lista = renumerar(ordenarPorOrdem(prato?.ingredientes ?? []).map((i) => ({ ...i })));
  const foto = { acao: 'nenhuma', dataUri: null, existente: !!prato?.temFoto };
  const inativoJaNoPrato = (id) => ingredientes.find((i) => i.id === id)?.ativo === false;
  const opcoes = categorias.filter((c) => c.ativo || c.id === prato?.categoriaId)
    .map((c) => `<option value="${c.id}" ${c.id === prato?.categoriaId ? 'selected' : ''}>${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');

  const html = `<h2>${somenteLeitura ? 'Prato' : prato ? 'Editar prato' : 'Novo prato'}${prato ? ` ${esc(prato.nome)}` : ''}</h2>
    <div class="tabs" role="tablist" aria-label="Seções do prato">
      <button type="button" role="tab" id="tab-dados" aria-selected="true" aria-controls="painel-dados" data-tab="dados">Dados</button>
      <button type="button" role="tab" id="tab-ingr" aria-selected="false" aria-controls="painel-ingr" data-tab="ingr" tabindex="-1">Ingredientes <span class="badge" id="ingrCount"></span></button>
    </div>
    <fieldset ${somenteLeitura ? 'disabled' : ''} class="plain">
    <div role="tabpanel" id="painel-dados" aria-labelledby="tab-dados" class="form-grid">
      <label>Nome<input name="nome" maxlength="60" required autocomplete="off" value="${esc(prato?.nome ?? '')}"></label>
      <label>Código curto<input name="codigo" maxlength="20" autocomplete="off" value="${esc(prato?.codigo ?? '')}"></label>
      <label>Categoria<select name="categoriaId" required>${prato ? '' : '<option value="">Selecione…</option>'}${opcoes}</select></label>
      <label>Preço (R$)<input name="preco" data-mask="dinheiro" inputmode="decimal" autocomplete="off" placeholder="0,00" required value="${esc(centsParaReais(prato?.precoCents))}"></label>
      <label>Tempo de preparo (min)<input name="tempoPreparo" type="number" min="1" step="1" inputmode="numeric" autocomplete="off" placeholder="Ex.: 15" required value="${esc(prato?.tempoPreparoMin ?? '')}"></label>
      <label class="wide">Descrição<input name="descricao" maxlength="300" autocomplete="off" value="${esc(prato?.descricao ?? '')}"></label>
      <label class="check"><input type="checkbox" name="ativo" ${prato?.ativo ?? true ? 'checked' : ''}>Ativo</label>
      <div class="wide foto-box">
        <div class="foto-prev" id="fotoPrev" aria-live="polite"></div>
        <div class="foto-ctl">
          <label>Foto (PNG, JPEG ou WebP)<input type="file" id="fotoFile" accept="image/png,image/jpeg,image/webp"></label>
          <button type="button" class="btn alt sm" id="fotoRemover" hidden>Remover foto</button>
          <p class="field-err" id="fotoErr" role="alert"></p>
        </div>
      </div>
    </div>
    <div role="tabpanel" id="painel-ingr" aria-labelledby="tab-ingr" hidden>
      <div id="picker"></div>
      <ul class="ingr-list" id="ingrList" aria-label="Ingredientes do prato"></ul>
    </div>
    </fieldset>`;

  const salvar = async (data) => {
    const precoCents = reaisParaCents(data.preco);
    if (precoCents === null || precoCents <= 0) throw new Error('Preço inválido. Informe um valor em reais maior que zero (ex.: 24,90)');
    if (!data.categoriaId) throw new Error('Informe a categoria');
    const tempoPreparoMin = Number(String(data.tempoPreparo ?? '').trim());
    if (!Number.isInteger(tempoPreparoMin) || tempoPreparoMin < 1) throw new Error('Informe o tempo de preparo em minutos (número inteiro maior que zero, ex.: 15)');
    const corpo = {
      nome: data.nome,
      codigo: data.codigo.trim() || null,
      categoriaId: Number(data.categoriaId),
      descricao: data.descricao.trim() || null,
      precoCents,
      tempoPreparoMin,
      ativo: data.ativo === 'on',
      ingredientes: lista.map((i, ordem) => ({ ingredienteId: i.ingredienteId, removivel: i.removivel, quantidade: (i.quantidade || '').trim() || null, ordem })),
    };
    const salvo = prato ? await api.put(`/api/pratos/${prato.id}`, corpo) : await api.post('/api/pratos', corpo);
    try {
      if (foto.acao === 'definir') await api.put(`/api/pratos/${salvo.id}/foto`, { foto: foto.dataUri });
      else if (foto.acao === 'remover') await api.del(`/api/pratos/${salvo.id}/foto`);
    } catch (error) {
      notify(`Prato salvo, mas a foto não foi enviada: ${error.message}`, 'err');
    }
    return salvo;
  };

  openDialog(html, somenteLeitura ? async () => {} : salvar,
    async () => { if (somenteLeitura) return; await reload(); if (!document.querySelector('#msg .err')) notify(prato ? 'Prato atualizado' : 'Prato cadastrado'); },
    { confirmLabel: somenteLeitura ? 'Fechar' : 'Salvar', hideCancel: somenteLeitura });

  const dlg = document.getElementById('dlg');
  const $ = (id) => dlg.querySelector(`#${id}`);

  // ----- abas
  const tabs = [...dlg.querySelectorAll('[role="tab"]')];
  const mostrarAba = (nome, foco = false) => {
    tabs.forEach((t) => { const on = t.dataset.tab === nome; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && foco) t.focus(); });
    $('painel-dados').hidden = nome !== 'dados';
    $('painel-ingr').hidden = nome !== 'ingr';
  };
  // Campo obrigatório vazio na aba oculta: o navegador barra o envio sem mostrar nada. Volta para a aba dele.
  dlg.addEventListener('invalid', (event) => {
    if ($('painel-dados').contains(event.target) && $('painel-dados').hidden) mostrarAba('dados');
  }, true);
  tabs.forEach((t, i) => {
    t.onclick = () => mostrarAba(t.dataset.tab);
    t.onkeydown = (event) => {
      const passo = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (passo) { event.preventDefault(); mostrarAba(tabs[(i + passo + tabs.length) % tabs.length].dataset.tab, true); }
    };
  });

  // ----- foto
  const pintarFoto = () => {
    const url = foto.acao === 'definir' ? foto.dataUri : (foto.existente && foto.acao !== 'remover' ? `/api/pratos/${prato.id}/foto?v=${Date.now()}` : null);
    $('fotoPrev').innerHTML = url ? `<img src="${esc(url)}" alt="Foto do prato" width="120" height="120">` : '<span>Sem foto</span>';
    $('fotoRemover').hidden = somenteLeitura || !url;
  };
  $('fotoFile').onchange = async (event) => {
    const file = event.target.files[0];
    $('fotoErr').textContent = '';
    if (!file) return;
    const erro = validarFoto(file);
    if (erro) { event.target.value = ''; $('fotoErr').textContent = erro; return; }
    try {
      foto.dataUri = await lerComoDataUri(file);
      foto.acao = 'definir';
      pintarFoto();
    } catch (error) { $('fotoErr').textContent = error.message; }
  };
  $('fotoRemover').onclick = () => {
    $('fotoFile').value = '';
    foto.dataUri = null;
    foto.acao = foto.existente ? 'remover' : 'nenhuma';
    pintarFoto();
  };
  pintarFoto();

  // ----- ingredientes
  const picker = createIngredientePicker($('picker'), {
    ingredientes,
    usados: lista.map((i) => i.ingredienteId),
    onPick: (ing) => { lista = adicionarIngrediente(lista, { ingredienteId: ing.id, nome: ing.nome }); desenhar(); picker.refresh(lista.map((i) => i.ingredienteId)); },
  });
  if (somenteLeitura) $('picker').hidden = true;

  const desenhar = (focar = null) => {
    $('ingrCount').textContent = String(lista.length);
    $('ingrList').innerHTML = lista.length ? lista.map((item, i) => `<li data-i="${i}">
        <span class="ingr-nome">${esc(item.nome)}${inativoJaNoPrato(item.ingredienteId) ? ' <small>(inativo)</small>' : ''}</span>
        <label class="check"><input type="checkbox" data-f="removivel" ${item.removivel ? 'checked' : ''}>Removível</label>
        <label class="qtd"><span class="visually-hidden">Quantidade de ${esc(item.nome)}</span><input data-f="quantidade" maxlength="40" placeholder="Quantidade (ex.: 2 fatias)" value="${esc(item.quantidade ?? '')}"></label>
        <span class="ingr-btns">
          <button type="button" class="btn alt sm" data-m="up" aria-label="Subir ${esc(item.nome)}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn alt sm" data-m="down" aria-label="Descer ${esc(item.nome)}" ${i === lista.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn alt sm danger-text" data-m="del" aria-label="Remover ${esc(item.nome)} do prato">${icon('x')}</button>
        </span></li>`).join('') : '<li class="empty-note">Nenhum ingrediente neste prato.</li>';
    if (focar) $('ingrList').querySelector(`li[data-i="${focar.i}"] [data-m="${focar.m}"]`)?.focus();
  };
  $('ingrList').addEventListener('input', (event) => {
    const campo = event.target.dataset.f;
    const item = lista[Number(event.target.closest('li')?.dataset.i)];
    if (campo === 'quantidade' && item) item.quantidade = event.target.value;
  });
  $('ingrList').addEventListener('change', (event) => {
    const item = lista[Number(event.target.closest('li')?.dataset.i)];
    if (event.target.dataset.f === 'removivel' && item) item.removivel = event.target.checked;
  });
  $('ingrList').addEventListener('click', (event) => {
    const botao = event.target.closest('button[data-m]');
    if (!botao) return;
    const i = Number(botao.closest('li').dataset.i);
    if (botao.dataset.m === 'del') {
      lista = removerIngrediente(lista, lista[i].ingredienteId);
      desenhar();
      picker.refresh(lista.map((x) => x.ingredienteId));
      return;
    }
    const dir = botao.dataset.m === 'up' ? -1 : 1;
    lista = moverItem(lista, i, dir);
    // mantém o foco no mesmo botão, que agora está na nova posição (ou no oposto se chegou à borda)
    const novo = i + dir;
    const borda = novo === 0 || novo === lista.length - 1;
    desenhar({ i: novo, m: borda ? (dir === -1 ? 'down' : 'up') : botao.dataset.m });
  });
  desenhar();
  if (somenteLeitura) dlg.querySelectorAll('#ingrList button, #ingrList input').forEach((el) => { el.disabled = true; });
  dlg.querySelector('[name="nome"]').focus();
}
