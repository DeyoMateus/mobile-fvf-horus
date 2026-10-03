import * as SecureStore from "expo-secure-store";

/**
 * Estado local (só neste aparelho) de quais DECISÕES do RH sobre
 * solicitações de ajuste (aprovado/não aprovado) o motorista já viu ,
 * pedido do usuário: "o motorista não está recebendo notificação quando
 * o rh aprova ou suas solicitações mudam de status, não fica a bolinha
 * sinalizando que tem mudança". Mesmo espírito de
 * `alertaJornadaLocal.ts` (bolinha de "Alertas", Rodada 54/55), mas bem
 * mais simples: aqui não tem "abrir item individual", só "abriu a aba
 * Ajustes" (que já mostra "Minhas solicitações" com o status atual de
 * cada uma).
 */

const CHAVE_VISTO_ATE = "fvfhorus.solicitacaoAjuste.vistoAte";

export async function obterSolicitacoesVistoAte(): Promise<string | null> {
  return SecureStore.getItemAsync(CHAVE_VISTO_ATE);
}

async function definirSolicitacoesVistoAte(
  timestampIso: string,
): Promise<void> {
  await SecureStore.setItemAsync(CHAVE_VISTO_ATE, timestampIso);
}

interface SolicitacaoComDecisao {
  status: "PENDENTE" | "APROVADA" | "REJEITADA";
  decididoEm: string | null;
}

/**
 * Mesma lógica de "efeito manada" do carimbo inicial dos alertas
 * (Rodada 55.1): na primeira vez que checamos neste aparelho (carimbo
 * nunca definido), qualquer decisão já tomada ANTES de agora conta como
 * já vista , só uma decisão nova, a partir deste ponto em diante, acende
 * a bolinha.
 */
async function garantirCarimboInicial(
  solicitacoes: SolicitacaoComDecisao[],
): Promise<string | null> {
  const atual = await obterSolicitacoesVistoAte();
  if (atual) return atual;
  const decididas = solicitacoes.filter(
    (s): s is SolicitacaoComDecisao & { decididoEm: string } =>
      s.status !== "PENDENTE" && !!s.decididoEm,
  );
  const carimbo = decididas.length
    ? decididas.reduce((a, b) =>
        new Date(a.decididoEm) > new Date(b.decididoEm) ? a : b,
      ).decididoEm
    : new Date().toISOString();
  await definirSolicitacoesVistoAte(carimbo);
  return carimbo;
}

/** Existe, entre as solicitações informadas, alguma decisão do RH (aprovado/não aprovado) ainda não vista? Usado pra bolinha do menu (`App.tsx`). */
export async function existeDecisaoNaoVista(
  solicitacoes: SolicitacaoComDecisao[],
): Promise<boolean> {
  if (!solicitacoes.length) return false;
  const vistoAte = await garantirCarimboInicial(solicitacoes);
  return solicitacoes.some(
    (s) =>
      s.status !== "PENDENTE" &&
      !!s.decididoEm &&
      (!vistoAte || new Date(s.decididoEm).getTime() > new Date(vistoAte).getTime()),
  );
}

/**
 * Marca todas as decisões atuais como vistas , chamada quando o
 * motorista abre a aba "Ajustes" (já mostra "Minhas solicitações" com o
 * status de cada uma, não precisa abrir uma por uma como nos alertas).
 */
export async function marcarDecisoesComoVistas(
  solicitacoes: SolicitacaoComDecisao[],
): Promise<void> {
  const decididas = solicitacoes.filter(
    (s): s is SolicitacaoComDecisao & { decididoEm: string } =>
      s.status !== "PENDENTE" && !!s.decididoEm,
  );
  const maisRecente = decididas.length
    ? decididas.reduce((a, b) =>
        new Date(a.decididoEm) > new Date(b.decididoEm) ? a : b,
      ).decididoEm
    : new Date().toISOString();
  const atual = await obterSolicitacoesVistoAte();
  if (atual && new Date(atual).getTime() >= new Date(maisRecente).getTime()) {
    return;
  }
  await definirSolicitacoesVistoAte(maisRecente);
}
