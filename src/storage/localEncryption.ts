import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { gcm } from "@noble/ciphers/aes";
import { fromByteArray, toByteArray } from "base64-js";

/**
 * Criptografia local do "SQLCipher equivalente" deste app.
 *
 * O `expo-sqlite` (SDK gerenciado) não suporta SQLCipher nativamente ,
 * trocar o motor SQLite por uma variante cifrada (ex.: op-sqlite com
 * cipher, ou react-native-sqlcipher-storage) exige ejetar pra build
 * nativa própria e mantê-la sincronizada a cada upgrade de SDK, o que é
 * um custo de manutenção alto pra esta fase do projeto.
 *
 * Em vez disso, aplicamos criptografia de campo (envelope AES-256-GCM,
 * biblioteca pura em JS `@noble/ciphers` , sem módulo nativo, funciona
 * até no Expo Go) sobre o payload sensível de cada registro (GPS,
 * odômetro, observação) antes de gravar no SQLite. A chave de 256 bits
 * é gerada uma única vez por aparelho e fica só no Keychain/Keystore
 * (`expo-secure-store`), nunca no próprio banco , um dump do arquivo
 * `.db` sozinho (ex.: alguém copiando o arquivo de um aparelho
 * desbloqueado/rooted) não expõe os dados, exatamente a propriedade de
 * segurança que o SQLCipher entregaria, só que sem precisar trocar o
 * motor do banco.
 *
 * `tipoEvento`/`timestampEvento`/`status` continuam em texto claro
 * (não são segredo , servem só pra ordenar/filtrar a fila local) e
 * ficam de fora deste envelope.
 */

const CHAVE_CIFRA_LOCAL = "fvfhorus.chaveCifraLocalV1";
const TAMANHO_IV_BYTES = 12; // padrão recomendado para AES-GCM

let chaveCacheada: Uint8Array | null = null;

async function obterOuCriarChave(): Promise<Uint8Array> {
  if (chaveCacheada) return chaveCacheada;

  const existente = await SecureStore.getItemAsync(CHAVE_CIFRA_LOCAL);
  if (existente) {
    chaveCacheada = toByteArray(existente);
    return chaveCacheada;
  }

  const novaChave = await Crypto.getRandomBytesAsync(32); // AES-256
  await SecureStore.setItemAsync(CHAVE_CIFRA_LOCAL, fromByteArray(novaChave));
  chaveCacheada = novaChave;
  return novaChave;
}

/** Serializa `dados` como JSON e retorna "ivBase64.cifradoBase64", pronto para gravar numa coluna TEXT. */
export async function cifrarParaColuna(dados: unknown): Promise<string> {
  const chave = await obterOuCriarChave();
  const iv = await Crypto.getRandomBytesAsync(TAMANHO_IV_BYTES);
  const textoClaro = new TextEncoder().encode(JSON.stringify(dados ?? {}));
  const cifrado = gcm(chave, iv).encrypt(textoClaro);
  return `${fromByteArray(iv)}.${fromByteArray(cifrado)}`;
}

/** Inverso de `cifrarParaColuna`. Retorna `{}` (nunca lança) se a coluna estiver vazia/corrompida, para nunca travar o Histórico por um registro antigo/ilegível. */
export async function decifrarDaColuna<T = Record<string, unknown>>(
  coluna: string | null | undefined,
): Promise<T> {
  if (!coluna) return {} as T;
  try {
    const [ivB64, cifradoB64] = coluna.split(".");
    const chave = await obterOuCriarChave();
    const textoClaro = gcm(chave, toByteArray(ivB64)).decrypt(
      toByteArray(cifradoB64),
    );
    return JSON.parse(new TextDecoder().decode(textoClaro)) as T;
  } catch {
    return {} as T;
  }
}
