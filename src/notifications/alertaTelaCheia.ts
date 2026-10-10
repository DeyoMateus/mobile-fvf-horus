import { Alert, Platform } from "react-native";
import { rodandoNoExpoGo } from "../utils/ambiente";
import {
  canalDoSom,
  recursoDoSom,
  TODOS_OS_SONS,
} from "./sonsAlerta";
import type { SomAlerta } from "./sonsAlerta";
import {
  agendamentoNativoDisponivel,
  agendarAlarmeNativo,
  cancelarAlarmeNativo,
} from "./alarmeNativo";

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

/** Um canal por frase falada: o som (mp3 em res/raw) é do canal. */
export async function garantirCanalDoSom(
  m: Modulo,
  som: SomAlerta,
): Promise<void> {
  await m.default.createChannel({
    id: canalDoSom(som),
    name: `Alerta falado (${som})`,
    importance: m.AndroidImportance.HIGH,
    sound: recursoDoSom(som),
    vibration: true,
    vibrationPattern: [300, 800, 400, 800, 400, 800, 400, 800],
    visibility: m.AndroidVisibility.PUBLIC,
    bypassDnd: true,
  });
}

/** Cria todos os canais já na abertura do app (push remoto também os usa). */
export async function garantirTodosOsCanaisDeVoz(): Promise<void> {
  const m = carregarNotifee();
  if (!m) return;
  for (const som of TODOS_OS_SONS) {
    await garantirCanalDoSom(m, som).catch(() => undefined);
  }
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
  /** Frase falada que toca (voz no lugar do som padrão). */
  som: SomAlerta;
}

export async function agendarAlertaLocal(
  a: AlertaLocalAgendado,
): Promise<void> {
  const m = carregarNotifee();
  if (!m) return;
  const cfg = await m.default.getNotificationSettings();
  if (cfg.authorizationStatus !== m.AuthorizationStatus.AUTHORIZED) return;
  await conferirPermissaoDeAlarme(m);
  // Rodada 196: com o módulo nativo, TODO aviso vira alarme (serviço em
  // primeiro plano + voz/vibração em loop + tela vermelha por cima de
  // qualquer app ou do bloqueio), até o motorista dar "Ciente".
  if (
    agendamentoNativoDisponivel() &&
    (await agendarAlarmeNativo(a.id, a.quandoMs, a.titulo, a.corpo, a.som))
  ) {
    return;
  }
  await garantirCanalDoSom(m, a.som);
  await m.default.createTriggerNotification(
    {
      id: a.id,
      title: a.titulo,
      body: a.corpo,
      data: {
        tela: a.telaCheia ? MARCA_TELA_CHEIA : "0",
        som: a.som,
        quando: String(a.quandoMs),
      },
      android: {
        channelId: canalDoSom(a.som),
        importance: m.AndroidImportance.HIGH,
        category: m.AndroidCategory.ALARM,
        visibility: m.AndroidVisibility.PUBLIC,
        sound: recursoDoSom(a.som),
        vibrationPattern: [300, 800, 400, 800, 400, 800, 400, 800],
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
  cancelarAlarmeNativo(id);
  const m = carregarNotifee();
  if (!m) return;
  await m.default.cancelNotification(id).catch(() => undefined);
}

/**
 * Alerta do servidor com o app ABERTO: a tela vermelha abre e esta
 * notificação (sem marca de tela cheia, para não abrir outra tela)
 * fala a frase do tipo de alerta. Devolve função que a remove.
 */
export async function tocarVozDoAlertaAgora(
  som: SomAlerta,
  titulo: string,
  corpo: string,
): Promise<() => void> {
  const m = carregarNotifee();
  if (!m) return () => {};
  try {
    const cfg = await m.default.getNotificationSettings();
    if (cfg.authorizationStatus !== m.AuthorizationStatus.AUTHORIZED) {
      return () => {};
    }
    await garantirCanalDoSom(m, som);
    const id = await m.default.displayNotification({
      title: titulo,
      body: corpo,
      data: { tela: "0" },
      android: {
        channelId: canalDoSom(som),
        importance: m.AndroidImportance.HIGH,
        category: m.AndroidCategory.ALARM,
        sound: recursoDoSom(som),
        vibrationPattern: [300, 800, 400, 800, 400, 800, 400, 800],
        pressAction: { id: "default" },
      },
    });
    return () => {
      void m.default.cancelNotification(id).catch(() => undefined);
    };
  } catch {
    return () => {};
  }
}
