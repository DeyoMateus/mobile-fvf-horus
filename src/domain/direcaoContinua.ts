/**
 * Rodada 151 , direção contínua no aparelho (espelha o motor do
 * servidor, `calcularAcumuladosDirecao`): soma os trechos de direção
 * da jornada atual DEPOIS da última pausa qualificada (descanso >= 30
 * min). Usado para agendar os avisos locais de 4h30/5h/5h30.
 */
export const PAUSA_QUALIFICADA_MIN = 30;
export const DIRECAO_CONTINUA_PREVIO_MIN = 270; // 4h30 , pré-aviso
export const DIRECAO_CONTINUA_ATENCAO_MIN = 300; // 5h
export const DIRECAO_CONTINUA_CRITICO_MIN = 330; // 5h30

export interface EventoSimples {
  tipoEvento: string;
  timestampEvento: string;
}

/**
 * Se o motorista está dirigindo agora (último evento = INICIO_DIRECAO),
 * devolve quantos minutos de direção contínua já havia somado ATÉ o
 * início do trecho atual e o instante (ms) em que o trecho atual
 * começou. Se não está dirigindo, devolve null.
 */
export function direcaoContinuaEmCurso(
  eventosEmOrdemDeToque: EventoSimples[],
): { minutosAntes: number; inicioTrechoMs: number } | null {
  if (eventosEmOrdemDeToque.length === 0) return null;
  const ult = eventosEmOrdemDeToque[eventosEmOrdemDeToque.length - 1];
  if (ult.tipoEvento !== "INICIO_DIRECAO") return null;

  let corteMs = -Infinity;
  let inicioDirecao: number | null = null;
  let inicioDescanso: number | null = null;
  let fimJornada: number | null = null;
  let acumuladoMs = 0;

  const eventos = eventosEmOrdemDeToque.slice(0, -1);
  for (const e of eventos) {
    const t = new Date(e.timestampEvento).getTime();
    if (Number.isNaN(t)) continue;
    if (e.tipoEvento === "INICIO_DIRECAO") {
      inicioDirecao = t;
    } else if (e.tipoEvento === "INICIO_JORNADA") {
      // Rodada 182: intervalo entre jornadas encadeadas de 30 min ou mais
      // conta como pausa; menos que isso não zera.
      if (
        fimJornada !== null &&
        t - fimJornada >= PAUSA_QUALIFICADA_MIN * 60_000
      ) {
        corteMs = t;
        acumuladoMs = 0;
      }
      fimJornada = null;
    } else if (e.tipoEvento === "FIM_DIRECAO" || e.tipoEvento === "FIM_JORNADA") {
      if (e.tipoEvento === "FIM_JORNADA") fimJornada = t;
      if (inicioDirecao !== null && t > inicioDirecao) {
        acumuladoMs += t - Math.max(inicioDirecao, corteMs);
      }
      inicioDirecao = null;
    } else if (e.tipoEvento === "INICIO_DESCANSO") {
      inicioDescanso = t;
    } else if (e.tipoEvento === "FIM_DESCANSO") {
      if (
        inicioDescanso !== null &&
        t - inicioDescanso >= PAUSA_QUALIFICADA_MIN * 60_000
      ) {
        corteMs = t;
        acumuladoMs = 0;
      }
      inicioDescanso = null;
    }
  }
  return {
    minutosAntes: Math.max(0, acumuladoMs / 60_000),
    inicioTrechoMs: new Date(ult.timestampEvento).getTime(),
  };
}

/**
 * O alerta de direção contínua (aviso de 5h / excedido de 5h30) ainda
 * descreve a situação REAL do motorista agora? Não, quando o aviso chegou
 * atrasado ao aparelho (app fechado/sem sinal) e o motorista já fez uma
 * pausa qualificada (descanso de 30 min ou mais) ou já parou de dirigir:
 * a contagem recomeçou do zero e a tela vermelha só confundiria.
 */
export function alertaDirecaoContinuaAindaVale(
  tipo: string,
  eventosEmOrdemDeToque: EventoSimples[],
  agoraMs: number,
): boolean {
  const emCurso = direcaoContinuaEmCurso(eventosEmOrdemDeToque);
  if (!emCurso) return false;
  const acumuladoMin =
    emCurso.minutosAntes +
    Math.max(0, agoraMs - emCurso.inicioTrechoMs) / 60_000;
  const limite =
    tipo === "DIRECAO_CONTINUA_EXCEDIDA"
      ? DIRECAO_CONTINUA_CRITICO_MIN
      : DIRECAO_CONTINUA_ATENCAO_MIN;
  return acumuladoMin >= limite - 2; // 2 min de tolerância (relógio/arredondamento)
}
