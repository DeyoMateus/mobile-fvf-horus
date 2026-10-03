import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

export interface FolgaConcedida {
  id: string;
  data: string;
  motivo: string | null;
  createdAt: string;
}

/**
 * Rodada 58 , pedido do usuário: as folgas que A EMPRESA concede pro
 * motorista (diferente de `AutorrelatoFolga`, que é o próprio
 * motorista avisando) também precisam aparecer pra ele conferir, e
 * entrar no mesmo comparativo de "hoje é dia de folga?" ao bater
 * ponto (ver `RegistrarPontoScreen.tsx`).
 */
export async function listarFolgasConcedidas(
  credenciais: CredenciaisDispositivo,
): Promise<FolgaConcedida[]> {
  const resposta = await fetch(`${API_URL}/dispositivo/folgas-concedidas`, {
    headers: {
      "X-Motorista-Id": credenciais.motoristaId,
      "X-Device-Uuid": credenciais.deviceUuid,
      "X-Device-Key": credenciais.deviceApiKey,
    },
  });
  if (!resposta.ok)
    throw new Error(
      `Falha ao buscar folgas concedidas (HTTP ${resposta.status})`,
    );
  return resposta.json();
}

/**
 * Chamada quando o motorista bate ponto num dia que a empresa
 * concedeu como folga e escolhe continuar mesmo assim: anula a folga
 * concedida daquele dia no backend (e avisa o gestor).
 */
export async function anularFolgaConcedida(
  credenciais: CredenciaisDispositivo,
  data: string,
): Promise<void> {
  const resposta = await fetch(
    `${API_URL}/dispositivo/folga-concedida/${data}`,
    {
      method: "DELETE",
      headers: {
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
    },
  );
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(
      corpo || `Falha ao anular folga concedida (HTTP ${resposta.status})`,
    );
  }
}
