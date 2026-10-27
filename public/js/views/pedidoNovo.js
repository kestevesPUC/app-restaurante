import { api } from '../api.js';
import { brl, esc } from '../format.js';
import { icon } from '../icons.js';
import { view, notify, fail, openDialog } from '../ui.js';

/** Tela "Novo pedido" (A e B): cardápio à esquerda, pedido em montagem à direita; confirmar cria e confirma o pedido. */
export async function viewPedidoNovo() {
  const [cardapio, bebidas] = await Promise.all([api.get('/api/cardapio'), api.get('/api/bebidas')]);
  const bebidasAtivas = bebidas.filter((b) => b.ativo);
  const estado = { itens: [], busca: '', cliente: { nome: '', telefone: '' }, observacao: '' };

  const raiz = view();
  raiz.innerHTML = `<div class="pedido-layout">
    <section class="card" aria-label="Cardápio"><label class="grid-search"><span class="sr-only">Pesquisar</span>${icon('search')}
      <input id="pn-busca" type="search" placeholder="Pesquisar prato ou bebida…" autocomplete="off"></label><div id="pn-menu"></div></section>
    <aside class="card pedido-cart" aria-label="Pedido atual"><h2>Pedido atual</h2><div id="pn-cart"></div></aside></div>`;

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const botao = (tipo, id, nome, preco) => `<button type="button" class="menu-item" data-tipo="${tipo}" data-id="${id}">
    <b>${esc(nome)}</b><span>${brl(preco)}</span></button>`;

  function desenharMenu() {
    const q = norm(estado.busca);
    const secoes = cardapio.categorias.map((c) => {
      const pratos = cardapio.pratos.filter((p) => p.categoriaId === c.id && norm(p.nome).includes(q));
      return pratos.length ? `<h3>${esc(c.nome)}</h3><div class="menu-grid">${pratos.map((p) => botao('PRATO', p.id, p.nome, p.precoCents)).join('')}</div>` : '';
    });
    const bs = bebidasAtivas.filter((b) => norm(b.nome).includes(q));
    if (bs.length) secoes.push(`<h3>Bebidas</h3><div class="menu-grid">${bs.map((b) => botao('BEBIDA', b.id, b.nome, b.precoCents)).join('')}</div>`);
    document.getElementById('pn-menu').innerHTML = secoes.join('') || '<p class="coming">Nenhum item encontrado.</p>';
  }

  const nomeDe = (i) => (i.tipo === 'PRATO' ? cardapio.pratos : bebidasAtivas).find((x) => x.id === i.itemId)?.nome ?? '';
  const precoDe = (i) => {
    if (i.tipo === 'BEBIDA') return bebidasAtivas.find((x) => x.id === i.itemId).precoCents * i.quantidade;
    const base = cardapio.pratos.find((x) => x.id === i.itemId).precoCents;
    const extra = (i.adicionar || []).reduce((s, a) => s + a.quantidade * cardapio.adicionais.find((x) => x.id === a.ingredienteId).precoAdicionalCents, 0);
    return (base + extra) * i.quantidade;
  };
  const total = () => estado.itens.reduce((s, i) => s + precoDe(i), 0);

  function desenharCarrinho() {
    const linhas = estado.itens.map((i, n) => {
      const mods = [...(i.remover || []).map((id) => `sem ${cardapio.pratos.find((p) => p.id === i.itemId).ingredientes.find((g) => g.ingredienteId === id).nome}`),
        ...(i.adicionar || []).map((a) => `+ ${a.quantidade}× ${cardapio.adicionais.find((x) => x.id === a.ingredienteId).nome}`)];
      return `<li><div class="cart-line"><b>${esc(nomeDe(i))}</b><span>${brl(precoDe(i))}</span></div>
        ${mods.length ? `<small>${esc(mods.join(' · '))}</small>` : ''}${i.observacao ? `<small>Obs.: ${esc(i.observacao)}</small>` : ''}
        <div class="cart-ctl"><button type="button" class="btn alt sm" data-a="menos" data-n="${n}" aria-label="Diminuir">−</button><span>${i.quantidade}</span>
        <button type="button" class="btn alt sm" data-a="mais" data-n="${n}" aria-label="Aumentar">+</button>
        ${i.tipo === 'PRATO' ? `<button type="button" class="btn alt sm" data-a="editar" data-n="${n}">Personalizar</button>` : ''}
        <button type="button" class="btn alt sm danger-text" data-a="tirar" data-n="${n}">Remover</button></div></li>`;
    }).join('');
    const c = document.getElementById('pn-cart');
    c.innerHTML = `<ul class="cart-list">${linhas || '<li class="coming">Toque em um item do cardápio para adicionar.</li>'}</ul>
      <div class="form-grid"><label>Nome do cliente<input id="pn-nome" data-mask="nome" maxlength="60" autocomplete="off" value="${esc(estado.cliente.nome)}"></label>
      <label>Telefone (WhatsApp)<input id="pn-tel" data-mask="telefone" inputmode="tel" placeholder="(11) 99999-8888" autocomplete="off" value="${esc(estado.cliente.telefone)}"></label>
      <label class="wide">Observação do pedido<input id="pn-obs" maxlength="140" autocomplete="off" value="${esc(estado.observacao)}"></label></div>
      <p class="cart-total"><span>Total</span><b>${brl(total())}</b></p>
      <div class="row"><button type="button" class="btn" id="pn-ok" ${estado.itens.length ? '' : 'disabled'}>Confirmar pedido</button>
      <button type="button" class="btn alt" id="pn-limpar" ${estado.itens.length ? '' : 'disabled'}>Limpar</button></div>`;
    document.getElementById('pn-nome').oninput = (e) => { estado.cliente.nome = e.target.value; };
    document.getElementById('pn-tel').oninput = (e) => { estado.cliente.telefone = e.target.value; };
    document.getElementById('pn-obs').oninput = (e) => { estado.observacao = e.target.value; };
    document.getElementById('pn-limpar').onclick = () => { estado.itens = []; desenharCarrinho(); };
    document.getElementById('pn-ok').onclick = confirmar;
  }

  function adicionar(tipo, id) {
    const igual = estado.itens.find((i) => i.tipo === tipo && i.itemId === id && !i.remover?.length && !i.adicionar?.length && !i.observacao);
    if (igual) igual.quantidade += 1; else estado.itens.push({ tipo, itemId: id, quantidade: 1 });
    desenharCarrinho();
  }

  /** Remover ingredientes, incluir adicionais e observação de um prato do pedido. */
  function personalizar(n) {
    const item = estado.itens[n];
    const prato = cardapio.pratos.find((p) => p.id === item.itemId);
    const removiveis = prato.ingredientes.filter((g) => g.removivel);
    openDialog(`<h2>${esc(prato.nome)}</h2>
      ${removiveis.length ? `<h3>Retirar</h3>${removiveis.map((g) => `<label class="check"><input type="checkbox" name="rm-${g.ingredienteId}" ${item.remover?.includes(g.ingredienteId) ? 'checked' : ''}> Sem ${esc(g.nome)}</label>`).join('')}` : ''}
      ${cardapio.adicionais.length ? `<h3>Adicionais</h3>${cardapio.adicionais.map((a) => `<label class="check">
        <input type="number" min="0" max="9" name="ad-${a.id}" value="${item.adicionar?.find((x) => x.ingredienteId === a.id)?.quantidade ?? 0}" style="width:64px"> ${esc(a.nome)} (+${brl(a.precoAdicionalCents)})</label>`).join('')}` : ''}
      <label>Observação<input name="obs" maxlength="140" value="${esc(item.observacao ?? '')}"></label>`,
    async (d) => {
      item.remover = removiveis.filter((g) => d[`rm-${g.ingredienteId}`] === 'on').map((g) => g.ingredienteId);
      item.adicionar = cardapio.adicionais.map((a) => ({ ingredienteId: a.id, quantidade: Number(d[`ad-${a.id}`]) || 0 })).filter((a) => a.quantidade > 0);
      item.observacao = d.obs.trim();
    }, desenharCarrinho, { confirmLabel: 'Aplicar' });
  }

  async function confirmar() {
    const botaoOk = document.getElementById('pn-ok');
    botaoOk.disabled = true;
    try {
      const itens = estado.itens.map((i) => ({ tipo: i.tipo, itemId: i.itemId, quantidade: i.quantidade, observacao: i.observacao || undefined, remover: i.remover, adicionar: i.adicionar }));
      const cliente = { nome: estado.cliente.nome, telefone: estado.cliente.telefone };
      const rascunho = await api.post('/api/pedidos', { cliente, itens, observacao: estado.observacao || undefined });
      try {
        const pedido = await api.post(`/api/pedidos/${rascunho.id}/confirmar`);
        estado.itens = []; estado.cliente = { nome: '', telefone: '' }; estado.observacao = '';
        notify(`Pedido confirmado — SENHA ${pedido.senha} (nº ${pedido.id}) — ${brl(pedido.totalCents)}`);
      } catch (error) {
        notify(`${error.message} O pedido nº ${rascunho.id} ficou como rascunho.`, 'err');
        estado.itens = []; // evita duplicar: o rascunho já existe
      }
    } catch (error) { fail(error); }
    desenharCarrinho();
  }

  document.getElementById('pn-busca').oninput = (e) => { estado.busca = e.target.value; desenharMenu(); };
  document.getElementById('pn-menu').onclick = (e) => {
    const b = e.target.closest('.menu-item');
    if (b) adicionar(b.dataset.tipo, Number(b.dataset.id));
  };
  document.getElementById('pn-cart').onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const n = Number(b.dataset.n);
    const item = estado.itens[n];
    if (b.dataset.a === 'mais') item.quantidade += 1;
    if (b.dataset.a === 'menos') item.quantidade = Math.max(1, item.quantidade - 1);
    if (b.dataset.a === 'tirar') estado.itens.splice(n, 1);
    if (b.dataset.a === 'editar') return personalizar(n);
    return desenharCarrinho();
  };
  desenharMenu();
  desenharCarrinho();
}
