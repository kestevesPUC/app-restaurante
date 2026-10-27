'use strict';
// BR Code do PIX estático (Manual de Padrões para Iniciação do Pix, BCB): campos EMV "ID + tamanho + valor" e CRC16 no fim.

const NOME_MAX = 25;
const CIDADE_MAX = 15;
const TXID_MAX = 25;

/** Só ASCII imprimível, sem acentos (o padrão EMV não aceita outros caracteres). */
const ascii = (texto) => String(texto).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7E]/g, '').trim();

function campo(id, valor) {
  const tamanho = String(valor.length).padStart(2, '0');
  return `${id}${tamanho}${valor}`;
}

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
function crc16(texto) {
  let crc = 0xFFFF;
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta o "copia e cola" do PIX.
 * @param {{chave: string, nome: string, cidade: string, valorCents?: number, txid?: string}} dados
 */
function gerarBrCode({ chave, nome, cidade, valorCents, txid }) {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  const identificador = ascii(txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, TXID_MAX) || '***';
  const corpo = [
    campo('00', '01'),
    campo('26', conta),
    campo('52', '0000'),
    campo('53', '986'),
    valorCents ? campo('54', (valorCents / 100).toFixed(2)) : '',
    campo('58', 'BR'),
    campo('59', ascii(nome).slice(0, NOME_MAX)),
    campo('60', ascii(cidade).slice(0, CIDADE_MAX)),
    campo('62', campo('05', identificador)),
    '6304',
  ].join('');
  return corpo + crc16(corpo);
}

module.exports = { gerarBrCode, crc16, NOME_MAX, CIDADE_MAX };
