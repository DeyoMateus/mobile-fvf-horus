import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import {
  carregarNotifee,
  MARCA_TELA_CHEIA,
} from "../notifications/alertaTelaCheia";
import { agoraConfiavel } from "../utils/relogioConfiavel";

interface AlertaTela {
  id: string;
  titulo: string;
  corpo: string;
}

// Alerta local que ficou na bandeja há mais que isso já não descreve a
// situação: é limpo sem abrir a tela.
const VALIDADE_MS = 60 * 60_000;
const PADRAO_VIBRACAO = [0, 800, 400, 800, 400];

/**
 * Tela vermelha de TELA CHEIA para os avisos locais de jornada (ver
 * notifications/alertaTelaCheia.ts). Fica na RAIZ do app, por cima da
 * tela de PIN: quando o Android abre o app sobre o bloqueio por causa
 * do alerta, o motorista vê o aviso na hora, sem digitar PIN. Só mostra
 * o texto do alerta (nenhum dado da jornada). Fechar = "Ciente".
 */
export function AlertaLocalTelaCheia() {
  const [alerta, setAlerta] = useState<AlertaTela | null>(null);
  const alertaRef = useRef<AlertaTela | null>(null);
  alertaRef.current = alerta;

  const verificar = useCallback(async () => {
    const m = carregarNotifee();
    if (!m) return;
    try {
      const exibidas = await m.default.getDisplayedNotifications();
      for (const item of exibidas) {
        const n = item.notification;
        if (!n?.id || n.data?.tela !== MARCA_TELA_CHEIA) continue;
        const quando = Number(n.data?.quando);
        if (
          Number.isFinite(quando) &&
          agoraConfiavel() - quando > VALIDADE_MS
        ) {
          await m.default.cancelNotification(n.id).catch(() => undefined);
          continue;
        }
        if (alertaRef.current?.id === n.id) return;
        setAlerta({
          id: n.id,
          titulo: String(n.title ?? "Alerta de jornada"),
          corpo: String(n.body ?? ""),
        });
        return;
      }
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void verificar();
    const assinatura = AppState.addEventListener("change", (estado) => {
      if (estado === "active") void verificar();
    });
    const m = carregarNotifee();
    const parar = m?.default.onForegroundEvent(({ type, detail }) => {
      if (
        type === m.EventType.DELIVERED &&
        detail.notification?.data?.tela === MARCA_TELA_CHEIA
      ) {
        void verificar();
      }
    });
    return () => {
      assinatura.remove();
      parar?.();
    };
  }, [verificar]);

  useEffect(() => {
    if (!alerta) return;
    Vibration.vibrate(PADRAO_VIBRACAO, true);
    return () => Vibration.cancel();
  }, [alerta]);

  async function ciente() {
    const atual = alerta;
    setAlerta(null);
    if (atual) {
      await carregarNotifee()
        ?.default.cancelNotification(atual.id)
        .catch(() => undefined);
    }
  }

  if (!alerta) return null;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={ciente}>
      <View style={estilos.raiz}>
        <Text style={estilos.icone}>⚠️</Text>
        <Text style={estilos.titulo}>{alerta.titulo}</Text>
        <Text style={estilos.mensagem}>{alerta.corpo}</Text>
        <Text style={estilos.dica}>
          Pare com segurança assim que possível e faça a pausa exigida.
        </Text>
        <TouchableOpacity style={estilos.botao} onPress={() => void ciente()}>
          <Text style={estilos.botaoTexto}>Ciente, fechar alerta</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: {
    flex: 1,
    backgroundColor: "#b91c1c",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  icone: { fontSize: 64, marginBottom: 12 },
  titulo: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 14,
  },
  mensagem: {
    color: "#fff",
    fontSize: 20,
    textAlign: "center",
    marginBottom: 14,
  },
  dica: {
    color: "#fecaca",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
  },
  botao: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 28,
  },
  botaoTexto: { color: "#b91c1c", fontSize: 18, fontWeight: "800" },
});
