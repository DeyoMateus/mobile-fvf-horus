import type { CredenciaisDispositivo, RegistroLocal } from "../types";

/**
 * A URL do backend. Vem de `EXPO_PUBLIC_API_URL` (arquivo `.env` na raiz
 * de `mobile/`, ou variável de ambiente do próprio profile do EAS Build
 * , ver `eas.json`) , o Expo CLI embute qualquer var prefixada com
 * `EXPO_PUBLIC_` no bundle em tempo de build, sem precisar de lib extra.
 * Sem `.env`, cai no fallback de desenvolvimento local.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export class ErroApi extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

async function requisitar<T>(caminho: string, opcoes: RequestInit): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new ErroApi(corpo || `Erro HTTP ${resposta.status}`, resposta.status);
  }

  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
}

export interface ResultadoItemLoteRegistro {
  index: number;
  sucesso: boolean;
  registroId?: string;
  erro?: string;
}

/**
 * Envio em lote (Rodada 66): manda de uma vez todos os registros
 * pendentes acumulados offline, em vez de um POST por evento. O
 * backend processa cada item NA ORDEM enviada (obrigatório pela cadeia
 * de hash) e devolve o resultado item a item , `sincronizarFila` usa
 * isso pra só marcar como enviado quem de fato teve sucesso.
 */
export async function enviarLoteRegistros(
  credenciais: CredenciaisDispositivo,
  registros: Pick<
    RegistroLocal,
    | "tipoEvento"
    | "timestampEvento"
    | "latitude"
    | "longitude"
    | "precisaoGpsM"
    | "observacao"
    | "idLocal"
    | "flagsIntegridadeDispositivo"
    | "elapsedRealtimeMs"
  >[],
): Promise<ResultadoItemLoteRegistro[]> {
  return requisitar("/registros-jornada/lote", {
    method: "POST",
    headers: {
      "X-Motorista-Id": credenciais.motoristaId,
      "X-Device-Uuid": credenciais.deviceUuid,
      "X-Device-Key": credenciais.deviceApiKey,
    },
    body: JSON.stringify({
      eventos: registros.map((registro) => ({
        tipoEvento: registro.tipoEvento,
        timestampEvento: registro.timestampEvento,
        latitude: registro.latitude ?? undefined,
        longitude: registro.longitude ?? undefined,
        precisaoGpsM: registro.precisaoGpsM ?? undefined,
        observacao: registro.observacao ?? undefined,
        idempotencyKey: registro.idLocal,
        flagsIntegridadeDispositivo: registro.flagsIntegridadeDispositivo
          ?.length
          ? registro.flagsIntegridadeDispositivo
          : undefined,
        elapsedRealtimeMs: registro.elapsedRealtimeMs ?? undefined,
      })),
    }),
  });
}

export interface AmostraLocalizacaoEnvio {
  latitude: number;
  longitude: number;
  precisaoGpsM?: number | null;
  capturadoEm: string;
}

/** Envia um lote de amostras de GPS periódicas ("luneta") , mesmas credenciais de dispositivo do resto do app. */
export async function enviarAmostrasLocalizacao(
  credenciais: CredenciaisDispositivo,
  amostras: AmostraLocalizacaoEnvio[],
): Promise<void> {
  await requisitar("/dispositivo/amostras-localizacao", {
    method: "POST",
    headers: {
      "X-Motorista-Id": credenciais.motoristaId,
      "X-Device-Uuid": credenciais.deviceUuid,
      "X-Device-Key": credenciais.deviceApiKey,
    },
    body: JSON.stringify({
      amostras: amostras.map((a) => ({
        latitude: a.latitude,
        longitude: a.longitude,
        precisaoGpsM: a.precisaoGpsM ?? undefined,
        capturadoEm: a.capturadoEm,
      })),
    }),
  });
}
