'use strict';

// Partículas que ficam em minúsculas no meio do nome ("Maria da Silva", "João dos Santos e Souza").
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'della']);

/**
 * Nome de pessoa bem formatado, qualquer que seja a digitação: "JOÃO  da SILVA" → "João da Silva".
 * Remove espaços sobrando, põe a inicial de cada palavra em maiúscula (também depois de hífen, aspas e parêntese)
 * e mantém "da/de/do/das/dos/e" em minúsculas fora da primeira posição.
 */
function formatarNome(texto) {
  if (typeof texto !== 'string') return texto;
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  return palavras.map((palavra, i) => {
    const minuscula = palavra.toLocaleLowerCase('pt-BR');
    if (i > 0 && PARTICULAS.has(minuscula)) return minuscula;
    return minuscula.replace(/(^|[-"(“])(\p{L})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase('pt-BR'));
  }).join(' ');
}

module.exports = { formatarNome };
