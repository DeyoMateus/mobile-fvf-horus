import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { suprimirProximoBloqueio } from "../security/appLockSuppression";
import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

export interface EvidenciaTratamento {
  id: string;
  nomeArquivo: string;
  contentType: string;
  tamanhoBytes: number;
}

export interface TratamentoPonto {
  id: string;
  tipoEvento: string;
  timestampEvento: string;
  motivo: string;
  createdAt: string;
  motoristaCienciaEm: string | null;
  usuario?: { nome: string };
  evidencias?: EvidenciaTratamento[];
}

// Ajustes (fechamentos de ponto) que a empresa lançou , o motorista nunca
// bate esses eventos, só fica sabendo (push + esta tela) e pode baixar o
// motivo e as provas anexadas. Discordar se resolve conversando com a
// empresa, não existe "contestar" aqui de propósito (ver Rodada 26).
export async function listarMeusAjustes(
  credenciais: CredenciaisDispositivo,
): Promise<TratamentoPonto[]> {
  const resposta = await fetch(`${API_URL}/dispositivo/meus-ajustes`, {
    headers: {
      "X-Motorista-Id": credenciais.motoristaId,
      "X-Device-Uuid": credenciais.deviceUuid,
      "X-Device-Key": credenciais.deviceApiKey,
    },
  });
  if (!resposta.ok)
    throw new Error(`Falha ao buscar ajustes (HTTP ${resposta.status})`);
  return resposta.json();
}

/** Marca que o motorista já leu este ajuste , nunca obrigatório, só fica registrado no histórico. */
export async function darCienciaAjuste(
  credenciais: CredenciaisDispositivo,
  tratamentoId: string,
): Promise<void> {
  const resposta = await fetch(
    `${API_URL}/dispositivo/meus-ajustes/${tratamentoId}/ciencia`,
    {
      method: "PATCH",
      headers: {
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
    },
  );
  if (!resposta.ok)
    throw new Error(`Falha ao registrar ciência (HTTP ${resposta.status})`);
}

/** Baixa uma evidência anexada pelo gestor (print de rastreador/WhatsApp etc.) e abre pra compartilhar/salvar. */
export async function baixarEvidenciaAjuste(
  credenciais: CredenciaisDispositivo,
  evidencia: EvidenciaTratamento,
): Promise<void> {
  const destino = `${FileSystem.cacheDirectory}${evidencia.nomeArquivo}`;
  const resultado = await FileSystem.downloadAsync(
    `${API_URL}/dispositivo/meus-ajustes/evidencias/${evidencia.id}`,
    destino,
    {
      headers: {
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
    },
  );
  if (resultado.status !== 200)
    throw new Error(`Falha ao baixar evidência (HTTP ${resultado.status})`);

  const disponivel = await Sharing.isAvailableAsync();
  if (disponivel) {
    suprimirProximoBloqueio();
    await Sharing.shareAsync(resultado.uri, {
      mimeType: evidencia.contentType,
      dialogTitle: evidencia.nomeArquivo,
    });
  }
}
