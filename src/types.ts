// Espelha o enum TipoEvento do backend (prisma/schema.prisma). Mantenha
// sincronizado manualmente , se o backend ganhar um evento novo, adicione
// aqui também.
export type TipoEvento =
  | "INICIO_JORNADA"
  | "INICIO_DESCANSO"
  | "FIM_DESCANSO"
  | "INICIO_DIRECAO"
  | "FIM_DIRECAO"
  | "ESPERA_CARGA_DESCARGA"
  | "FIM_ESPERA_CARGA_DESCARGA"
  | "FIM_DESCARREGAMENTO"
  | "FIM_JORNADA"
  | "OUTRO";

export const TIPOS_EVENTO: { tipo: TipoEvento; rotulo: string }[] = [
  { tipo: "INICIO_JORNADA", rotulo: "Início da jornada" },
  { tipo: "INICIO_DIRECAO", rotulo: "Início de direção" },
  { tipo: "FIM_DIRECAO", rotulo: "Fim de direção" },
  { tipo: "INICIO_DESCANSO", rotulo: "Início de descanso" },
  { tipo: "FIM_DESCANSO", rotulo: "Fim de descanso" },
  {
    tipo: "ESPERA_CARGA_DESCARGA",
    rotulo: "Início de espera (carga/descarga)",
  },
  {
    tipo: "FIM_ESPERA_CARGA_DESCARGA",
    rotulo: "Fim de carregamento (carregamento concluído)",
  },
  {
    tipo: "FIM_DESCARREGAMENTO",
    rotulo: "Fim de descarregamento (entrega concluída)",
  },
  { tipo: "OUTRO", rotulo: "Aguardando documentação" },
  { tipo: "FIM_JORNADA", rotulo: "Fim da jornada" },
];

export interface CredenciaisDispositivo {
  motoristaId: string;
  deviceUuid: string;
  deviceApiKey: string;
}

export type StatusSincronizacao = "PENDENTE" | "ENVIADO" | "ERRO";

export interface RegistroLocal {
  idLocal: string; // = idempotencyKey enviado ao backend
  tipoEvento: TipoEvento;
  timestampEvento: string; // ISO 8601, capturado no momento do toque (mesmo offline)
  latitude?: number | null;
  longitude?: number | null;
  precisaoGpsM?: number | null;
  observacao?: string | null;
  flagsIntegridadeDispositivo?: string[] | null;
  /**
   * Rodada 88 , relógio monotônico do aparelho (ms desde o último
   * boot, `utils/relogioMonotonico.ts`) capturado no momento do toque ,
   * `null` quando o módulo nativo não está disponível (Expo Go).
   */
  elapsedRealtimeMs?: number | null;
  /**
   * Rodada 146 , deslocamento do fuso do aparelho NO MOMENTO do toque, em
   * minutos a leste do UTC (Brasília = -180, Cuiabá = -240). Capturado
   * offline junto com o evento; o servidor usa para cortar o dia e a
   * janela noturna (22h–5h) pelo fuso em que o motorista estava.
   */
  fusoOffsetMin?: number | null;
  status: StatusSincronizacao;
  tentativas: number;
  ultimoErro?: string | null;
  criadoEm: string;
  enviadoEm?: string | null;
}
