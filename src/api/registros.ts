import { API_URL } from "./client";
import type { CredenciaisDispositivo, RegistroLocal } from "../types";

/**
 * Rodada 141 , busca no servidor os registros do motorista (aparelho
 * novo, ou consulta de uma data específica no Histórico). Mesmo
 * device binding das demais rotas do app.
 */
export async function buscarMeusRegistros(
  credenciais: CredenciaisDispositivo,
  periodo?: { inicio?: string; fim?: string },
): Promise<RegistroLocal[]> {
  const q = new URLSearchParams();
  if (periodo?.inicio) q.set("inicio", periodo.inicio);
  if (periodo?.fim) q.set("fim", periodo.fim);
  const resposta = await fetch(
    `${API_URL}/registros-jornada/meus-registros${q.toString() ? `?${q}` : ""}`,
    {
      headers: {
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
    },
  );
  if (!resposta.ok)
    throw new Error(`Falha ao buscar registros (HTTP ${resposta.status})`);
  const lista = (await resposta.json()) as Array<
    Omit<RegistroLocal, "status" | "tentativas">
  >;
  return lista.map((r) => ({
    ...r,
    status: "ENVIADO" as const,
    tentativas: 0,
    enviadoEm: r.criadoEm,
  }));
}
