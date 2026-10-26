import { view } from '../ui.js';

/** Andon da cozinha — tela vazia até a tarefa do andon. */
export async function viewAndon() {
  view().innerHTML = '<p class="coming" role="status">Andon da cozinha — em construção</p>';
}
