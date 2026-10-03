/**
 * Suprime, por uma janela curta, o bloqueio automático de PIN que
 * `App.tsx` dispara sempre que o app sai de primeiro plano
 * (`AppState` muda de 'active' pra 'background'/'inactive').
 *
 * Sem isso, abrir a folha de compartilhamento nativa (`expo-sharing`,
 * usada pra "compartilhar comprovante") , ou qualquer outra interface
 * do sistema que tire o app de primeiro plano por um instante , conta
 * como "o app saiu de primeiro plano" e trava a tela pedindo o PIN de
 * novo na volta, MESMO que o motorista só tenha cancelado a folha de
 * compartilhamento sem realmente trocar de app. Isso é intencional
 * pra troca de app de verdade (ver Rodada 5), mas é um falso positivo
 * pra uma interface do sistema que o próprio app abriu de propósito.
 *
 * Uso: chamar `suprimirProximoBloqueio()` imediatamente ANTES de abrir
 * qualquer interface do sistema que tire o app de primeiro plano
 * (share sheet, etc). A janela é generosa (15s) porque não há como
 * saber exatamente quando o usuário vai fechar aquela interface.
 */
const JANELA_MS = 15000;

let suprimidoAte = 0;

export function suprimirProximoBloqueio(): void {
  suprimidoAte = Date.now() + JANELA_MS;
}

export function bloqueioSuprimido(): boolean {
  return Date.now() < suprimidoAte;
}
