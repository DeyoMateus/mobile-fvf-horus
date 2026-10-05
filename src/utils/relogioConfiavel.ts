/**
 * Rodada 73 , pedido do usuário: o app estava confiando na hora do
 * sistema do aparelho pra registrar o ponto e pro cronômetro, mesmo
 * quando o motorista adianta/atrasa o relógio manualmente , o
 * antifraude até detectava o desvio (RELOGIO_DISPOSITIVO_SUSPEITO),
 * mas só DEPOIS do horário errado já ter ido pro banco ("registrei o
 * ponto alterei a hora avançando 5 horas... foi para o banco de dados
 * com a hora errada... não pegou a hora correta do satélite").
 *
 * A localização (GPS) devolve um timestamp próprio
 * (`Location.LocationObject.timestamp`), vindo do provedor de
 * localização do aparelho (GPS/rede), não do relógio do sistema ,
 * muito mais difícil de adulterar só ajustando a hora nas
 * configurações do aparelho. Este módulo guarda o desvio entre esse
 * timestamp e `Date.now()` no momento do último fix, pra tanto o
 * registro do ponto quanto o cronômetro (que só mostra, não é enviado
 * a lugar nenhum) usarem a hora corrigida, não a hora crua do
 * aparelho.
 *
 * Estado em memória (module-level), de propósito , não precisa
 * persistir entre reinícios do app: a cada novo fix de GPS (que já
 * acontece a cada toque de registrar ponto) o desvio é atualizado de
 * novo. Enquanto nenhum fix ainda aconteceu na sessão atual do app,
 * o desvio é 0 (comportamento idêntico ao de antes , nunca regride).
 */

import { lerAncoraRelogio, salvarAncoraRelogio } from "../storage/db";
import { obterElapsedRealtimeMs } from "./relogioMonotonico";

let desvioMs = 0;

// Rodada 137 , âncora do SERVIDOR: (hora do servidor, monotônico no
// mesmo instante). Com ela o cronômetro anda com hora de servidor +
// tempo monotônico decorrido, que mexer no relógio do aparelho não
// altera.
let ancora: { horaServidorMs: number; elapsedRealtimeMs: number } | null =
  null;
let ancoraCarregada = false;

export function registrarAncoraServidor(
  horaServidorMs: number,
  elapsedRealtimeMs: number,
): void {
  ancora = { horaServidorMs, elapsedRealtimeMs };
  ancoraCarregada = true;
  try {
    salvarAncoraRelogio(horaServidorMs, elapsedRealtimeMs);
  } catch {
    // best-effort
  }
}

/**
 * Chamado sempre que um fix de GPS é obtido , atualiza o desvio
 * conhecido entre o relógio do aparelho e a hora do provedor de
 * localização.
 */
export function registrarFixDeRelogio(
  timestampFixMs: number | null | undefined,
): void {
  if (!timestampFixMs) return;
  desvioMs = timestampFixMs - Date.now();
}

/**
 * "Agora", corrigido pelo desvio de relógio conhecido (0 = sem nenhum
 * fix de GPS ainda nesta sessão do app, ou relógio do aparelho já
 * correto).
 */
export function agoraConfiavel(): number {
  if (!ancoraCarregada) {
    ancora = lerAncoraRelogio();
    ancoraCarregada = true;
  }
  if (ancora) {
    const elapsed = obterElapsedRealtimeMs();
    // elapsed menor que o da âncora = o aparelho reiniciou desde então,
    // âncora inválida.
    if (elapsed != null && elapsed >= ancora.elapsedRealtimeMs) {
      return ancora.horaServidorMs + (elapsed - ancora.elapsedRealtimeMs);
    }
  }
  return Date.now() + desvioMs;
}
