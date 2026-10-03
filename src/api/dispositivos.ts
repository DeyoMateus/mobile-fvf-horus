import * as Device from "expo-device";
import { Platform } from "react-native";
import { API_URL } from "./client";

/**
 * Endpoint PÚBLICO (sem headers de device binding) , é exatamente o
 * caso em que este aparelho é novo e ainda não tem nenhuma credencial
 * válida. Não vincula nada por si só: só entra na fila de espera do
 * gestor (`SolicitacoesTrocaDispositivoController`, sem guard, mas
 * rate-limited na borda).
 */
export async function solicitarTrocaDispositivo(
  motoristaId: string,
  cpfConfirmacao: string,
  deviceUuidSolicitado: string,
  observacaoMotorista?: string,
): Promise<void> {
  const resposta = await fetch(`${API_URL}/solicitacoes-troca-dispositivo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      motoristaId,
      cpfConfirmacao,
      deviceUuidSolicitado,
      modeloAparelho:
        `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim() ||
        undefined,
      sistemaOperacional: `${Platform.OS} ${Device.osVersion ?? ""}`.trim(),
      observacaoMotorista,
    }),
  });

  if (!resposta.ok) {
    const texto = await resposta.text();
    throw new Error(
      texto || `Falha ao solicitar troca (HTTP ${resposta.status})`,
    );
  }
}
