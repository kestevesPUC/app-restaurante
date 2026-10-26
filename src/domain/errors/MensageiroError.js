'use strict';
const ExternalServiceError = require('./ExternalServiceError');

const MENSAGENS = Object.freeze({
  NAO_CONECTADO: 'O WhatsApp não está conectado',
  NUMERO_SEM_WHATSAPP: 'Este número não tem WhatsApp',
  TIMEOUT: 'Tempo esgotado ao enviar a mensagem',
  ERRO_ENVIO: 'Falha ao enviar a mensagem',
});

/** Falha do mensageiro; `code`: 'NAO_CONECTADO' | 'NUMERO_SEM_WHATSAPP' | 'TIMEOUT' | 'ERRO_ENVIO'. */
class MensageiroError extends ExternalServiceError {
  constructor(code = 'ERRO_ENVIO') {
    super(MENSAGENS[code] ?? MENSAGENS.ERRO_ENVIO);
    this.code = MENSAGENS[code] ? code : 'ERRO_ENVIO';
  }
}

module.exports = MensageiroError;
