import * as SecureStore from "expo-secure-store";

/**
 * Estado local (só neste aparelho) do alerta de estouro de jornada
 * "tipo ligação": quais alertas já tocaram (pra não ficar tocando de
 * novo o mesmo alerta a cada rodada de polling) e se o motorista
 * silenciou o toque. Usa SecureStore só por já ser a única
 * dependência de armazenamento local do projeto (ver
 * theme/ThemeContext.tsx) , nada aqui é sensível, é só pra não somar
 * mais uma dependência nova.
 */

const CHAVE_SILENCIADO = "fvfhorus.alertaJornada.silenciado";
const CHAVE_JA_TOCADOS = "fvfhorus.alertaJornada.jaTocados";
const MAXIMO_IDS_GUARDADOS = 30;

export async function alertaSilenciado(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CHAVE_SILENCIADO)) === "1";
}

export async function definirAlertaSilenciado(
  silenciado: boolean,
): Promise<void> {
  await SecureStore.setItemAsync(CHAVE_SILENCIADO, silenciado ? "1" : "0");
}

async function obterIdsJaTocados(): Promise<string[]> {
  const bruto = await SecureStore.getItemAsync(CHAVE_JA_TOCADOS);
  if (!bruto) return [];
  try {
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export async function alertaJaTocado(alertaId: string): Promise<boolean> {
  const ids = await obterIdsJaTocados();
  return ids.includes(alertaId);
}

/** Marca como "já tocado" ANTES de disparar a vibração , evita que uma segunda leitura do polling toque o mesmo alerta de novo. */
export async function marcarAlertaComoTocado(alertaId: string): Promise<void> {
  const ids = await obterIdsJaTocados();
  if (ids.includes(alertaId)) return;
  const atualizados = [...ids, alertaId].slice(-MAXIMO_IDS_GUARDADOS);
  await SecureStore.setItemAsync(CHAVE_JA_TOCADOS, JSON.stringify(atualizados));
}

/**
 * "Limpar histórico de alertas" (Rodada 39, pedido do usuário) , apaga
 * só o que fica guardado NESTE aparelho (a lista de "já tocados",
 * já limitada a 30 ids, e a preferência de silenciado). A tela de
 * Alertas em si (AlertasScreen) nunca guarda os alertas , ela sempre
 * busca a lista atual do backend, então não há nada "pesado" pra
 * apagar de verdade; isto existe pra dar ao motorista um controle
 * explícito sobre o que o aparelho guarda, e como efeito colateral
 * (intencional) os alertas já tratados podem tocar de novo até serem
 * detectados como resolvidos.
 */
export async function limparHistoricoAlertaJornadaLocal(): Promise<void> {
  await SecureStore.deleteItemAsync(CHAVE_JA_TOCADOS);
  await SecureStore.deleteItemAsync(CHAVE_SILENCIADO);
}

/**
 * Rodada 50 , pedido do usuário: ao tocar em "Limpar histórico" na tela
 * de Alertas, a lista visível precisa mesmo sumir (antes não sumia nada
 * , essa função aqui embaixo não existia e o botão só mexia nas duas
 * chaves acima, que não afetam o que aparece na tela). Guarda, só neste
 * aparelho, o timestamp do alerta mais recente no momento da limpeza ,
 * a tela (`AlertasScreen`) esconde tudo com `createdAt` até esse
 * instante e volta a mostrar normalmente qualquer alerta mais novo que
 * chegar depois. Não apaga nada do servidor: os alertas continuam
 * existindo no sistema da empresa, isso é só uma preferência de
 * exibição local.
 */
const CHAVE_ALERTAS_LIMPOS_ATE = "fvfhorus.alertaJornada.limposAte";

export async function obterAlertasLimposAte(): Promise<string | null> {
  return SecureStore.getItemAsync(CHAVE_ALERTAS_LIMPOS_ATE);
}

export async function definirAlertasLimposAte(
  timestampMaisRecenteISO: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    CHAVE_ALERTAS_LIMPOS_ATE,
    timestampMaisRecenteISO,
  );
}

/**
 * Rodada 54 , indicador de "tem coisa nova" (ícone de notificação) no
 * botão "Menu" e no item "Alertas" dentro dele, agora que Alertas saiu
 * da barra principal e foi pro menu lateral , distinto de `limposAte`
 * (que é sobre esconder da lista, Rodada 50): isto aqui nunca esconde
 * nada, só controla a bolinha vermelha.
 *
 * Rodada 55 , ajuste sobre a Rodada 54: no começo, só ABRIR a aba
 * Alertas (carregar a lista) já marcava tudo como visto, e a bolinha
 * sumia mesmo sem o motorista ter aberto nenhum alerta de fato. Agora
 * o que zera a bolinha de um alerta é abrir ELE (tocar pra ver o
 * detalhe) , pedido do usuário: "o ícone de notificação deve ficar nos
 * alertas que chegaram por último e não foi aberto".
 *
 * Guarda dois pedaços, só neste aparelho:
 * - `vistoAte`: um "carimbo d'água" , todo alerta com `createdAt` até
 *   aqui já foi confirmado aberto, individualmente, em algum momento.
 * - `abertosRecentes`: ids dos alertas MAIS NOVOS que `vistoAte` que já
 *   foram abertos, mas ainda falta abrir outros da mesma faixa (por
 *   isso o carimbo não avançou ainda). Fica pequeno na prática , só os
 *   alertas novos ainda não todos abertos , e quando os alertas mais
 *   novos que `vistoAte` acabam TODOS abertos, o carimbo avança e essa
 *   lista é zerada. Isso evita crescer sem limite (o SecureStore no
 *   Android tem limite de ~2KB por valor guardado).
 */
const CHAVE_ALERTAS_VISTO_ATE = "fvfhorus.alertaJornada.vistosAte"; // chave reaproveitada da Rodada 54
const CHAVE_ALERTAS_ABERTOS_RECENTES = "fvfhorus.alertaJornada.abertosRecentes";

export async function obterAlertasVistoAte(): Promise<string | null> {
  return SecureStore.getItemAsync(CHAVE_ALERTAS_VISTO_ATE);
}

async function definirAlertasVistoAte(
  timestampMaisRecenteISO: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    CHAVE_ALERTAS_VISTO_ATE,
    timestampMaisRecenteISO,
  );
}

export async function obterAlertasAbertosRecentes(): Promise<string[]> {
  const bruto = await SecureStore.getItemAsync(CHAVE_ALERTAS_ABERTOS_RECENTES);
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

async function definirAlertasAbertosRecentes(ids: string[]): Promise<void> {
  // Limite de segurança pro tamanho do valor no SecureStore , não deveria
  // nem chegar perto disso na prática, já que a lista é zerada sempre que
  // o motorista termina de abrir todos os alertas novos.
  await SecureStore.setItemAsync(
    CHAVE_ALERTAS_ABERTOS_RECENTES,
    JSON.stringify(ids.slice(-40)),
  );
}

/**
 * Marca um alerta como aberto de verdade (o motorista tocou nele pra
 * ver o detalhe). `todosOsAlertas` é a lista completa já carregada
 * (mais recente primeiro) , usada só pra decidir se dá pra compactar
 * (avançar o carimbo) agora que este alerta entrou na lista de abertos.
 */
export async function marcarAlertaComoAberto(
  alertaId: string,
  todosOsAlertas: { id: string; createdAt: string }[],
): Promise<void> {
  const vistoAte = await obterAlertasVistoAte();
  const novos = vistoAte
    ? todosOsAlertas.filter(
        (a) => new Date(a.createdAt).getTime() > new Date(vistoAte).getTime(),
      )
    : todosOsAlertas;

  const abertosRecentes = new Set(await obterAlertasAbertosRecentes());
  abertosRecentes.add(alertaId);

  const todosOsNovosJaAbertos = novos.every((a) => abertosRecentes.has(a.id));
  if (todosOsNovosJaAbertos && todosOsAlertas[0]) {
    await definirAlertasVistoAte(todosOsAlertas[0].createdAt);
    await definirAlertasAbertosRecentes([]);
  } else {
    await definirAlertasAbertosRecentes(Array.from(abertosRecentes));
  }
}

/**
 * Rodada 55.1 , corrige o "efeito manada" do dia em que este mecanismo
 * de "aberto/não aberto" foi introduzido: sem isso, TODO alerta que já
 * existia antes (às vezes de semanas atrás, já resolvido) contaria
 * como "não aberto" pra sempre, porque nunca passou por
 * `marcarAlertaComoAberto` , a bolinha ficaria vermelha permanentemente
 * mesmo sem nenhum alerta pendente de verdade.
 *
 * Na primeira vez que checamos (carimbo ainda nunca foi definido),
 * tratamos tudo que já existe agora como já visto , só um alerta que
 * chegar DEPOIS deste ponto é que acende a bolinha. Chamada tanto pelo
 * cálculo da bolinha (`existeAlertaNaoAberto`) quanto pela tela de
 * Alertas, pra ficarem sempre consistentes.
 */
export async function garantirCarimboInicial(
  alertas: { createdAt: string }[],
): Promise<string | null> {
  const atual = await obterAlertasVistoAte();
  if (atual || !alertas.length) return atual;
  const maisRecente = alertas.reduce((a, b) =>
    new Date(a.createdAt) > new Date(b.createdAt) ? a : b,
  ).createdAt;
  await definirAlertasVistoAte(maisRecente);
  return maisRecente;
}

/** Existe, dentre os alertas informados, algum que ainda não foi aberto? Usado pra bolinha do menu (`App.tsx`). */
export async function existeAlertaNaoAberto(
  alertas: { id: string; createdAt: string }[],
): Promise<boolean> {
  if (!alertas.length) return false;
  const [vistoAte, abertosRecentes] = await Promise.all([
    garantirCarimboInicial(alertas),
    obterAlertasAbertosRecentes(),
  ]);
  return alertas.some((a) => {
    if (
      vistoAte &&
      new Date(a.createdAt).getTime() <= new Date(vistoAte).getTime()
    )
      return false;
    return !abertosRecentes.includes(a.id);
  });
}
