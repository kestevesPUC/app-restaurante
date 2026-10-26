// Operações puras sobre a lista de ingredientes de um prato ({ingredienteId, nome, removivel, quantidade, ordem}).

/** Reatribui `ordem` sequencial (0..n-1) conforme a posição. */
export const renumerar = (lista) => lista.map((item, i) => ({ ...item, ordem: i }));

/** Ordena por `ordem` (empate: posição original). */
export const ordenarPorOrdem = (lista) => lista
  .map((item, i) => [item, i])
  .sort((a, b) => (a[0].ordem ?? 0) - (b[0].ordem ?? 0) || a[1] - b[1])
  .map(([item]) => item);

/** Move o item do índice `indice` uma posição (dir -1 sobe, +1 desce); fora dos limites não muda nada. */
export function moverItem(lista, indice, dir) {
  const destino = indice + dir;
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return renumerar(lista);
  const copia = [...lista];
  [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
  return renumerar(copia);
}

/** Acrescenta ao fim (removível por padrão); ignora ingrediente que já está na lista. */
export function adicionarIngrediente(lista, { ingredienteId, nome, removivel = true, quantidade = null }) {
  if (lista.some((i) => i.ingredienteId === ingredienteId)) return renumerar(lista);
  return renumerar([...lista, { ingredienteId, nome, removivel, quantidade }]);
}

export const removerIngrediente = (lista, ingredienteId) => renumerar(lista.filter((i) => i.ingredienteId !== ingredienteId));
