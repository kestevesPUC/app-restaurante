'use strict';

/** Roda o backup sem nunca propagar a falha; notifica `aoFalhar` (ex.: aviso ao usuário). */
function executarBackupSeguro(backup, { logger = console, aoFalhar = () => {} } = {}) {
  try {
    return backup.run();
  } catch (error) {
    logger.error('[backup]', error.message);
    try { aoFalhar(error); } catch (e) { logger.error('[backup]', e.message); }
    return null;
  }
}

module.exports = { executarBackupSeguro };
