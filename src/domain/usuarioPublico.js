'use strict';

/** Visão do usuário que pode sair da camada de aplicação (nunca inclui o hash da senha). */
const usuarioPublico = (u) => ({
  id: u.id, usuario: u.usuario, nome: u.nome, nivel: u.nivel, mustChange: !!u.mustChange, ativo: !!u.ativo,
});

/** Dados do usuário que podem ir para a auditoria. */
const usuarioSnapshot = (u) => ({ id: u.id, usuario: u.usuario, nome: u.nome, nivel: u.nivel, ativo: !!u.ativo });

module.exports = { usuarioPublico, usuarioSnapshot };
