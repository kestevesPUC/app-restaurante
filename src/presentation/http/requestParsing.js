'use strict';
const ValidationError = require('../../domain/errors/ValidationError');
const AppError = require('../../domain/errors/AppError');

const MAX_BODY_BYTES = 1_000_000;

/** Lê o corpo JSON (sempre um objeto). Corpo vazio vira `{}`. */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError('Requisição muito grande', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('JSON inválido');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('O corpo deve ser um objeto JSON');
  return body;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

module.exports = { readJsonBody, parseCookies };
