import {
  agendarAlertaLocal,
  cancelarAlertaLocal,
} from "./alertaTelaCheia";
import { estaEmTempoIndefinido } from "../domain/regrasJornada";
import {
  direcaoContinuaEmCurso,
  DIRECAO_CONTINUA_ATENCAO_MIN,
  DIRECAO_CONTINUA_CRITICO_MIN,
  DIRECAO_CONTINUA_PREVIO_MIN,
} from "../domain/direcaoContinua";
import {
  listarEventosDaJornadaAtual,
  ultimoRegistroRelevante,
  ultimoTipoEventoRelevanteRegistrado,
} from "../storage/db";
import { rodandoNoExpoGo } from "../utils/ambiente";
import { agoraConfiavel } from "../utils/relogioConfiavel";


/**
 * Rodada 142 , o aviso de "jornada aberta sem escolher a próxima
 * etapa" chegava só pro gestor (o servidor manda push, mas o push
 * remoto depende de credencial FCM ainda não configurada, e fica
 * restrito a quando o app tem sinal). Aqui o PRÓPRIO aparelho agenda
 * notificações LOCAIS , funcionam em segundo plano, sem internet e sem
 * FCM , pros mesmos limiares do servidor (15 min = atenção, 30 min =
 * crítico). Sempre reflete o estado atual: ao escolher a próxima
 * etapa os lembretes pendentes são cancelados.
 */
const LIMIARES = [
  { id: "tempo-indefinido-15", minutos: 15, critico: false, som: "indefinido_15" },
  { id: "tempo-indefinido-30", minutos: 30, critico: true, som: "indefinido_30" },
] as const;

/**
 * Rodada 151 , avisos LOCAIS de direção contínua (4h30, 5h, 5h30):
 * funcionam com o app fechado e sem internet. Canal novo (o Android não
 * deixa mudar som/vibração de um canal já criado) com som e vibração
 * longa.
 */
const CANAL_DIRECAO = "direcao-continua-v2";
const AVISOS_DIRECAO = [
  {
    som: "direcao_270",
    id: "direcao-continua-270",
    minutos: DIRECAO_CONTINUA_PREVIO_MIN,
    titulo: "Atenção: 4h30 de direção",
    corpo:
      "Você está há 4h30 dirigindo sem pausa. Em 30 minutos chega a 5h, planeje uma parada para descanso de 30 minutos.",
  },
  {
    som: "direcao_300",
    id: "direcao-continua-300",
    minutos: DIRECAO_CONTINUA_ATENCAO_MIN,
    titulo: "Atenção: 5h de direção contínua",
    corpo:
      "Você completou 5h de direção sem pausa. O limite legal é 5h30. Pare em local seguro e registre o descanso.",
  },
  {
    som: "direcao_330",
    id: "direcao-continua-330",
    minutos: DIRECAO_CONTINUA_CRITICO_MIN,
    titulo: "LIMITE LEGAL: 5h30 de direção",
    corpo:
      "Você atingiu 5h30 de direção contínua. Pare agora em local seguro e registre o descanso de 30 minutos.",
  },
] as const;

// Rodada 176: retomada de direção com 5h30 (ou mais) já acumuladas e sem
// pausa de 30 min. Os avisos acima só agendam limiares FUTUROS, então
// nesse caso nada tocava. Aqui: um aviso vermelho logo após a retomada e
// repetições a cada 30 min enquanto continuar sem a pausa.
const IDS_RETOMADA = [0, 1, 2, 3, 4].map((k) => `direcao-retomada-${k}`);

async function sincronizarAvisosDeDirecao(): Promise<void> {
  for (const a of AVISOS_DIRECAO) {
    await cancelarAlertaLocal(a.id);
  }
  const emCurso = direcaoContinuaEmCurso(listarEventosDaJornadaAtual());
  if (!emCurso) {
    for (const id of IDS_RETOMADA) await cancelarAlertaLocal(id);
    return;
  }

  const agora = agoraConfiavel();
  if (emCurso.minutosAntes >= DIRECAO_CONTINUA_CRITICO_MIN) {
    // Já estourou antes de retomar: não agenda os limiares normais.
    for (let k = 0; k < IDS_RETOMADA.length; k++) {
      const quando =
        emCurso.inicioTrechoMs + (k === 0 ? 10_000 : k * 30 * 60_000);
      if (quando - agora <= 2000) continue; // já passou (já tocou)
      await agendarAlertaLocal({
        id: IDS_RETOMADA[k],
        titulo: "Direção sem pausa de 30 minutos",
        corpo:
          "Você retomou a direção depois de 5h30 contínuas sem descansar 30 minutos. Pare agora em local seguro e descanse. A GR foi avisada.",
        quandoMs: quando,
        telaCheia: true,
        som: "direcao_330",
      });
    }
    return;
  }
  for (const id of IDS_RETOMADA) await cancelarAlertaLocal(id);

  const decorridoMin = Math.max(0, (agora - emCurso.inicioTrechoMs) / 60_000);
  for (const a of AVISOS_DIRECAO) {
    const faltaMin = a.minutos - (emCurso.minutosAntes + decorridoMin);
    const faltaS = Math.ceil(faltaMin * 60);
    if (faltaS < 5) continue; // já passou
    await agendarAlertaLocal({
      id: a.id,
      titulo: a.titulo,
      corpo: a.corpo,
      quandoMs: agora + faltaS * 1000,
      // 5h e 5h30 abrem a tela cheia; 4h30 é só um aviso forte.
      telaCheia: a.minutos >= DIRECAO_CONTINUA_ATENCAO_MIN,
      som: a.som,
    });
  }
}

export async function sincronizarLembretesDeJornada(): Promise<void> {
  if (rodandoNoExpoGo()) return;
  try {
    await sincronizarAvisosDeDirecao().catch(() => undefined);

    for (const l of LIMIARES) {
      await cancelarAlertaLocal(l.id);
    }

    const tipo = ultimoTipoEventoRelevanteRegistrado();
    const ultimo = ultimoRegistroRelevante();
    if (!ultimo || !estaEmTempoIndefinido(tipo)) return;

    const agora = agoraConfiavel();
    const decorridoMs = agora - new Date(ultimo.timestampEvento).getTime();
    for (const l of LIMIARES) {
      const faltaS = Math.ceil((l.minutos * 60_000 - decorridoMs) / 1000);
      if (faltaS < 5) continue; // esse limiar já passou
      await agendarAlertaLocal({
        id: l.id,
        titulo: "Alerta de jornada",
        corpo: l.critico
          ? `Sua jornada está aberta há ${l.minutos} minutos sem nenhuma etapa escolhida. Esse tempo conta como indefinido. Abra o app e escolha uma ação.`
          : `Você está há ${l.minutos} minutos sem escolher a próxima etapa (direção, descanso ou espera). Abra o app e escolha uma ação.`,
        quandoMs: agora + faltaS * 1000,
        telaCheia: l.critico,
        som: l.som,
      });
    }
  } catch {
    // Best-effort: lembrete é um extra, nunca atrapalha bater ponto.
  }
}
