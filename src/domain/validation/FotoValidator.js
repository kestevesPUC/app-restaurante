'use strict';
const ValidationError = require('../errors/ValidationError');

const DATA_URI = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

// Assinaturas (magic bytes) para não aceitar arquivos que apenas declaram ser imagem.
const ASSINATURAS = {
  'image/png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/jpeg': (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Valida a foto de um prato enviada como data URI (PNG, JPEG ou WebP, sem limite de tamanho). */
class FotoValidator {
  /** @returns {{tipo: string, dados: Buffer}} */
  parse(dataUri) {
    const encontrado = DATA_URI.exec(String(dataUri || ''));
    if (!encontrado) throw new ValidationError('Envie uma imagem PNG, JPEG ou WebP');
    const [, tipo, base64] = encontrado;
    const dados = Buffer.from(base64, 'base64');
    if (dados.length === 0) throw new ValidationError('Imagem vazia');
    if (!ASSINATURAS[tipo](dados)) throw new ValidationError('O arquivo enviado não é uma imagem válida');
    return { tipo, dados };
  }
}

module.exports = FotoValidator;
