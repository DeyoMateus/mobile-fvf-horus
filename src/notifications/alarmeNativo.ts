import { NativeModules, Vibration } from "react-native";
import { recursoDoSom } from "./sonsAlerta";
import type { SomAlerta } from "./sonsAlerta";

/**
 * Alarme da tela vermelha (Rodada 195). No Android, o `Vibration` do RN e o
 * som do canal de notificação são silenciados quando o celular está no modo
 * silencioso/vibrar. O módulo nativo BloqueioTela toca a voz e vibra com
 * USAGE_ALARM, que o sistema não silencia. Sem o módulo (Expo Go, build
 * antigo) cai no `Vibration` de antes.
 */
export interface AlertaNativoAtivo {
  id: string;
  titulo: string;
  corpo: string;
  som: SomAlerta;
  quando: number;
}

const Nativo: {
  iniciarAlarme?: (
    recurso: string,
    padrao: number[],
    atrasoVozMs: number,
  ) => void;
  pararAlarme?: () => void;
  agendarAlarme?: (
    id: string,
    quandoMs: number,
    titulo: string,
    corpo: string,
    som: string,
  ) => Promise<boolean>;
  cancelarAlarme?: (id: string) => void;
  alertaAtivo?: () => Promise<AlertaNativoAtivo | null>;
  podeSobreporApps?: () => Promise<boolean>;
  abrirSobreporApps?: () => void;
} | null = NativeModules.BloqueioTela ?? null;

export function alarmeNativoDisponivel(): boolean {
  return typeof Nativo?.iniciarAlarme === "function";
}

/** Vibra (repetindo) e fala a frase em loop até `pararAlarmeDaTela`. */
export function iniciarAlarmeDaTela(
  som: SomAlerta,
  padrao: number[],
  atrasoVozMs = 0,
): void {
  if (alarmeNativoDisponivel()) {
    try {
      Nativo!.iniciarAlarme!(recursoDoSom(som), padrao, atrasoVozMs);
      return;
    } catch {
      // cai no Vibration abaixo
    }
  }
  Vibration.vibrate(padrao, true);
}

export function pararAlarmeDaTela(): void {
  try {
    Nativo?.pararAlarme?.();
  } catch {
    // best-effort
  }
  Vibration.cancel();
}

/** Rodada 196: o alerta agendado é um alarme nativo (serviço + tela). */
export function agendamentoNativoDisponivel(): boolean {
  return typeof Nativo?.agendarAlarme === "function";
}

export async function agendarAlarmeNativo(
  id: string,
  quandoMs: number,
  titulo: string,
  corpo: string,
  som: SomAlerta,
): Promise<boolean> {
  try {
    return (await Nativo?.agendarAlarme?.(id, quandoMs, titulo, corpo, som)) === true;
  } catch {
    return false;
  }
}

export function cancelarAlarmeNativo(id: string): void {
  try {
    Nativo?.cancelarAlarme?.(id);
  } catch {
    // best-effort
  }
}

/** Alerta já disparado e ainda sem "Ciente" (null = nenhum). */
export async function alertaNativoAtivo(): Promise<AlertaNativoAtivo | null> {
  try {
    return (await Nativo?.alertaAtivo?.()) ?? null;
  } catch {
    return null;
  }
}

/** "Exibir sobre outros apps": deixa a tela do alerta abrir por cima de tudo. */
export async function podeSobreporApps(): Promise<boolean> {
  try {
    const r = await Nativo?.podeSobreporApps?.();
    return r === undefined ? true : r === true;
  } catch {
    return true;
  }
}

export function abrirSobreporApps(): void {
  try {
    Nativo?.abrirSobreporApps?.();
  } catch {
    // best-effort
  }
}
