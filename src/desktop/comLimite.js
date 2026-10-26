'use strict';

/**
 * Espera `promessa` por no máximo `ms`. Se estourar (ou rejeitar), registra e segue: nunca lança nem trava.
 * @returns {Promise<boolean>} true se concluiu no prazo
 */
async function comLimite(promessa, ms, { logger = console, rotulo = 'operação', agendar = setTimeout, cancelar = clearTimeout } = {}) {
  let timer;
  const limite = new Promise((resolver) => { timer = agendar(() => resolver('limite'), ms); });
  try {
    const r = await Promise.race([Promise.resolve(promessa).then(() => 'ok'), limite]);
    if (r === 'limite') {
      logger.error?.(`[${rotulo}] sem resposta em ${ms} ms; seguindo o encerramento`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error?.(`[${rotulo}]`, error?.message ?? error);
    return false;
  } finally {
    cancelar(timer);
  }
}

module.exports = { comLimite };
