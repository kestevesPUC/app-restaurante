'use strict';

/** Níveis de acesso (RN-01). */
const NIVEIS = Object.freeze({ A: 'Administrador', B: 'Atendente', C: 'Cozinha' });

const nivelValido = (nivel) => Object.hasOwn(NIVEIS, nivel);

module.exports = { NIVEIS, nivelValido };
