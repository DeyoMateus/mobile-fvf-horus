import * as Device from "expo-device";
import { Linking, Platform } from "react-native";
import { rodandoNoExpoGo } from "../utils/ambiente";
import { carregarNotifee } from "./alertaTelaCheia";
import { abrirSobreporApps, podeSobreporApps } from "./alarmeNativo";

type NotificationsModulo = typeof import("expo-notifications");

/**
 * Permissões OBRIGATÓRIAS para os alertas de jornada funcionarem com o
 * app fechado e o celular bloqueado. O app só libera o uso depois que
 * as três estão concedidas (tela PermissoesAlertasScreen).
 *
 * Se algum aparelho/ROM não conseguir liberar a tela cheia e o motorista
 * ficar travado, trocar EXIGIR_TELA_CHEIA para false: notificação e
 * alarme continuam obrigatórios.
 */
export const EXIGIR_TELA_CHEIA = true;

// "Agora não" nas permissões recomendadas vale só até fechar o app: na
// próxima abertura a tela volta a pedir, em cascata, até concederem.
let opcionaisPuladas = false;
export function pularPermissoesRecomendadas(): void {
  opcionaisPuladas = true;
}
export function recomendadasForamPuladas(): boolean {
  return opcionaisPuladas;
}

export interface EstadoPermissoesAlertas {
  notificacoes: boolean;
  alarmes: boolean;
  telaCheia: boolean;
  bateriaLivre: boolean; // recomendada, não bloqueia
  /** "Exibir sobre outros apps": recomendada, não bloqueia. */
  sobrepor: boolean;
  /** true = tudo que é obrigatório está concedido. */
  tudoOk: boolean;
  /**
   * true = falta algo a pedir: obrigatória pendente OU recomendada
   * (bateria, sobrepor apps) ainda não concedida e não pulada nesta
   * abertura do app. É o que faz a tela de permissões REAPARECER.
   */
  pendente: boolean;
  /** true = não se aplica (Expo Go, emulador, iOS): não bloqueia. */
  naoSeAplica: boolean;
}

const NAO_SE_APLICA: EstadoPermissoesAlertas = {
  notificacoes: true,
  alarmes: true,
  telaCheia: true,
  bateriaLivre: true,
  sobrepor: true,
  tudoOk: true,
  pendente: false,
  naoSeAplica: true,
};

export async function verificarPermissoesAlertas(): Promise<EstadoPermissoesAlertas> {
  if (Platform.OS !== "android" || rodandoNoExpoGo() || !Device.isDevice) {
    return NAO_SE_APLICA;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications: NotificationsModulo = require("expo-notifications");
    const perm = await Notifications.getPermissionsAsync();
    const notificacoes = perm.status === "granted";

    let alarmes = true;
    let telaCheia = true;
    let bateriaLivre = true;
    const m = carregarNotifee();
    if (m) {
      const cfg = await m.default.getNotificationSettings();
      alarmes = cfg.android?.alarm !== m.AndroidNotificationSetting.DISABLED;
      telaCheia =
        cfg.android?.fullScreenIntent !==
        m.AndroidNotificationSetting.DISABLED;
      bateriaLivre = !(await m.default.isBatteryOptimizationEnabled());
    }
    const sobrepor = await podeSobreporApps();
    const tudoOk = notificacoes && alarmes && (telaCheia || !EXIGIR_TELA_CHEIA);
    return {
      notificacoes,
      alarmes,
      telaCheia,
      bateriaLivre,
      sobrepor,
      tudoOk,
      pendente:
        !tudoOk || (!opcionaisPuladas && (!bateriaLivre || !sobrepor)),
      naoSeAplica: false,
    };
  } catch {
    // Não conseguiu verificar: não trava o motorista por falha da checagem.
    return NAO_SE_APLICA;
  }
}

/** Pede notificações: diálogo do sistema, ou configurações se já negou. */
export async function permitirNotificacoes(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Notifications: NotificationsModulo = require("expo-notifications");
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status === "granted") return;
  if (perm.canAskAgain) {
    const pedido = await Notifications.requestPermissionsAsync();
    if (pedido.status === "granted") return;
  }
  await Linking.openSettings();
}

export async function permitirAlarmes(): Promise<void> {
  await carregarNotifee()?.default.openAlarmPermissionSettings();
}

/** O Android não abre direto essa tela: leva às configurações do app. */
export async function permitirTelaCheia(): Promise<void> {
  await Linking.openSettings();
}

export async function permitirBateriaLivre(): Promise<void> {
  await carregarNotifee()?.default.openBatteryOptimizationSettings();
}

/** Abre "Exibir sobre outros apps" deste app (tela do alerta por cima de tudo). */
export async function permitirSobreporApps(): Promise<void> {
  abrirSobreporApps();
}
