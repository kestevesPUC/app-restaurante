'use strict';
const AppError = require('./AppError');

/** Falha de um serviço externo (ex.: WhatsApp): 502 Bad Gateway. */
class ExternalServiceError extends AppError {
  constructor(message) {
    super(message, 502);
  }
}

module.exports = ExternalServiceError;
