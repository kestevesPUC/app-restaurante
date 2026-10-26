// Título do app (igual ao da janela do desktop): "PDV Restaurante — v0.1.0".
export function montarTitulo(nome, versao) {
  const n = String(nome ?? '').trim();
  const v = String(versao ?? '').trim();
  return v ? `${n} — v${v}` : n;
}
