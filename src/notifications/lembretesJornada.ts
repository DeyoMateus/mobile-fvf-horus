import { Platform } from "react-native";
import { estaEmTempoIndefinido } from "../domain/regrasJornada";
import {
  ultimoRegistroRelevante,
  ultimoTipoEventoRelevanteRegistrado,
} from "../storage/db";
import { rodandoNoExpoGo } from "../utils/ambiente";
import { agoraConfiavel } from "../utils/relogioConfiavel";

type NotificationsModulo = typeof import("expo-notifications");

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
  { id: "tempo-indefinido-15", minutos: 15, critico: false },
  { id: "tempo-indefinido-30", minutos: 30, critico: true },
] as const;

export async function sincronizarLembretesDeJornada(): Promise<void> {
  if (rodandoNoExpoGo()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications: NotificationsModulo = require("expo-notifications");

    for (const l of LIMIARES) {
      await Notifications.cancelScheduledNotificationAsync(l.id).catch(
        () => undefined,
      );
    }

    const tipo = ultimoTipoEventoRelevanteRegistrado();
    const ultimo = ultimoRegistroRelevante();
    if (!ultimo || !estaEmTempoIndefinido(tipo)) return;

    const permissao = await Notifications.getPermissionsAsync();
    if (permissao.status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("alertas-jornada", {
        name: "Alertas de jornada",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const decorridoMs =
      agoraConfiavel() - new Date(ultimo.timestampEvento).getTime();
    for (const l of LIMIARES) {
      const faltaS = Math.ceil((l.minutos * 60_000 - decorridoMs) / 1000);
      if (faltaS < 5) continue; // esse limiar já passou
      await Notifications.scheduleNotificationAsync({
        identifier: l.id,
        content: {
          title: "Alerta de jornada",
          body: l.critico
            ? `Sua jornada está aberta há ${l.minutos} minutos sem nenhuma etapa escolhida. Esse tempo conta como indefinido. Abra o app e escolha uma ação.`
            : `Você está há ${l.minutos} minutos sem escolher a próxima etapa (direção, descanso ou espera). Abra o app e escolha uma ação.`,
          data: { tipo: "TEMPO_INDEFINIDO_LOCAL" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: faltaS,
          channelId: "alertas-jornada",
        },
      });
    }
  } catch {
    // Best-effort: lembrete é um extra, nunca atrapalha bater ponto.
  }
}
