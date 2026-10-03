import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { CredenciaisDispositivo } from "../types";

/**
 * Credenciais de device binding (X-Motorista-Id / X-Device-Key /
 * X-Device-Uuid), guardadas no Keychain (iOS) / Keystore (Android) via
 * expo-secure-store , nunca em AsyncStorage puro, que não é cifrado.
 *
 * O deviceUuid é gerado UMA VEZ na primeira instalação e nunca muda
 * enquanto o app não for reinstalado , é o "RG" físico do aparelho.
 * A deviceApiKey só existe depois que a empresa vincula este deviceUuid
 * ao motorista no painel (o app mostra o UUID pro motorista passar pro
 * RH/gestor, e recebe a key de volta pra colar aqui uma única vez).
 */

const CHAVE_DEVICE_UUID = "fvfhorus.deviceUuid";
const CHAVE_MOTORISTA_ID = "fvfhorus.motoristaId";
const CHAVE_DEVICE_API_KEY = "fvfhorus.deviceApiKey";
const CHAVE_SOLICITACAO_PENDENTE_MOTORISTA_ID =
  "fvfhorus.solicitacaoPendente.motoristaId";

export async function obterOuCriarDeviceUuid(): Promise<string> {
  const existente = await SecureStore.getItemAsync(CHAVE_DEVICE_UUID);
  if (existente) return existente;

  const novo = Crypto.randomUUID();
  await SecureStore.setItemAsync(CHAVE_DEVICE_UUID, novo);
  return novo;
}

export async function salvarVinculo(
  motoristaId: string,
  deviceApiKey: string,
): Promise<void> {
  await SecureStore.setItemAsync(CHAVE_MOTORISTA_ID, motoristaId);
  await SecureStore.setItemAsync(CHAVE_DEVICE_API_KEY, deviceApiKey);
}

export async function obterCredenciais(): Promise<CredenciaisDispositivo | null> {
  const [deviceUuid, motoristaId, deviceApiKey] = await Promise.all([
    SecureStore.getItemAsync(CHAVE_DEVICE_UUID),
    SecureStore.getItemAsync(CHAVE_MOTORISTA_ID),
    SecureStore.getItemAsync(CHAVE_DEVICE_API_KEY),
  ]);
  if (!deviceUuid || !motoristaId || !deviceApiKey) return null;
  return { deviceUuid, motoristaId, deviceApiKey };
}

/** Usado quando a empresa revoga o vínculo e o motorista precisa vincular de novo (o deviceUuid do aparelho continua o mesmo). */
export async function limparVinculo(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_MOTORISTA_ID);
  await SecureStore.deleteItemAsync(CHAVE_DEVICE_API_KEY);
}

/**
 * Persistência leve do "já pedi a troca, tô esperando o gestor" , sem
 * isso, fechar e abrir o app de novo faria o motorista preencher o
 * formulário da seção 3 do onboarding outra vez (inofensivo , o
 * backend deduplica , mas confuso). Guarda só o motoristaId, o
 * suficiente pra saber que existe um pedido em aberto; o estado real
 * (pendente/aprovada/rejeitada) mora no backend, isto é só uma dica de
 * UI local.
 */
export async function salvarSolicitacaoPendente(
  motoristaId: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    CHAVE_SOLICITACAO_PENDENTE_MOTORISTA_ID,
    motoristaId,
  );
}

export async function obterSolicitacaoPendente(): Promise<string | null> {
  return SecureStore.getItemAsync(CHAVE_SOLICITACAO_PENDENTE_MOTORISTA_ID);
}

export async function limparSolicitacaoPendente(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_SOLICITACAO_PENDENTE_MOTORISTA_ID);
}
