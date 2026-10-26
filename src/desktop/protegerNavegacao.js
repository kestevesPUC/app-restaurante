'use strict';

const ehHttp = (alvo) => /^https?:\/\//i.test(alvo);

/** Bloqueia navegação/redirecionamento/frames fora da origem do app; http(s) externo abre no navegador do sistema. */
function protegerNavegacao(webContents, origem, abrirExterno) {
  const dentro = (alvo) => alvo === origem || alvo.startsWith(`${origem}/`);
  const barrar = (event, alvo) => {
    if (dentro(alvo)) return;
    event.preventDefault();
    if (ehHttp(alvo)) abrirExterno(alvo);
  };
  webContents.setWindowOpenHandler(({ url }) => {
    if (ehHttp(url) && !dentro(url)) abrirExterno(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, alvo) => barrar(event, alvo));
  webContents.on('will-redirect', (event, alvo) => barrar(event, alvo));
  // will-frame-navigate: o evento traz .url
  webContents.on('will-frame-navigate', (event) => barrar(event, event.url));
}

module.exports = { protegerNavegacao };
