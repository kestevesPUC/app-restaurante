'use strict';

/**
 * Porta do mensageiro (WhatsApp). Contrato apenas documental, como as demais portas:
 *
 * @typedef {'DESCONECTADO'|'AGUARDANDO_QR'|'CONECTANDO'|'CONECTADO'} EstadoMensageiro
 *
 * @typedef {object} Mensageiro
 * @property {() => EstadoMensageiro} estado
 * @property {(msg: {telefoneE164: string, texto: string}) => Promise<{id: string}>} enviar
 *   rejeita com `MensageiroError` (code NAO_CONECTADO | NUMERO_SEM_WHATSAPP | TIMEOUT | ERRO_ENVIO)
 */

module.exports = {};
