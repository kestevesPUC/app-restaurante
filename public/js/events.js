// Conexão SSE (/api/eventos) com reconexão automática.
const TIPOS = ['pedido', 'pagamento', 'mesa', 'fila', 'whatsapp', 'cozinha'];
const ESPERA_MIN = 1000;
const ESPERA_MAX = 15000;

/**
 * Abre o canal de eventos. `onEvento(tipo, dados)` recebe cada evento; `onEstado(conectado)` avisa quedas e retomadas.
 * O EventSource já tenta reconectar sozinho; se o navegador desistir (conexão fechada), reabrimos com espera crescente.
 * @returns {{fechar(): void}}
 */
export function conectar(onEvento, onEstado = () => {}) {
  let source = null;
  let timer = null;
  let espera = ESPERA_MIN;
  let encerrado = false;

  const abrir = () => {
    if (encerrado) return;
    source = new EventSource('/api/eventos');
    source.onopen = () => { espera = ESPERA_MIN; onEstado(true); };
    source.onerror = () => {
      onEstado(false);
      if (source.readyState !== EventSource.CLOSED) return; // o navegador reconecta sozinho
      source.close();
      timer = setTimeout(abrir, espera);
      espera = Math.min(espera * 2, ESPERA_MAX);
    };
    for (const tipo of TIPOS) {
      source.addEventListener(tipo, (event) => {
        let dados = null;
        try { dados = JSON.parse(event.data); } catch { /* evento sem JSON válido */ }
        onEvento(tipo, dados);
      });
    }
  };
  abrir();

  return { fechar() { encerrado = true; clearTimeout(timer); source?.close(); } };
}
