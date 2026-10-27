// Máscaras de digitação. Marque o campo com data-mask="telefone|cpf|cep|dinheiro|nome"; vale para qualquer tela ou diálogo.
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

export function maskTelefone(valor) {
  let d = digitos(valor);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2); // colado com +55
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const miolo = d.length > 10 ? 7 : 6;
  if (d.length <= miolo) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, miolo)}-${d.slice(miolo)}`;
}

export function maskCpf(valor) {
  const d = digitos(valor).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export function maskCep(valor) {
  return digitos(valor).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
}

/** Dinheiro: os dígitos digitados entram da direita para a esquerda ("1250" → "12,50"; "123456" → "1.234,56"). */
export function maskDinheiro(valor) {
  const d = digitos(valor).replace(/^0+(?=\d)/, '').slice(0, 11);
  if (!d) return '';
  const cents = d.padStart(3, '0');
  const inteiro = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${cents.slice(-2)}`;
}

const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'della']);
/** Mesma regra do servidor (src/domain/nomePessoa.js): "JOÃO da SILVA" → "João da Silva". */
export function formatarNome(texto) {
  const palavras = String(texto ?? '').trim().split(/\s+/).filter(Boolean);
  return palavras.map((p, i) => {
    const min = p.toLocaleLowerCase('pt-BR');
    if (i > 0 && PARTICULAS.has(min)) return min;
    return min.replace(/(^|[-"(“])(\p{L})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase('pt-BR'));
  }).join(' ');
}

const MASCARAS = { telefone: maskTelefone, cpf: maskCpf, cep: maskCep, dinheiro: maskDinheiro };

/** Reaplica a máscara mantendo o cursor depois do mesmo número de dígitos. */
function aplicar(input, mascara) {
  const antes = input.value;
  const cursor = input.selectionStart ?? antes.length;
  const naoDigitosAntes = digitos(antes.slice(0, cursor)).length;
  const depois = mascara(antes);
  if (depois === antes) return;
  input.value = depois;
  if (cursor >= antes.length) return;
  let n = 0;
  let pos = 0;
  while (pos < depois.length && n < naoDigitosAntes) { if (/\d/.test(depois[pos])) n += 1; pos += 1; }
  input.setSelectionRange(pos, pos);
}

/** Liga as máscaras uma única vez, por delegação de eventos (cobre campos criados depois). */
export function initMasks() {
  document.addEventListener('input', (event) => {
    const mascara = MASCARAS[event.target?.dataset?.mask];
    if (mascara) aplicar(event.target, mascara);
  });
  document.addEventListener('focusin', (event) => {
    const mascara = MASCARAS[event.target?.dataset?.mask];
    if (mascara && event.target.value) event.target.value = mascara(event.target.value); // valor inicial sem máscara
  });
  document.addEventListener('focusout', (event) => {
    if (event.target?.dataset?.mask !== 'nome') return;
    const formatado = formatarNome(event.target.value);
    if (formatado !== event.target.value) {
      event.target.value = formatado;
      event.target.dispatchEvent(new Event('input', { bubbles: true })); // avisa quem guarda o valor
    }
  });
}
