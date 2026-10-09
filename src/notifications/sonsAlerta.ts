/**
 * Avisos FALADOS (voz gerada no ElevenLabs, mp3 dentro do app em
 * res/raw , funcionam sem internet). Cada frase tem um canal de
 * notificação próprio, porque no Android o som é do canal e não muda
 * depois de criado. Ver assets/sons/frases.json e
 * scripts/gerar-audios-alertas.js.
 */
export type SomAlerta =
  | "direcao_270"
  | "direcao_300"
  | "direcao_330"
  | "indefinido_15"
  | "indefinido_30"
  | "jornada_proxima"
  | "jornada_excedida"
  | "espera_proxima"
  | "espera_limite"
  | "generico";

export const TODOS_OS_SONS: SomAlerta[] = [
  "direcao_270",
  "direcao_300",
  "direcao_330",
  "indefinido_15",
  "indefinido_30",
  "jornada_proxima",
  "jornada_excedida",
  "espera_proxima",
  "espera_limite",
  "generico",
];

export function canalDoSom(som: SomAlerta): string {
  return `alerta-voz-${som}-v2`;
}

/** Nome do recurso em res/raw (sem extensão). */
export function recursoDoSom(som: SomAlerta): string {
  return `alerta_${som}`;
}

/** Qual frase falada combina com o tipo de alerta vindo do servidor. */
export function somDoTipoDeAlerta(tipo: string): SomAlerta {
  switch (tipo) {
    case "DIRECAO_CONTINUA_PROXIMA_LIMITE":
      return "direcao_300";
    case "DIRECAO_CONTINUA_EXCEDIDA":
    case "DIRECAO_RETOMADA_SEM_PAUSA":
      return "direcao_330";
    case "JORNADA_DIRECAO_PROXIMA_LIMITE":
      return "jornada_proxima";
    case "JORNADA_DIRECAO_EXCEDIDA":
      return "jornada_excedida";
    case "ESPERA_PROXIMA_LIMITE":
      return "espera_proxima";
    case "ESPERA_LIMITE_LEGAL_ATINGIDO":
      return "espera_limite";
    case "TEMPO_INDEFINIDO_PROXIMO_LIMITE":
      return "indefinido_15";
    case "TEMPO_INDEFINIDO_PROLONGADO":
      return "indefinido_30";
    default:
      return "generico";
  }
}
