import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { suprimirProximoBloqueio } from "../security/appLockSuppression";
import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

export type StatusSolicitacaoAjuste = "PENDENTE" | "APROVADA" | "REJEITADA";

export interface EvidenciaSolicitacao {
  id: string;
  nomeArquivo: string;
  contentType: string;
  tamanhoBytes: number;
}

export interface SolicitacaoAjustePonto {
  id: string;
  tipoEvento: string;
  timestampEvento: string;
  justificativa: string;
  status: StatusSolicitacaoAjuste;
  motivoDecisao: string | null;
  decididoEm: string | null;
  createdAt: string;
  evidencias?: EvidenciaSolicitacao[];
}

export interface CriarSolicitacaoInput {
  tipoEvento: string;
  timestampEvento: string;
  justificativa: string;
}

function headersDispositivo(credenciais: CredenciaisDispositivo) {
  return {
    "X-Motorista-Id": credenciais.motoristaId,
    "X-Device-Uuid": credenciais.deviceUuid,
    "X-Device-Key": credenciais.deviceApiKey,
  };
}

// "Esqueci de bater" , o motorista pede a correção pelo próprio app,
// apontando o dia, o horário e o motivo. Só vira o horário oficial (e só
// então entra na apuração/holerite) se o RH aprovar pelo painel , ver
// tela de decisão no painel web (SolicitacoesAjustePage).
export async function criarSolicitacaoAjuste(
  credenciais: CredenciaisDispositivo,
  input: CriarSolicitacaoInput,
): Promise<SolicitacaoAjustePonto> {
  const resposta = await fetch(
    `${API_URL}/dispositivo/minhas-solicitacoes-ajuste`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headersDispositivo(credenciais),
      },
      body: JSON.stringify(input),
    },
  );
  if (!resposta.ok)
    throw new Error(
      `Falha ao enviar pedido de ajuste (HTTP ${resposta.status})`,
    );
  return resposta.json();
}

export async function listarMinhasSolicitacoes(
  credenciais: CredenciaisDispositivo,
): Promise<SolicitacaoAjustePonto[]> {
  const resposta = await fetch(
    `${API_URL}/dispositivo/minhas-solicitacoes-ajuste`,
    {
      headers: headersDispositivo(credenciais),
    },
  );
  if (!resposta.ok)
    throw new Error(`Falha ao buscar meus pedidos (HTTP ${resposta.status})`);
  return resposta.json();
}

/** Baixa uma evidência anexada pelo motorista ao próprio pedido , pra conferir o que foi enviado. */
export async function baixarEvidenciaSolicitacao(
  credenciais: CredenciaisDispositivo,
  evidencia: EvidenciaSolicitacao,
): Promise<void> {
  const destino = `${FileSystem.cacheDirectory}${evidencia.nomeArquivo}`;
  const resultado = await FileSystem.downloadAsync(
    `${API_URL}/dispositivo/minhas-solicitacoes-ajuste/evidencias/${evidencia.id}`,
    destino,
    { headers: headersDispositivo(credenciais) },
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
