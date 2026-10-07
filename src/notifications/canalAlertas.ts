import { Platform } from "react-native";

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
