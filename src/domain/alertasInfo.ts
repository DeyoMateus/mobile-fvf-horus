import type { AlertaJornada } from "../api/alertas";

/**
 * Rótulo curto e orientação ("o que fazer") por tipo de alerta ,
 * espelha `TipoAlertaJornada` do backend (schema.prisma). Usado na
 * aba "Alertas" do app do motorista: a lista mostra o rótulo/mensagem,
 * e o modal de detalhe (ao tocar) mostra a orientação completa.
 */
export const ROTULO_TIPO_ALERTA: Record<string, string> = {
  DIRECAO_CONTINUA_PROXIMA_LIMITE: "Direção contínua perto do limite",
  DIRECAO_CONTINUA_EXCEDIDA: "Direção contínua excedida",
  DIRECAO_RETOMADA_SEM_PAUSA: "Direção retomada sem pausa de 30 min",
  JORNADA_DIRECAO_PROXIMA_LIMITE: "Jornada de direção perto do limite",
  JORNADA_DIRECAO_EXCEDIDA: "Jornada de direção excedida",
  ESPERA_PROXIMA_LIMITE: "Espera em carga/descarga perto do limite",
  ESPERA_LIMITE_LEGAL_ATINGIDO: "Espera atingiu o limite legal",
  OCIOSIDADE_DIRECAO_SUSPEITA: "Deslocamento suspeito em direção",
  VELOCIDADE_IMPOSSIVEL_ENTRE_REGISTROS:
    "Velocidade impossível entre registros",
  RELOGIO_DISPOSITIVO_SUSPEITO: "Relógio do aparelho suspeito",
  SEQUENCIA_JORNADA_MUITO_RAPIDA: "Sequência de eventos rápida demais",
  ODOMETRO_REGRESSIVO: "Odômetro regressivo",
  INTEGRIDADE_DISPOSITIVO_SUSPEITA: "Aparelho com integridade suspeita",
  PONTO_REGISTRADO_EM_DIA_DE_FOLGA: "Ponto registrado em dia de folga",
  ENTREGA_FORA_DA_CERCA_VIRTUAL: "Entrega fora da cerca virtual",
  TEMPO_INDEFINIDO_PROXIMO_LIMITE: "Tempo indefinido (sem etapa escolhida)",
  TEMPO_INDEFINIDO_PROLONGADO:
    "Tempo indefinido prolongado (sem etapa escolhida)",
  DESCANSO_INTERJORNADA_INSUFICIENTE:
    "Descanso entre jornadas abaixo do mínimo legal",
  CTE_EM_ABERTO_SEM_VINCULO_RECENTE:
    "CT-e em aberto sem vínculo recente de direção",
  SINCRONIZACAO_TARDIA_SUSPEITA: "Evento sincronizado com atraso suspeito",
};

export const ORIENTACAO_TIPO_ALERTA: Record<string, string> = {
  DIRECAO_CONTINUA_PROXIMA_LIMITE:
    "Você está perto de completar 5h30 de direção contínua sem uma pausa qualificada. Assim que possível, pare com segurança e faça um descanso de pelo menos 30 minutos.",
  DIRECAO_CONTINUA_EXCEDIDA:
    "Você já ultrapassou o limite legal de 5h30 de direção contínua sem pausa. Pare com segurança agora e faça um descanso de pelo menos 30 minutos antes de continuar dirigindo.",
  DIRECAO_RETOMADA_SEM_PAUSA:
    "Você retomou a direção depois de 5h30 contínuas sem a pausa de 30 minutos. Isso é perigoso e foi comunicado ao gestor e à equipe de Gerenciamento de Risco. Pare com segurança e descanse pelo menos 30 minutos.",
  JORNADA_DIRECAO_PROXIMA_LIMITE:
    "Você está perto do limite diário de 8h de direção. Planeje encerrar a jornada de direção em breve, dentro do limite legal.",
  JORNADA_DIRECAO_EXCEDIDA:
    "Você já ultrapassou o limite diário de direção (8h regulares + 2h extras = 10h). Encerre a direção assim que possível e registre o fim da jornada.",
  ESPERA_PROXIMA_LIMITE:
    "O tempo de espera em carga/descarga está se aproximando do limiar legal de 5h. Guarde os detalhes da espera (local, motivo) para eventual cobrança.",
  ESPERA_LIMITE_LEGAL_ATINGIDO:
    "O tempo de espera em carga/descarga atingiu o limiar legal de 5h. Isso já habilita cobrança ao contratante do frete (dossiê de cobrança) , avise seu gestor.",
  OCIOSIDADE_DIRECAO_SUSPEITA:
    'O sistema notou pouco deslocamento de GPS entre duas conferências marcadas como "em direção". Se isso é um engano (ex.: motor ligado parado), não se preocupe , é só um alerta de conferência para o gestor.',
  VELOCIDADE_IMPOSSIVEL_ENTRE_REGISTROS:
    "A distância e o tempo entre dois registros implicam uma velocidade impossível para um caminhão. Se você acha que isso é um engano, entre em contato com seu gestor para explicar o ocorrido.",
  RELOGIO_DISPOSITIVO_SUSPEITO:
    "O relógio do seu aparelho está registrando um horário à frente do horário real. Verifique a data/hora do celular nas configurações do aparelho e corrija se necessário.",
  SEQUENCIA_JORNADA_MUITO_RAPIDA:
    "Um trecho da sua jornada durou um tempo real implausivelmente curto. Se os eventos foram batidos corretamente, avise seu gestor para conferência.",
  ODOMETRO_REGRESSIVO:
    "O odômetro informado é menor que o último registrado. Confira o valor digitado da próxima vez , se o veículo foi trocado, informe seu gestor.",
  INTEGRIDADE_DISPOSITIVO_SUSPEITA:
    "O app detectou sinais de que o aparelho pode estar com a integridade comprometida (root/jailbreak ou similar). Isso não bloqueia o registro, mas fica visível para o gestor.",
  PONTO_REGISTRADO_EM_DIA_DE_FOLGA:
    "Existe um ponto registrado num dia em que também consta folga concedida. O registro de ponto nunca é apagado , isso é só um aviso para conferência humana. Fale com seu gestor se precisar esclarecer.",
  ENTREGA_FORA_DA_CERCA_VIRTUAL:
    'O local onde você registrou "Fim de descarregamento" ficou a mais de 500m do endereço do destinatário do CT-e. Se a entrega foi mesmo nesse lugar, não se preocupe , é só um aviso para o gestor conferir.',
  TEMPO_INDEFINIDO_PROXIMO_LIMITE:
    'A jornada está aberta, mas nenhuma etapa foi escolhida (direção, descanso ou espera) , esse tempo está contando como "tempo indefinido", separado das horas trabalhadas. Abra o app e escolha a próxima etapa.',
  TEMPO_INDEFINIDO_PROLONGADO:
    'A jornada está aberta há bastante tempo sem nenhuma etapa escolhida , esse tempo continua contando como "tempo indefinido", não como direção/descanso/espera. Abra o app agora e escolha a próxima etapa, ou encerre a jornada se já tiver terminado o dia.',
  DESCANSO_INTERJORNADA_INSUFICIENTE:
    "Você iniciou esta jornada com menos do que o descanso mínimo legal de 11h desde o fim da jornada anterior (que já tinha completado sua jornada legal de direção). A lei não impede o registro, mas esse alerta fica registrado para o gestor , se possível, avise-o do motivo (ex.: entrega urgente, imprevisto). Esse alerta não aparece quando a jornada anterior ainda estava incompleta (ex.: você encerrou por engano e reabriu) , nesse caso a nova jornada conta como complemento da anterior.",
  CTE_EM_ABERTO_SEM_VINCULO_RECENTE:
    'Você iniciou direção sem nenhum CT-e vinculado recentemente, e ainda existe um CT-e em aberto no sistema (sem "Fim de descarregamento" registrado). Se você já entregou essa carga, avise seu gestor pra dar baixa; se está rodando vazio mesmo, não precisa fazer nada.',
  SINCRONIZACAO_TARDIA_SUSPEITA:
    "Este evento chegou ao servidor bem depois do horário que ele alega ter acontecido , normal se você ficou muito tempo sem sinal, mas fica registrado para conferência do gestor. Se você não mexeu na data/hora do aparelho, não precisa fazer nada.",
};

export function rotuloAlerta(alerta: Pick<AlertaJornada, "tipo">): string {
  return ROTULO_TIPO_ALERTA[alerta.tipo] ?? alerta.tipo;
}

export function orientacaoAlerta(alerta: Pick<AlertaJornada, "tipo">): string {
  return (
    ORIENTACAO_TIPO_ALERTA[alerta.tipo] ??
    "Sem orientação específica cadastrada para este tipo de alerta , em caso de dúvida, fale com seu gestor."
  );
}
