import * as Device from "expo-device";
// NÃO importar expo-notifications de forma estática aqui , o próprio
// carregamento do módulo já registra um listener interno de push
// token, e é ESSE carregamento (não uma chamada nossa) que derruba o
// app no Expo Go a partir do SDK 53 (ver stack trace real: o erro sai
// de dentro do módulo, na inicialização dele). O require() abaixo, em
// cada função, só roda quando rodandoNoExpoGo() já garantiu que não
// estamos no Expo Go.
import { Platform } from "react-native";
import { API_URL, ErroApi } from "../api/client";
import { obterCredenciais } from "../storage/secureCredentials";
import { rodandoNoExpoGo } from "../utils/ambiente";
import { garantirCanalAlertas } from "./canalAlertas";
// eslint-disable-next-line @typescript-eslint/no-var-requires
type NotificationsModulo = typeof import("expo-notifications");

/**
 * Registra este aparelho para receber notificações push dos alertas
 * críticos de jornada (o motor no backend decide quando notificar ,
 * aqui só garantimos que o backend tem um token válido para chamar).
 *
 * Chamado uma vez ao abrir o app (se já vinculado) e depois do vínculo
 * ser concluído. Falha aqui (permissão negada, sem hardware físico
 * como no emulador, etc.) nunca deve impedir o uso do app , é só
 * best-effort.
 */
export async function registrarPushTokenSeNecessario(): Promise<void> {
  // Push remota via expo-notifications foi removida do Expo Go a
  // partir do SDK 53 , chamar essas APIs lá dentro derruba o app
  // (não é um erro JS "pegável", ver utils/ambiente.ts). No Expo Go
  // simplesmente não registramos push nenhuma; numa build própria
  // (dev client/produção) funciona normal.
  if (rodandoNoExpoGo()) return;

  try {
    if (!Device.isDevice) return; // emulador/simulador não recebe push de verdade

    const credenciais = await obterCredenciais();
    if (!credenciais) return; // ainda não vinculado , nada pra registrar

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications: NotificationsModulo = require("expo-notifications");

    const permissaoAtual = await Notifications.getPermissionsAsync();
    let status = permissaoAtual.status;
    if (status !== "granted") {
      const pedido = await Notifications.requestPermissionsAsync();
      status = pedido.status;
    }
    if (status !== "granted") return;

    await garantirCanalAlertas(Notifications);

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync();

    await fetch(`${API_URL}/dispositivo/meu-push-token`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
      body: JSON.stringify({ pushToken }),
    });
  } catch (err) {
    // Best-effort: nunca propaga , push é um extra, não um requisito
    // pra bater ponto.
    if (!(err instanceof ErroApi)) {
      // eslint-disable-next-line no-console
      console.warn("Falha ao registrar push token", err);
    }
  }
}

/** Configura como as notificações aparecem enquanto o app está aberto (foreground). */
export function configurarExibicaoDeNotificacoes(): void {
  // Mesmo motivo do registrarPushTokenSeNecessario acima , no Expo Go
  // isso derruba o app. Notificação em primeiro plano é dispensável
  // pra testar o fluxo principal (bater ponto); no Expo Go só não
  // configura, não é um "quebra tudo".
  if (rodandoNoExpoGo()) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications: NotificationsModulo = require("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      // Campos exigidos pelo tipo `NotificationBehavior` desde uma
      // versão mais nova do expo-notifications (SDK 53+): controlam,
      // respectivamente, se a notificação aparece como banner (topo da
      // tela) e se entra na lista/central de notificações do sistema
      // enquanto o app está em primeiro plano.
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
