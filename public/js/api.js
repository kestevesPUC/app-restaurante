// Cliente HTTP da API; erros do servidor viram exceções com a mensagem em português.
export const SESSAO_EXPIRADA = 'pdv:session-expired';

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique se o sistema está aberto.');
  }
  const data = await response.json().catch(() => ({}));
  // 401 fora do login e da checagem inicial = sessão expirada: a interface volta para a tela de login.
  if (response.status === 401 && path !== '/api/login' && path !== '/api/me' && path !== '/api/logout') {
    window.dispatchEvent(new CustomEvent(SESSAO_EXPIRADA));
  }
  if (!response.ok) throw Object.assign(new Error(data.error || `Erro ${response.status}`), { status: response.status, code: data.code });
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

/** Monta uma query string ignorando valores vazios. */
export const queryString = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
