import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

export type TecnologiaRastreador =
  | "GPS"
  | "SATELITAL"
  | "CELULAR"
  | "RFID"
  | "HIBRIDO"
  | "OUTRO";

export interface VeiculoVinculado {
  placa: string;
  idRastreador: string | null;
  tecnologiaRastreador: TecnologiaRastreador | null;
}

function cabecalhos(credenciais: CredenciaisDispositivo) {
  return {
    "Content-Type": "application/json",
    "X-Motorista-Id": credenciais.motoristaId,
    "X-Device-Uuid": credenciais.deviceUuid,
    "X-Device-Key": credenciais.deviceApiKey,
  };
}

/**
 * O backend (NestJS) responde erro como JSON (`{ message, statusCode,
 * error }`, `message` podendo ser string ou array de strings do
 * class-validator) , sem isso, o app mostraria o JSON cru na tela em
 * vez de uma mensagem legível pro motorista.
 */
async function extrairMensagemDeErro(
  resposta: Response,
  fallback: string,
): Promise<string> {
  const corpo = await resposta.text();
  if (!corpo) return fallback;
  try {
    const json = JSON.parse(corpo) as { message?: string | string[] };
    if (Array.isArray(json.message)) return json.message.join(" , ");
    if (typeof json.message === "string") return json.message;
  } catch {
    // corpo não era JSON , usa o texto cru mesmo
  }
  return corpo;
}

/** Placa/rastreador vinculados hoje , `null` se este motorista ainda não tem nenhum cadastrado. */
export async function obterVeiculo(
  credenciais: CredenciaisDispositivo,
): Promise<VeiculoVinculado | null> {
  const resposta = await fetch(`${API_URL}/dispositivo/veiculo`, {
    method: "GET",
    headers: cabecalhos(credenciais),
  });
  if (!resposta.ok) {
    if (resposta.status === 404) return null;
    throw new Error(
      await extrairMensagemDeErro(
        resposta,
        `Falha ao consultar veículo (HTTP ${resposta.status})`,
      ),
    );
  }
  const dados = await resposta.json();
  return "placa" in dados ? dados : null;
}

/**
 * Troca a placa (self-service, sem aprovação do gestor) , mas toda
 * troca de verdade (não o primeiro cadastro) fica registrada e visível
 * pro gestor no painel (ver VeiculosService no backend).
 */
export async function atualizarVeiculo(
  credenciais: CredenciaisDispositivo,
  dados: {
    placa: string;
    idRastreador?: string;
    tecnologiaRastreador?: TecnologiaRastreador;
  },
): Promise<VeiculoVinculado> {
  const resposta = await fetch(`${API_URL}/dispositivo/veiculo`, {
    method: "PUT",
    headers: cabecalhos(credenciais),
    body: JSON.stringify(dados),
  });
  if (!resposta.ok) {
    throw new Error(
      await extrairMensagemDeErro(
        resposta,
        `Falha ao atualizar veículo (HTTP ${resposta.status})`,
      ),
    );
  }
  return resposta.json();
}
