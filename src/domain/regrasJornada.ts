import type { TipoEvento } from "../types";

/**
 * Máquina de estados dos botões de "Registrar ponto" , em vez de
 * mostrar os 8 tipos de evento de uma vez (fácil de bater o errado, ex.
 * "Início de direção" duas vezes seguidas sem nunca fechar), só mostra
 * os próximos passos que fazem sentido depois do último evento
 * relevante batido neste aparelho. Efeito cascata: cada toque revela só
 * a próxima etapa válida.
 *
 * Rodada 63 , pedido do usuário: "OUTRO" (rotulado "Aguardando
 * documentação" na tela) deixou de ser uma anotação livre, fora da
 * máquina de estados, e passou a ser um status de verdade: iniciar
 * qualquer outra ação (início de direção, início de descanso, início
 * de espera, ou até fechar a jornada) depois dele conta como o "fim"
 * implícito do período de espera por documentação , não existe (nem
 * precisa existir) um botão de "fim de aguardando documentação"
 * separado. Por isso "OUTRO" agora entra nas mesmas listas de "próximo
 * passo" que qualquer outro estado FECHADO (nunca aparece como opção
 * enquanto direção/descanso/espera estiverem em aberto , só se pode
 * fechar o que está aberto, igual a tudo mais aqui), e o cronômetro da
 * tela passa a contar "desde aguardando documentação" enquanto for o
 * último evento relevante.
 */
const PROXIMOS_POR_ULTIMO: Record<TipoEvento, TipoEvento[]> = {
  INICIO_JORNADA: [
    "INICIO_DIRECAO",
    "INICIO_DESCANSO",
    "ESPERA_CARGA_DESCARGA",
    "OUTRO",
    "FIM_JORNADA",
  ],
  FIM_DIRECAO: [
    "INICIO_DIRECAO",
    "INICIO_DESCANSO",
    "ESPERA_CARGA_DESCARGA",
    "OUTRO",
    "FIM_JORNADA",
  ],
  FIM_DESCANSO: [
    "INICIO_DIRECAO",
    "INICIO_DESCANSO",
    "ESPERA_CARGA_DESCARGA",
    "OUTRO",
    "FIM_JORNADA",
  ],
  FIM_ESPERA_CARGA_DESCARGA: [
    "INICIO_DIRECAO",
    "INICIO_DESCANSO",
    "ESPERA_CARGA_DESCARGA",
    "OUTRO",
    "FIM_JORNADA",
  ],
  // "Fim de descarregamento" fecha a espera igual "Fim de espera
  // (carga/descarga)" (mesmo estado legal depois), mas sinaliza uma
  // entrega concluída , desvincula automaticamente o CT-e mais antigo
  // em aberto deste motorista (ver backend avaliarDescarregamento).
  FIM_DESCARREGAMENTO: [
    "INICIO_DIRECAO",
    "INICIO_DESCANSO",
    "ESPERA_CARGA_DESCARGA",
    "OUTRO",
    "FIM_JORNADA",
  ],
  // Estados "abertos": só dá pra fechar o que está aberto, nada mais ,
  // não faz sentido iniciar descanso no meio de uma direção em curso,
  // por exemplo, nem encerrar a jornada sem fechar o que ficou pendente.
  // "Aguardando documentação" (OUTRO) também não aparece aqui , o mesmo
  // motivo: não faz sentido marcar "aguardando documentação" no meio de
  // uma direção/descanso/espera já em curso.
  INICIO_DIRECAO: ["FIM_DIRECAO"],
  INICIO_DESCANSO: ["FIM_DESCANSO"],
  // Ao fechar a espera, o motorista escolhe entre o fim genérico ou,
  // se essa espera terminou numa entrega de verdade, "Fim de
  // descarregamento" , que além de fechar a espera desvincula o CT-e.
  ESPERA_CARGA_DESCARGA: ["FIM_ESPERA_CARGA_DESCARGA", "FIM_DESCARREGAMENTO"],
  FIM_JORNADA: ["INICIO_JORNADA"],
  // "Aguardando documentação" (OUTRO) é, na prática, mais um estado
  // fechado , dali, os mesmos próximos passos de sempre valem, e
  // qualquer um deles marca o fim implícito da espera por documentação.
  OUTRO: [
    "INICIO_DIRECAO",
    "INICIO_DESCANSO",
    "ESPERA_CARGA_DESCARGA",
    "FIM_JORNADA",
  ],
};

/**
 * @param ultimoEventoRelevante o último tipo de evento batido neste
 *   aparelho (ou `null` se nunca bateu nenhum ponto, ou se o último foi
 *   justamente "Fim de jornada" , os dois casos levam ao mesmo lugar:
 *   só pode iniciar uma jornada nova).
 */
export function proximosEventosPermitidos(
  ultimoEventoRelevante: TipoEvento | null,
): TipoEvento[] {
  if (ultimoEventoRelevante === null) return ["INICIO_JORNADA"];
  return PROXIMOS_POR_ULTIMO[ultimoEventoRelevante];
}

/**
 * Rodada 68 , pedido do usuário: o tempo entre "Início de jornada" (ou
 * o fim de qualquer etapa) e a escolha da próxima ação NÃO é tempo
 * trabalhado em nenhuma categoria (não é direção, não é descanso, não
 * é espera) , é "tempo indefinido", e precisa aparecer separado na
 * tela, não só somar silenciosamente ao cronômetro de uma próxima
 * etapa. Espelha EVENTOS_ABERTURA_TEMPO_INDEFINIDO do backend
 * (JornadaLegalService) , mesma lista, mesmo motivo.
 *
 * "OUTRO" (aguardando documentação) fica de fora de propósito: é uma
 * etapa com nome e orientação próprios que o motorista escolheu, não
 * uma omissão.
 */
const EVENTOS_ABERTURA_TEMPO_INDEFINIDO = new Set<TipoEvento>([
  "INICIO_JORNADA",
  "FIM_DIRECAO",
  "FIM_DESCANSO",
  "FIM_ESPERA_CARGA_DESCARGA",
  "FIM_DESCARREGAMENTO",
]);

export function estaEmTempoIndefinido(
  ultimoEventoRelevante: TipoEvento | null,
): boolean {
  return (
    ultimoEventoRelevante !== null &&
    EVENTOS_ABERTURA_TEMPO_INDEFINIDO.has(ultimoEventoRelevante)
  );
}

/**
 * Rodada 69 , pedido do usuário: o cronômetro (número contando) da tela
 * de registro de ponto só pode aparecer nos estados que realmente
 * guardam duração no banco de dados , direção, descanso, espera e
 * "aguardando documentação" (OUTRO). "Início de jornada" e qualquer
 * "tempo indefinido" (ver EVENTOS_ABERTURA_TEMPO_INDEFINIDO acima) não
 * contam nada em lugar nenhum, então não podem parecer que estão
 * contando , só o aviso pra escolher uma ação aparece nesses casos.
 */
const EVENTOS_COM_CRONOMETRO = new Set<TipoEvento>([
  "INICIO_DIRECAO",
  "INICIO_DESCANSO",
  "ESPERA_CARGA_DESCARGA",
  "OUTRO",
]);

export function estaEmEstadoComCronometro(
  ultimoEventoRelevante: TipoEvento | null,
): boolean {
  return (
    ultimoEventoRelevante !== null &&
    EVENTOS_COM_CRONOMETRO.has(ultimoEventoRelevante)
  );
}

/**
 * Rodada 71 , pedido do usuário: "a lei prevê não deve impedir o
 * motorista de registrar o ponto... mas o gestor deve ser
 * notificado... assim como o motorista... deve aparecer uma tela
 * explicando o que isso significa". Mesmo valor usado no backend
 * (JornadaLegalService.avaliarDescansoInterjornada e
 * RepPService.DESCANSO_INTERJORNADA_MINIMO_MIN) , mantido em sincronia
 * de propósito (comentado nos dois lados), não importado de lá porque
 * mobile e backend não compartilham módulos.
 */
export const DESCANSO_INTERJORNADA_MINIMO_MIN = 660; // 11h (CLT art. 66 / Lei 13.103)

/**
 * Rodada 134 , mesmo valor de JornadaLegalService.LIMITE_JORNADA_DIRECAO_ATENCAO_MIN
 * no backend (8h de direção = jornada "completa" por lei, podendo
 * chegar a 10h com hora extra) , mantido em sincronia de propósito,
 * mesmo raciocínio do comentário acima sobre DESCANSO_INTERJORNADA_MINIMO_MIN.
 * Usado pra decidir se a jornada anterior já terminou "de verdade" antes
 * de mostrar o aviso de descanso interjornada insuficiente.
 */
export const LIMITE_JORNADA_DIRECAO_ATENCAO_MIN = 480; // 8h

/**
 * Minutos que ainda faltam pro motorista completar o descanso mínimo
 * legal de 11h desde o fim da jornada anterior , `null` quando já
 * cumpriu (ou passou) esse mínimo. Usado na tela de registro de ponto
 * pra decidir se mostra o aviso antes de aceitar um novo "Início de
 * jornada".
 */
export function minutosFaltantesDescansoInterjornada(
  timestampFimJornadaAnterior: string,
  agoraMs: number = Date.now(),
): number | null {
  const descansoMin =
    (agoraMs - new Date(timestampFimJornadaAnterior).getTime()) / 60000;
  if (descansoMin >= DESCANSO_INTERJORNADA_MINIMO_MIN) return null;
  return Math.round(DESCANSO_INTERJORNADA_MINIMO_MIN - descansoMin);
}

/** "270" -> "04:30" , mesmo formato usado nas mensagens de alerta do backend (JornadaLegalService.formatarHoras). */
export function formatarHorasMin(minutos: number): string {
  const totalMin = Math.max(0, Math.round(minutos));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
