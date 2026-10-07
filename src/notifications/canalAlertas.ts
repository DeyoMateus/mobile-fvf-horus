import { Platform } from "react-native";
import { rodandoNoExpoGo } from "../utils/ambiente";

/**
 * Canal Android dos alertas de jornada. O Android NÃO deixa o app mudar
 * som/vibração/importância de um canal que já foi criado, então o canal
 * antigo ("alertas-jornada", criado só com importância HIGH e sem som nem
 * vibração definidos) ficou preso. Este é um canal NOVO (v2), importância
 * máxima, com som, vibração e visível na tela de bloqueio. O backend manda o
 * mesmo id em `channelId` (push-notifications.processor.ts).
 */
export const CANAL_ALERTAS = "alertas-jornada-v2";

type NotificationsModulo = typeof import("expo-notifications");

export async function garantirCanalAlertas(
  Notifications: NotificationsModulo,
): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CANAL_ALERTAS, {
    name: "Alertas de jornada",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    enableVibrate: true,
    vibrationPattern: [0, 700, 300, 700, 300, 700],
    enableLights: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
}

/**
 * Toca o SOM e a VIBRAÇÃO do sistema (canal v2: importância máxima, som
 * padrão do telefone) quando a tela vermelha de alerta abre com o app em
 * primeiro plano. `Vibration.vibrate` sozinho não é confiável (alguns
 * aparelhos bloqueiam vibração "sem tipo" no modo silencioso) e não há
 * som; uma notificação local imediata no canal v2 usa os ajustes do
 * próprio sistema. Devolve uma função que remove essa notificação.
 */
export async function tocarSomDoAlertaAgora(
  titulo: string,
  corpo: string,
): Promise<() => void> {
  if (Platform.OS !== "android" || rodandoNoExpoGo()) return () => {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications: NotificationsModulo = require("expo-notifications");
    await garantirCanalAlertas(Notifications);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: titulo,
        body: corpo,
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 700, 300, 700, 300, 700],
      },
      trigger: { channelId: CANAL_ALERTAS },
    });
    return () => {
      void Notifications.dismissNotificationAsync(id).catch(() => {});
    };
  } catch {
    return () => {};
  }
}
