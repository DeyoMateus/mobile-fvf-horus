import * as SecureStore from "expo-secure-store";

/**
 * Rodada 57 , pedido do usuário: se o motorista tenta bater ponto num
 * dia que ele mesmo avisou como folga, o app precisa avisar ele disso
 * , inclusive sem sinal de internet no momento (o app é offline-first,
 * e é justamente em rota, sem sinal, que ele mais bate ponto). Por
 * isso guardamos, só neste aparelho, as datas de folga avisadas , pra
 * `RegistrarPontoScreen.tsx` conseguir comparar contra "hoje" sem
 * depender de uma chamada de rede na hora.
 *
 * Só as datas (nunca a observação) , é só o suficiente pra esse
 * comparativo, mantendo o valor pequeno (limite de ~2KB por valor no
 * SecureStore do Android).
 *
 * Duas formas de manter isso atualizado:
 * - `definirDatasFolgaAvisadasLocal` substitui a lista inteira , usada
 *   depois de buscar a lista completa do servidor (`listarAutorrelatosFolga`),
 *   sempre que houver rede.
 * - `adicionarDataFolgaAvisadaLocal`/`removerDataFolgaAvisadaLocal`
 *   ajustam uma data isoladamente , usadas depois de avisar ou anular
 *   uma folga, sem precisar rebuscar a lista inteira do servidor.
 */
const CHAVE_DATAS_FOLGA_AVISADAS = "fvfhorus.folga.datasAvisadas";
const MAXIMO_DATAS_GUARDADAS = 40;

export async function obterDatasFolgaAvisadasLocal(): Promise<string[]> {
  const bruto = await SecureStore.getItemAsync(CHAVE_DATAS_FOLGA_AVISADAS);
  if (!bruto) return [];
  try {
    const lista = JSON.parse(bruto);
    return Array.isArray(lista)
      ? lista.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export async function definirDatasFolgaAvisadasLocal(
  datas: string[],
): Promise<void> {
  const unicas = Array.from(new Set(datas)).slice(0, MAXIMO_DATAS_GUARDADAS);
  await SecureStore.setItemAsync(
    CHAVE_DATAS_FOLGA_AVISADAS,
    JSON.stringify(unicas),
  );
}

export async function adicionarDataFolgaAvisadaLocal(
  data: string,
): Promise<void> {
  const atuais = await obterDatasFolgaAvisadasLocal();
  if (atuais.includes(data)) return;
  await definirDatasFolgaAvisadasLocal([...atuais, data]);
}

export async function removerDataFolgaAvisadaLocal(
  data: string,
): Promise<void> {
  const atuais = await obterDatasFolgaAvisadasLocal();
  await definirDatasFolgaAvisadasLocal(atuais.filter((d) => d !== data));
}
