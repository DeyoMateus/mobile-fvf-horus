import { Alert, Platform } from "react-native";
import { rodandoNoExpoGo } from "../utils/ambiente";

/**
 * Alerta de TELA CHEIA sobre o bloqueio (estilo ligação/alarme) para os
 * avisos locais de jornada. Usa react-native-notify-kit (fork mantido do
 * Notifee) porque o expo-notifications não suporta full-screen intent.
 *
 * - Agendamento local por AlarmManager (SET_ALARM_CLOCK): dispara no
 *   horário certo com o app FECHADO, sem internet.
 * - Com o celular bloqueado, o Android abre o app por cima do bloqueio
 *   (full-screen intent); a tela vermelha (AlertaLocalTelaCheia) lê a
 *   notificação ainda exibida e toca vibração até o motorista dar ciente.
 * - Se o Android negar a tela cheia (permissão especial) ou o aparelho
 *   estiver em uso, vira notificação normal de máxima prioridade, com
 *   som e vibração do canal.
 */
export const CANAL_TELA_CHEIA = "alerta-tela-cheia-v1";
export const MARCA_TELA_CHEIA = "1";

type Modulo = typeof import("react-native-notify-kit");

export function carregarNotifee(): Modulo | null {
  if (Platform.OS !== "android" || rodandoNoExpoGo()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-notify-kit") as Modulo;
  } catch {
    return null;
  }
}

// Exigido pela biblioteca: handler de eventos em segundo plano (mesmo vazio).
try {
  const m = carregarNotifee();
  m?.default.onBackgroundEvent(async () => undefined);
} catch {
  // best-effort
}

async function garantirCanal(m: Modulo): Promise<void> {
  await m.default.createChannel({
    id: CANAL_TELA_CHEIA,
    name: "Alertas de jornada (tela cheia)",
    importance: m.AndroidImportance.HIGH,
    sound: "default",
    vibration: true,
    vibrationPattern: [300, 800, 400, 800, 400, 800],
    visibility: m.AndroidVisibility.PUBLIC,
    bypassDnd: true,
  });
}

let avisouAlarmes = false;

/** Avisa uma vez por abertura se "Alarmes e lembretes" está desligado. */
async function conferirPermissaoDeAlarme(m: Modulo): Promise<void> {
  if (avisouAlarmes) return;
  try {
    const cfg = await m.default.getNotificationSettings();
    if (cfg.android?.alarm === m.AndroidNotificationSetting.DISABLED) {
      avisouAlarmes = true;
      Alert.alert(
        "Permitir alarmes e lembretes",
        "Para os avisos de direção tocarem na hora certa, com o app fechado, ative \"Alarmes e lembretes\" para este app.",
        [
          { text: "Agora não", style: "cancel" },
          {
            text: "Abrir configuração",
            onPress: () => void m.default.openAlarmPermissionSettings(),
          },
        ],
      );
    }
  } catch {
    // best-effort
  }
}

export interface AlertaLocalAgendado {
  id: string;
  titulo: string;
  corpo: string;
  /** Instante (ms, relógio confiável) em que deve disparar. */
  quandoMs: number;
  /** true = pede tela cheia sobre o bloqueio; false = notificação forte normal. */
  telaCheia: boolean;
}

export async function agendarAlertaLocal(
  a: AlertaLocalAgendado,
): Promise<void> {
  const m = carregarNotifee();
  if (!m) return;
  const cfg = await m.default.getNotificationSettings();
  if (cfg.authorizationStatus !== m.AuthorizationStatus.AUTHORIZED) return;
  await garantirCanal(m);
  await conferirPermissaoDeAlarme(m);
  await m.default.createTriggerNotification(
    {
      id: a.id,
      title: a.titulo,
      body: a.corpo,
      data: {
        tela: a.telaCheia ? MARCA_TELA_CHEIA : "0",
        quando: String(a.quandoMs),
      },
      android: {
        channelId: CANAL_TELA_CHEIA,
        importance: m.AndroidImportance.HIGH,
        category: m.AndroidCategory.ALARM,
        visibility: m.AndroidVisibility.PUBLIC,
        sound: "default",
        vibrationPattern: [300, 800, 400, 800, 400, 800],
        autoCancel: false,
        pressAction: { id: "default", launchActivity: "default" },
        ...(a.telaCheia
          ? { fullScreenAction: { id: "default", launchActivity: "default" } }
          : {}),
      },
    },
    {
      type: m.TriggerType.TIMESTAMP,
      timestamp: a.quandoMs,
      alarmManager: { type: m.AlarmType.SET_ALARM_CLOCK },
    },
  );
}

/** Cancela agendado e/ou já exibido com este id. */
export async function cancelarAlertaLocal(id: string): Promise<void> {
  const m = carregarNotifee();
  if (!m) return;
  await m.default.cancelNotification(id).catch(() => undefined);
}
