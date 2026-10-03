import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

/**
 * PIN local de 4 dígitos , não é autenticação com o backend, é uma
 * trava do PRÓPRIO APARELHO. Existe porque, sem login por usuário, o
 * app fica sempre "destravado" pro motorista vinculado: qualquer pessoa
 * que pegasse o celular poderia bater ponto em nome dele. O PIN garante
 * que é o motorista de fato quem está com o aparelho na mão em cada
 * sessão de uso, sem reintroduzir login por senha (o vínculo continua
 * sendo por aparelho, controlado pela empresa).
 *
 * Guardado como hash salgado (SHA-256) no SecureStore , nunca em texto
 * puro, mesmo sendo "só" um PIN local.
 */

const CHAVE_PIN_HASH = "fvfhorus.pinHash";
const CHAVE_PIN_SALT = "fvfhorus.pinSalt";

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
}

export async function temPinCadastrado(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CHAVE_PIN_HASH)) !== null;
}

export async function definirPin(pin: string): Promise<void> {
  const salt = Crypto.randomUUID();
  const hash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(CHAVE_PIN_SALT, salt);
  await SecureStore.setItemAsync(CHAVE_PIN_HASH, hash);
}

export async function verificarPin(pin: string): Promise<boolean> {
  const [salt, hashSalvo] = await Promise.all([
    SecureStore.getItemAsync(CHAVE_PIN_SALT),
    SecureStore.getItemAsync(CHAVE_PIN_HASH),
  ]);
  if (!salt || !hashSalvo) return false;
  const hash = await hashPin(pin, salt);
  return hash === hashSalvo;
}

/** Usado quando o vínculo é desfeito (troca de aparelho, revogação, ou motorista esqueceu o PIN e precisa recomeçar). */
export async function limparPin(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_PIN_HASH);
  await SecureStore.deleteItemAsync(CHAVE_PIN_SALT);
}
