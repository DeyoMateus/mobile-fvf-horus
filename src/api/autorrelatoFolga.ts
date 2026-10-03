import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

export interface AutorrelatoFolga {
  id: string;
  data: string;
  observacao: string | null;
  createdAt: string;
}

/** Avisa a empresa que um dia foi de folga , não é ponto, só evita estranheza pela ausência de registros naquele dia. */
export async function autorrelatarFolga(
  credenciais: CredenciaisDispositivo,
  data: string,
  observacao?: string,
): Promise<void> {
  const resposta = await fetch(`${API_URL}/dispositivo/autorrelato-folga`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Motorista-Id": credenciais.motoristaId,
      "X-Device-Uuid": credenciais.deviceUuid,
      "X-Device-Key": credenciais.deviceApiKey,
    },
    body: JSON.stringify({ data, observacao: observacao || undefined }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(corpo || `Falha ao avisar folga (HTTP ${resposta.status})`);
  }
}

/**
 * Rodada 57 , pedido do usuário: o motorista consegue conferir, no
 * próprio app, os avisos de folga que ele já mandou ("meus pedidos"),
 * usada tanto pelo card em `HorasScreen.tsx` quanto pelo `HistoricoScreen.tsx`
 * (o aviso também foi um envio pro servidor, mesma lógica de exibir os
 * pontos batidos).
 */
export async function listarAutorrelatosFolga(
  credenciais: CredenciaisDispositivo,
): Promise<AutorrelatoFolga[]> {
  const resposta = await fetch(`${API_URL}/dispositivo/autorrelatos-folga`, {
    headers: {
      "X-Motorista-Id": credenciais.motoristaId,
      "X-Device-Uuid": credenciais.deviceUuid,
      "X-Device-Key": credenciais.deviceApiKey,
    },
  });
  if (!resposta.ok)
    throw new Error(
      `Falha ao buscar folgas avisadas (HTTP ${resposta.status})`,
    );
  return resposta.json();
}

/**
 * Rodada 57 , chamada quando o motorista bate ponto num dia que ele
 * mesmo tinha avisado como folga e escolhe continuar mesmo assim (ver
 * `RegistrarPontoScreen.tsx`): anula o autorrelato daquele dia no
 * backend, pra não ficar incoerente (folga "avisada" + ponto batido no
 * mesmo dia).
 */
export async function anularAutorrelatoFolga(
  credenciais: CredenciaisDispositivo,
  data: string,
): Promise<void> {
  const resposta = await fetch(
    `${API_URL}/dispositivo/autorrelato-folga/${data}`,
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
    throw new Error(corpo || `Falha ao anular folga (HTTP ${resposta.status})`);
  }
}
