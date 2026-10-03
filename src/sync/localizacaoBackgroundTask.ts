import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  inserirAmostraLocalizacao,
  ultimoTipoEventoRelevanteRegistrado,
} from "../storage/db";
import { sincronizarAmostrasLocalizacao } from "./localizacaoSyncService";

/**
 * Amostragem de GPS em segundo plano ("luneta"), recurso antifraude
 * complementar aos pontos batidos , ajuda a distinguir, por exemplo,
 * um trecho de direção curto que volta pro mesmo lugar (deslocamento
 * líquido baixo, mas percorreu distância real no meio) de alguém
 * fingindo estar dirigindo parado no mesmo lugar.
 *
 * Histórico da implementação (pra não perder o raciocínio):
 * - Rodada 46: baixo consumo via `expo-location`, rodando o tempo
 *   todo enquanto a permissão "Sempre" estivesse concedida.
 * - Rodada 47: trocada por lib nativa paga (revertido na Rodada 48 ,
 *   ver `claude/rodada-48-...md`, custo não aprovado).
 * - Rodada 49 (aqui): duas mudanças pedidas pelo usuário ,
 *   (1) a amostragem só fica ARMADA durante o trecho de direção
 *   (entre "Início de direção" e "Fim de direção"), não mais o tempo
 *   todo , fora disso o SO não fica escutando nada, zero consumo.
 *   Quem liga/desliga é a tela de registrar ponto
 *   (`RegistrarPontoScreen.tsx`), chamando `iniciarAmostragemDirecao`/
 *   `pararAmostragemDirecao` a cada evento relevante; `retomarSeDirigindo`
 *   cobre o caso de reabrir o app no meio de um trecho de direção já
 *   em andamento (senão a amostragem ficaria "esquecida" desligada até
 *   o próximo Início de direção).
 * - Rodada 51: dentro da janela de direção, o gatilho da amostra
 *   trocou de distância (a cada ~300m) pra TEMPO (a cada 15min) ,
 *   pedido do usuário. Um mapa ao vivo com a posição de todos os
 *   motoristas (que motivou a pergunta sobre esse intervalo) foi
 *   avaliado e CANCELADO pelo próprio usuário nesta mesma rodada: os
 *   provedores de mapa viáveis (OpenStreetMap grátis com ressalva de
 *   uso justo, ou MapTiler/Mapbox pagos acima de um certo volume) não
 *   pareceram sustentáveis em escala pra ele , ver a resposta da
 *   Rodada 51 na conversa. As amostras a cada 15min continuam sendo
 *   gravadas e sincronizadas normalmente mesmo sem um mapa consumindo
 *   esse dado agora; só não existe hoje nenhuma tela que as visualize.
 *   (2) a permissão "Sempre" deixou de ser opcional: sem ela, o
 *   motorista não consegue bater ponto (ver `obterPermissaoSempre` e o
 *   uso dela em `RegistrarPontoScreen.tsx`). Decisão explícita do
 *   usuário , vale registrar que isso é o oposto da postura das
 *   Rodadas 45/46 (que mantinham a permissão "Sempre" opcional
 *   justamente pra reduzir o risco de reprovação na revisão das lojas,
 *   que escrutina pesado apps que exigem localização em segundo plano
 *   como pré-requisito de uso). O código está pronto, mas esse risco
 *   de revisão continua valendo e não foi eliminado, só aceito.
 * - Rodada 104: se o veículo vinculado já tem um rastreador dedicado
 *   cadastrado (campo "ID do rastreador"), a amostragem durante a
 *   direção NÃO liga , o rastreador do veículo já cobre esse dado,
 *   ligar o GPS do celular também seria desperdício de bateria. Ver
 *   `temRastreadorDedicado` em `iniciarAmostragemDirecao`/
 *   `retomarAmostragemSeDirigindo` e o check feito em
 *   `RegistrarPontoScreen.tsx`/`App.tsx`. O GPS do celular continua
 *   normal nos eventos de "bater ponto" (localização de cada
 *   registro), isso não muda.
 */
const NOME_TASK_LOCALIZACAO = "fvf-horus-amostra-localizacao-background";

TaskManager.defineTask(NOME_TASK_LOCALIZACAO, async ({ data, error }) => {
  if (error || !data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  const posicao = locations?.[locations.length - 1];
  if (!posicao) return;

  try {
    inserirAmostraLocalizacao({
      idLocal: Crypto.randomUUID(),
      latitude: posicao.coords.latitude,
      longitude: posicao.coords.longitude,
      precisaoGpsM: posicao.coords.accuracy ?? null,
      capturadoEm: new Date(posicao.timestamp).toISOString(),
    });

    // Tenta esvaziar a fila na mesma execução , se não houver rede,
    // fica pendente e tenta de novo na próxima amostra.
    await sincronizarAmostrasLocalizacao();
  } catch {
    // Falha ao gravar/sincronizar não derruba a task , a próxima
    // atualização de posição tenta de novo.
  }
});

/**
 * Permissão de localização "Sempre"/"o tempo todo" (background) ,
 * Rodada 49: passou a ser OBRIGATÓRIA pra usar o app (antes era
 * opcional, ver histórico acima). Segue o mesmo padrão de
 * `obterPermissaoLocalizacao` (foreground) em `RegistrarPontoScreen`:
 * pede na hora se ainda for possível perguntar; se já foi negada
 * permanentemente, só resta abrir os Ajustes do aparelho (quem chama
 * decide o que fazer com o status retornado).
 *
 * No Android/iOS, só faz sentido pedir "Sempre" depois da permissão
 * "ao usar o app" já concedida , por isso `RegistrarPontoScreen`
 * sempre chama a checagem de foreground antes desta.
 */
export async function obterPermissaoLocalizacaoSempre(): Promise<Location.PermissionStatus> {
  const atual = await Location.getBackgroundPermissionsAsync();
  if (atual.status === Location.PermissionStatus.GRANTED) return atual.status;
  if (!atual.canAskAgain) return atual.status;
  const pedido = await Location.requestBackgroundPermissionsAsync();
  return pedido.status;
}

const INTERVALO_AMOSTRAGEM_MS = 15 * 60 * 1000; // 15 minutos

async function iniciarTaskDeAmostragem(): Promise<void> {
  const jaIniciado = await Location.hasStartedLocationUpdatesAsync(
    NOME_TASK_LOCALIZACAO,
  );
  if (jaIniciado) return;

  await Location.startLocationUpdatesAsync(NOME_TASK_LOCALIZACAO, {
    // Baixa energia: prioriza rede/torres de celular sobre o rádio de
    // GPS contínuo. Suficiente pra amostragem antifraude (não precisa
    // da precisão fina usada no "bater ponto").
    accuracy: Location.Accuracy.Low,
    // Rodada 51 , pedido do usuário: trocado de gatilho por distância
    // (a cada ~300m) pra gatilho por TEMPO, a cada 15min, enquanto
    // durar o trecho de direção. `distanceInterval: 0` desliga o
    // filtro por distância; `timeInterval` (Android) e
    // `deferredUpdatesInterval` (iOS, que não tem um "tempo mínimo"
    // nativo pra updates em primeiro plano , o equivalente prático é
    // agrupar/entregar a cada N ms) são os dois jeitos de expressar
    // "a cada 15 minutos" nas duas plataformas.
    distanceInterval: 0,
    timeInterval: INTERVALO_AMOSTRAGEM_MS,
    deferredUpdatesInterval: INTERVALO_AMOSTRAGEM_MS,
    showsBackgroundLocationIndicator: false,
    // false porque quem liga/desliga a task já é o app (por evento de
    // Início/Fim de direção) , não queremos que o próprio SO pause
    // por conta própria e atrase a retomada quando o veículo volta a
    // se mover dentro do mesmo trecho.
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
  });
}

/**
 * Chamada ao registrar "Início de direção" , liga a amostragem (a cada
 * 15min, ver `INTERVALO_AMOSTRAGEM_MS`) só pra essa janela. Se a
 * permissão "Sempre" não estiver concedida, não faz nada (mas isso não
 * deveria acontecer na prática: `RegistrarPontoScreen` já bloqueia
 * bater ponto sem ela).
 *
 * Rodada 104 , pedido do usuário: se o veículo já tem um rastreador
 * dedicado cadastrado (campo "ID do rastreador" em Veículo vinculado),
 * o GPS do celular do motorista fica de fora dessa amostragem
 * contínua durante a direção , o rastreador do veículo já cobre esse
 * dado, duplicar com o GPS do celular é desperdício de bateria. O GPS
 * do celular continua sendo usado normalmente nos próprios eventos de
 * "bater ponto" (`capturarLocalizacao` em `RegistrarPontoScreen`,
 * função separada desta), pra gravar a localização de cada registro ,
 * isso não muda. `temRastreadorDedicado` é decidido por quem chama
 * (ver `veiculo?.idRastreador` em `RegistrarPontoScreen.tsx`).
 */
export async function iniciarAmostragemDirecao(
  temRastreadorDedicado = false,
): Promise<void> {
  try {
    if (temRastreadorDedicado) return;
    const permissao = await Location.getBackgroundPermissionsAsync();
    if (permissao.status !== Location.PermissionStatus.GRANTED) return;
    await iniciarTaskDeAmostragem();
  } catch (err) {
    console.warn(
      "Não foi possível iniciar amostragem de localização em background",
      err,
    );
  }
}

/**
 * Chamada ao registrar "Fim de direção" , desliga a amostragem, zero
 * consumo até o próximo "Início de direção".
 */
export async function pararAmostragemDirecao(): Promise<void> {
  try {
    const jaIniciado = await Location.hasStartedLocationUpdatesAsync(
      NOME_TASK_LOCALIZACAO,
    );
    if (!jaIniciado) return;
    await Location.stopLocationUpdatesAsync(NOME_TASK_LOCALIZACAO);
  } catch (err) {
    console.warn(
      "Não foi possível parar amostragem de localização em background",
      err,
    );
  }
}

/**
 * Chamada ao abrir o app (ver `App.tsx`) , cobre o caso de o
 * motorista ter fechado/reaberto o app (ou o sistema ter matado o
 * processo) no meio de um trecho de direção já iniciado: sem isso, a
 * amostragem ficaria desarmada até o próximo "Início de direção", já
 * que o `startLocationUpdatesAsync` da vez anterior não sobrevive ao
 * processo ser encerrado de verdade pelo SO.
 */
export async function retomarAmostragemSeDirigindo(
  temRastreadorDedicado = false,
): Promise<void> {
  try {
    if (temRastreadorDedicado) return;
    if (ultimoTipoEventoRelevanteRegistrado() !== "INICIO_DIRECAO") return;
    const permissao = await Location.getBackgroundPermissionsAsync();
    if (permissao.status !== Location.PermissionStatus.GRANTED) return;
    await iniciarTaskDeAmostragem();
  } catch (err) {
    console.warn(
      "Não foi possível retomar amostragem de localização em background",
      err,
    );
  }
}
