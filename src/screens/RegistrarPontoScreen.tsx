import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { atualizarVeiculo, obterVeiculo } from "../api/veiculo";
import {
  anularAutorrelatoFolga,
  listarAutorrelatosFolga,
} from "../api/autorrelatoFolga";
import {
  anularFolgaConcedida,
  listarFolgasConcedidas,
} from "../api/folgaConcedida";
import type { TecnologiaRastreador, VeiculoVinculado } from "../api/veiculo";
import {
  estaEmTempoIndefinido,
  estaEmEstadoComCronometro,
  proximosEventosPermitidos,
  minutosFaltantesDescansoInterjornada,
  DESCANSO_INTERJORNADA_MINIMO_MIN,
  LIMITE_JORNADA_DIRECAO_ATENCAO_MIN,
  formatarHorasMin,
} from "../domain/regrasJornada";
import {
  inserirRegistro,
  obterMinutosDirecaoDaUltimaJornadaFechada,
  salvarAjusteGestorMaisRecenteSeMaisNovo,
  ultimoRegistroRelevante,
  ultimoTipoEventoRelevanteRegistrado,
  obterRegistroPorIdLocal,
} from "../storage/db";
import { listarMeusAjustes } from "../api/tratamentos";
import {
  definirDatasFolgaAvisadasLocal,
  obterDatasFolgaAvisadasLocal,
  removerDataFolgaAvisadaLocal,
} from "../storage/folgaAvisadaLocal";
import { obterCredenciais } from "../storage/secureCredentials";
import { avaliarIntegridadeDispositivo } from "../security/deviceIntegrity";
import { sincronizarLembretesDeJornada } from "../notifications/lembretesJornada";
import { sincronizarFila } from "../sync/syncService";
import {
  iniciarAmostragemDirecao,
  obterPermissaoLocalizacaoSempre,
  pararAmostragemDirecao,
} from "../sync/localizacaoBackgroundTask";
import { dataIsoParaBr, dateParaDataIso } from "../utils/mascaras";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";
import { TIPOS_EVENTO, TipoEvento } from "../types";
import {
  agoraConfiavel,
  registrarFixDeRelogio,
} from "../utils/relogioConfiavel";
import { obterElapsedRealtimeMs } from "../utils/relogioMonotonico";

function rotuloDoTipo(tipo: TipoEvento): string {
  return TIPOS_EVENTO.find((t) => t.tipo === tipo)?.rotulo ?? tipo;
}

/**
 * "01:23" (ou "25:03" se passar de 24h , jornada raramente passa disso,
 * mas não trunca). Rodada 104 , pedido do usuário: tirar os segundos e
 * atualizar só de minuto em minuto, pra não ficar piscando a tela toda
 * hora (economia de bateria/CPU; o motorista não precisa de precisão de
 * segundo aqui, só uma noção de há quanto tempo está na etapa).
 */
function formatarDuracao(ms: number): string {
  const totalMinutos = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Cronômetro: tempo decorrido desde a última etapa relevante batida
 * (ex.: desde o "Início de direção", se essa foi a última). Não é
 * enviado a lugar nenhum , é só um relógio de apoio na tela pro
 * motorista ver há quanto tempo está numa etapa, sem precisar fazer
 * conta de cabeça.
 */
function useCronometro(desde: string | null): number | null {
  // Rodada 73 , "agora" usa o desvio de relógio conhecido (ver
  // utils/relogioConfiavel.ts): se o relógio do aparelho estiver
  // adiantado/atrasado, mas já tivermos um fix de GPS recente nesta
  // sessão do app, o cronômetro mostra o tempo decorrido de verdade,
  // não o que o relógio errado do aparelho sugere.
  const [agora, setAgora] = useState(() => agoraConfiavel());

  useEffect(() => {
    if (!desde) return;
    // Rodada 104 , atualiza por minuto, não por segundo (o cronômetro
    // agora só mostra "HH:MM"). Primeiro agendamento alinhado ao
    // próximo minuto cheio, pra trocar o visor exatamente quando o
    // minuto exibido muda, não até 59s depois.
    let id: ReturnType<typeof setInterval> | null = null;
    const atraso = 60000 - (agoraConfiavel() % 60000);
    const timeout = setTimeout(() => {
      setAgora(agoraConfiavel());
      id = setInterval(() => setAgora(agoraConfiavel()), 60000);
    }, atraso);
    return () => {
      clearTimeout(timeout);
      if (id) clearInterval(id);
    };
  }, [desde]);

  if (!desde) return null;
  return agora - new Date(desde).getTime();
}

/**
 * Tela principal do motorista. Bater ponto grava LOCAL na hora (com o
 * timestamp real do toque) e só depois dispara uma tentativa de envio ,
 * o motorista nunca fica esperando rede pra continuar dirigindo.
 *
 * Captura de GPS é best-effort: se estiver sem sinal de GPS (ex.: túnel,
 * área rural sem fix), o registro é salvo mesmo assim, sem
 * latitude/longitude , não bloqueia o ponto por falta de localização.
 *
 * Os botões seguem em cascata (ver `domain/regrasJornada.ts`): só
 * aparece o que faz sentido depois do último evento relevante batido
 * neste aparelho, em vez dos 8 tipos de uma vez , evita, por exemplo,
 * apertar "Início de direção" duas vezes seguidas sem nunca fechar.
 */
interface ResultadoPonto {
  rotulo: string;
  status: "ENVIADO" | "ERRO" | "PENDENTE";
  erro?: string | null;
}

export function RegistrarPontoScreen({
  onVerHistorico,
}: {
  onVerHistorico?: () => void;
}) {
  const { cores, tema, alternarTema } = useTema();
  const estilos = criarEstilos(cores);

  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState<TipoEvento | null>(null);
  // Rodada 140 , janela de resultado depois de bater o ponto.
  const [resultadoPonto, setResultadoPonto] = useState<ResultadoPonto | null>(
    null,
  );
  const [ultimoRelevante, setUltimoRelevante] = useState<TipoEvento | null>(
    () => ultimoTipoEventoRelevanteRegistrado(),
  );
  const [desdeQuando, setDesdeQuando] = useState<string | null>(() => {
    const ultimo = ultimoRegistroRelevante();
    // Rodada 69 , pedido do usuário: o cronômetro só existe nos estados
    // que de fato guardam duração no banco (direção/descanso/espera/
    // aguardando documentação). "Início de jornada", "fim de jornada" e
    // qualquer "tempo indefinido" não contam nada em lugar nenhum ,
    // reabrir o app nesses estados não pode fazer parecer que está
    // contando.
    if (!ultimo || !estaEmEstadoComCronometro(ultimo.tipoEvento)) return null;
    return ultimo.timestampEvento;
  });

  const [veiculo, setVeiculo] = useState<VeiculoVinculado | null>(null);
  const [modalVeiculoAberto, setModalVeiculoAberto] = useState(false);
  const [placaModal, setPlacaModal] = useState("");
  const [salvandoVeiculo, setSalvandoVeiculo] = useState(false);

  // Rodada 111 , pedido do usuário: a observação deixou de ficar fixa
  // na tela (ficava sempre visível acima dos botões, sem deixar claro
  // a qual evento ela ia se aplicar) e passou a aparecer só dentro do
  // próprio popup de confirmação do ponto, junto com "Confirmar"/
  // "Cancelar" , guarda qual evento está pendente de confirmação (null
  // = popup fechado).
  const [confirmacaoPonto, setConfirmacaoPonto] = useState<{
    tipoEvento: TipoEvento;
    rotulo: string;
    horarioExibido: string;
    flagsIntegridadeDispositivo: string[];
  } | null>(null);

  const cronometroMs = useCronometro(desdeQuando);

  // Rodada 68 , pedido do usuário: enquanto a jornada está aberta mas
  // nenhuma etapa foi escolhida (direção/descanso/espera), esse tempo
  // não pode parecer "igual" ao de uma etapa normal , vira um aviso
  // visual fixo, pra não deixar o motorista pensar que já está
  // contando corretamente sem ter escolhido nada.
  const emTempoIndefinido = estaEmTempoIndefinido(ultimoRelevante);

  const permitidos = proximosEventosPermitidos(ultimoRelevante);
  // Rodada 63 , "Aguardando documentação" (OUTRO) virou um status de
  // verdade na máquina de estados (ver domain/regrasJornada.ts), então
  // agora aparece igual a qualquer outro botão da cascata, sem lógica
  // de visibilidade separada.
  const botoesPrincipais = TIPOS_EVENTO.filter((t) =>
    permitidos.includes(t.tipo),
  );

  useEffect(() => {
    obterCredenciais().then(async (credenciais) => {
      if (!credenciais) return;
      try {
        const atual = await obterVeiculo(credenciais);
        setVeiculo(atual);
      } catch {
        // Sem rede agora , a tela funciona sem mostrar o veículo, não bloqueia nada.
      }

      // Rodada 88 , achado do usuário: um "Fim de jornada" (ou qualquer
      // outro tipo) lançado pelo gestor na plataforma vira um
      // TratamentoPonto no backend, nunca um toque local neste
      // aparelho , sem isto, a tela ficava travada no estado de antes
      // do ajuste, achando que a jornada ainda estava aberta. Busca os
      // ajustes (mesmo endpoint da tela "Meus ajustes"), guarda o mais
      // recente localmente (funciona offline depois desta primeira
      // busca) e recalcula o estado da tela na hora, sem precisar
      // reabrir o app.
      try {
        const ajustes = await listarMeusAjustes(credenciais);
        // Rodada 88.1 , escolhe o ajuste mais recente por `createdAt`
        // (quando foi CRIADO no servidor, nunca editável), não por
        // `timestampEvento` (data que o gestor escolhe manualmente ao
        // lançar o ajuste , pode ser antiga/incomum, ex.: correção de um
        // esquecimento de dias atrás). Usar `timestampEvento` aqui
        // escolheria o ajuste errado sempre que o motorista tiver mais
        // de um, e o mesmo raciocínio se aplica à comparação feita
        // dentro de `salvarAjusteGestorMaisRecenteSeMaisNovo`.
        const maisRecente = ajustes.reduce<(typeof ajustes)[number] | null>(
          (acc, cur) => {
            if (!acc) return cur;
            return new Date(cur.createdAt).getTime() >
              new Date(acc.createdAt).getTime()
              ? cur
              : acc;
          },
          null,
        );
        if (maisRecente) {
          salvarAjusteGestorMaisRecenteSeMaisNovo({
            tratamentoId: maisRecente.id,
            tipoEvento: maisRecente.tipoEvento as TipoEvento,
            timestampEvento: maisRecente.timestampEvento,
            criadoEmServidor: maisRecente.createdAt,
          });
          const relevanteAtualizado = ultimoTipoEventoRelevanteRegistrado();
          setUltimoRelevante(relevanteAtualizado);
          const registroAtualizado = ultimoRegistroRelevante();
          setDesdeQuando(
            registroAtualizado &&
              estaEmEstadoComCronometro(registroAtualizado.tipoEvento)
              ? registroAtualizado.timestampEvento
              : null,
          );
        }
      } catch {
        // Sem rede agora , segue com o que já estava salvo localmente
        // (se já tiver sincronizado alguma vez antes).
      }

      // Rodada 57/58 , atualiza o cache local de "dias marcados como
      // folga" (ver `storage/folgaAvisadaLocal.ts`) sempre que a tela
      // abre e tem rede: é esse cache que permite avisar o motorista,
      // MESMO OFFLINE, se ele tentar bater ponto num dia de folga (ver
      // `confirmarERegistrar`) , tanto folga que ele mesmo avisou
      // quanto folga que a empresa concedeu (mesmo tratamento, pedido
      // do usuário). Sem rede agora, mantém o que já estava guardado
      // da última vez.
      try {
        const [avisadas, concedidas] = await Promise.all([
          listarAutorrelatosFolga(credenciais),
          listarFolgasConcedidas(credenciais),
        ]);
        const todasAsDatas = [
          ...avisadas.map((f) => f.data),
          ...concedidas.map((f) => f.data),
        ].map((d) => d.slice(0, 10));
        await definirDatasFolgaAvisadasLocal(todasAsDatas);
      } catch {
        // Sem rede agora , segue com o cache local que já existia.
      }
    });
  }, []);

  /**
   * Rodada 45 , pedido explícito do usuário: "sem a localização não
   * tem como bater ponto". A localização usada aqui é sempre "ao usar
   * o app" (foreground) , nunca a permissão "Sempre"/background (essa
   * é só da amostragem periódica antifraude, um recurso à parte, ver
   * `sync/localizacaoBackgroundTask.ts`).
   *
   * Pede a permissão na hora, se ainda não foi concedida (Android e
   * iOS mostram o diálogo nativo do sistema aqui). Se a pessoa já
   * negou permanentemente antes (`canAskAgain === false`), o sistema
   * operacional não deixa pedir de novo por código , nesse caso a
   * única saída é abrir os Ajustes do aparelho, o que o chamador
   * oferece fazer.
   */
  async function obterPermissaoLocalizacao(): Promise<Location.PermissionStatus> {
    const atual = await Location.getForegroundPermissionsAsync();
    if (atual.status === Location.PermissionStatus.GRANTED) return atual.status;
    if (!atual.canAskAgain) return atual.status;
    const pedido = await Location.requestForegroundPermissionsAsync();
    return pedido.status;
  }

  /**
   * Com a permissão já garantida por `obterPermissaoLocalizacao()`,
   * tenta obter a posição atual. Se o GPS físico falhar num instante
   * específico (sem sinal ainda, indoors, timeout) , diferente de
   * permissão negada , o ponto ainda é registrado sem coordenadas: a
   * exigência do usuário é sobre a PERMISSÃO estar concedida, não uma
   * garantia de fix de GPS em todo single toque (isso deixaria o
   * motorista sem conseguir bater ponto nenhum num galpão fechado,
   * por exemplo).
   */
  async function capturarLocalizacao(): Promise<{
    latitude?: number;
    longitude?: number;
    precisaoGpsM?: number;
    timestampGpsMs?: number;
  }> {
    try {
      const posicao = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      // Rodada 73 , pedido do usuário: o horário do evento não pode
      // confiar só no relógio do sistema do aparelho (fácil de
      // adiantar/atrasar manualmente). `posicao.timestamp` vem do
      // próprio provedor de localização (GPS/rede), independente do
      // relógio do sistema , atualiza o desvio conhecido pro
      // cronômetro (useCronometro acima) e devolve pro caller usar
      // como timestampEvento em vez de `new Date()`.
      registrarFixDeRelogio(posicao.timestamp);
      return {
        latitude: posicao.coords.latitude,
        longitude: posicao.coords.longitude,
        precisaoGpsM: posicao.coords.accuracy ?? undefined,
        timestampGpsMs: posicao.timestamp,
      };
    } catch {
      return {};
    }
  }

  async function registrarEvento(
    tipoEvento: TipoEvento,
    flagsIntegridadeDispositivo: string[] = [],
  ) {
    // Se já tem um registro em andamento, ignora , evita duplicar caso
    // o toque de confirmação dispare mais de uma vez (ex.: duplo toque
    // rápido no botão "Confirmar" do alerta nativo).
    if (enviando !== null) return;

    setEnviando(tipoEvento);
    try {
      // Rodada 73 , captura a localização ANTES de fixar "agora": se o
      // GPS devolver um timestamp de fix válido, ele é a fonte de
      // verdade do horário do evento (não o relógio do sistema do
      // aparelho, que o motorista pode adiantar/atrasar manualmente).
      // Sem fix de GPS (ex.: aparelho sem sinal ainda), cai de volta
      // pro relógio do sistema , mesmo comportamento de sempre, só não
      // é mais a ÚNICA fonte quando o GPS está disponível.
      const localizacao = await capturarLocalizacao();

      // Rodada 138 , o próprio app detecta relógio adulterado: se a hora
      // do aparelho diverge da hora confiável (servidor/GPS) por mais de
      // 5 min, NÃO registra o ponto , avisa o motorista na hora, em vez
      // de criar um registro que o servidor vai rejeitar depois.
      const divergenciaMs = Math.abs(Date.now() - agoraConfiavel());
      if (divergenciaMs > 5 * 60 * 1000) {
        Alert.alert(
          "Relógio do aparelho incorreto",
          "A hora do seu celular está diferente da hora real. O ponto NÃO foi registrado. Ative a data e hora automáticas nas configurações do aparelho e tente de novo. Essa tentativa foi identificada como possível fraude.",
        );
        return;
      }

      const agora = localizacao.timestampGpsMs
        ? new Date(localizacao.timestampGpsMs).toISOString()
        : new Date().toISOString();

      // Rodada 88 , capturado no mesmo instante do toque, junto com o
      // resto do evento (ver utils/relogioMonotonico.ts , `null` se o
      // módulo nativo não estiver disponível, ex.: Expo Go).
      const elapsedRealtimeMs = obterElapsedRealtimeMs();

      // Rodada 146 , fuso do aparelho no instante do toque (minutos a leste
      // do UTC). Offline-safe: vai junto com o evento e o servidor corta
      // dia/noturno por ele, conferindo com o GPS.
      const fusoOffsetMin = -new Date(agora).getTimezoneOffset();

      const idLocalNovo = Crypto.randomUUID();
      await inserirRegistro({
        idLocal: idLocalNovo,
        tipoEvento,
        timestampEvento: agora,
        latitude: localizacao.latitude ?? null,
        longitude: localizacao.longitude ?? null,
        precisaoGpsM: localizacao.precisaoGpsM ?? null,
        observacao: observacao.trim() || null,
        flagsIntegridadeDispositivo: flagsIntegridadeDispositivo.length
          ? flagsIntegridadeDispositivo
          : null,
        elapsedRealtimeMs,
        fusoOffsetMin,
        status: "PENDENTE",
        tentativas: 0,
        criadoEm: agora,
      });

      // Rodada 63 , "Aguardando documentação" (OUTRO) agora conta como
      // qualquer outro estado: atualiza o último relevante e o
      // cronômetro passa a contar "desde aguardando documentação".
      // Registrar QUALQUER ação depois (início de direção, de descanso,
      // de espera, ou fim de jornada) marca implicitamente o fim desse
      // período , não existe um botão de "fim de aguardando
      // documentação" separado, de propósito.
      setUltimoRelevante(tipoEvento);
      // Rodada 69 , o cronômetro só liga quando o evento registrado é um
      // dos que de fato guardam duração (início de direção/descanso/
      // espera/aguardando documentação). Todo o resto , início de
      // jornada, fim de jornada, e os "fim de etapa" que abrem tempo
      // indefinido , some o número e deixa só o aviso.
      setDesdeQuando(estaEmEstadoComCronometro(tipoEvento) ? agora : null);

      // Rodada 49 , a amostragem de GPS antifraude ("luneta") só
      // fica armada durante o trecho de direção: liga no Início,
      // desliga no Fim. Fora dessa janela o SO não fica escutando
      // posição nenhuma.
      if (tipoEvento === "INICIO_DIRECAO") {
        // Rodada 104 , com rastreador dedicado no veículo, não liga o
        // GPS contínuo do celular (ver comentário em
        // `iniciarAmostragemDirecao`).
        void iniciarAmostragemDirecao(Boolean(veiculo?.idRastreador));
      } else if (tipoEvento === "FIM_DIRECAO") {
        void pararAmostragemDirecao();
      }
      setObservacao("");

      // Rodada 137 , se o backend rejeitar (ERRO), o estado da tela volta
      // pro último registro VÁLIDO em vez de seguir o ponto rejeitado.
      // Rodada 140 , espera o envio (até 8s, com o "Registrando ponto..."
      // na tela) pra poder mostrar o resultado de verdade: registrado,
      // não registrado (com o motivo) ou salvo aguardando internet.
      await Promise.race([
        sincronizarFila().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      setUltimoRelevante(ultimoTipoEventoRelevanteRegistrado());
      const u = ultimoRegistroRelevante();
      setDesdeQuando(
        u && estaEmEstadoComCronometro(u.tipoEvento) ? u.timestampEvento : null,
      );
      void sincronizarLembretesDeJornada();
      const salvo = await obterRegistroPorIdLocal(idLocalNovo);
      setResultadoPonto({
        rotulo: rotuloDoTipo(tipoEvento),
        status:
          salvo?.status === "ENVIADO"
            ? "ENVIADO"
            : salvo?.status === "ERRO"
              ? "ERRO"
              : "PENDENTE",
        erro: salvo?.ultimoErro ?? null,
      });
      // Sucesso: `enviando` só é liberado no finally, mas o botão desse
      // tipo já some da lista (cascata avança), então não há como
      // apertar de novo o mesmo evento , só um evento novo, diferente.
    } catch (err) {
      // Erro de verdade (ex.: banco local falhou ao gravar): avisa o
      // motorista e libera o botão pra tentar de novo , é o único caso
      // em que faz sentido deixar apertar outra vez o mesmo evento.
      Alert.alert(
        "Não foi possível registrar",
        err instanceof Error && err.message
          ? err.message
          : "Não deu pra salvar o ponto agora. Tente apertar novamente.",
      );
    } finally {
      setEnviando(null);
    }
  }

  /**
   * Rodada 57 , pedido do usuário: se o motorista tenta bater ponto num
   * dia que ele mesmo avisou como folga, avisa ele disso ANTES de
   * seguir com as checagens de sempre , e deixa ele decidir. Não
   * bloqueia (é um aviso, não uma trava): se ele confirmar "Continuar",
   * a folga daquele dia é anulada (no servidor, e no cache local) e o
   * fluxo normal de registro continua dali.
   *
   * Usa o cache local (`obterDatasFolgaAvisadasLocal`), não uma
   * chamada de rede na hora , funciona mesmo sem sinal, que é
   * justamente quando o motorista mais bate ponto em rota.
   */
  async function confirmarERegistrar(tipoEvento: TipoEvento, rotulo: string) {
    if (enviando !== null) return;

    // Rodada 71 , pedido do usuário: a lei não impede o motorista de
    // iniciar outra jornada sem cumprir o descanso interjornada mínimo
    // (11h desde o "Fim de jornada" anterior), mas ele precisa VER e
    // entender isso, e confirmar que quer mesmo seguir assim , o
    // gestor já é avisado à parte pelo alerta crítico que o backend
    // gera nesse mesmo evento (ver JornadaLegalService.avaliarDescansoInterjornada).
    if (tipoEvento === "INICIO_JORNADA") {
      const ultimo = ultimoRegistroRelevante();
      if (ultimo && ultimo.tipoEvento === "FIM_JORNADA") {
        // Rodada 134 , pedido do usuário: "por acidente ele pode
        // finalizar a jornada antes do fim do dia e iniciar outra não
        // tem problema... o aviso deve aparecer se ele já cumpriu as
        // horas determinadas por lei". Se a jornada anterior NÃO
        // chegou a somar 8h de direção, essa nova jornada é só um
        // complemento dela (não uma jornada nova de verdade) , não
        // mostra o aviso, mesmo mecanismo do backend (ver
        // JornadaLegalService.avaliarDescansoInterjornada). Quando não
        // dá pra saber com certeza (histórico local incompleto),
        // mostra o aviso mesmo assim , o lado mais seguro.
        const direcaoJornadaAnteriorMin =
          obterMinutosDirecaoDaUltimaJornadaFechada();
        const jornadaAnteriorIncompleta =
          direcaoJornadaAnteriorMin !== null &&
          direcaoJornadaAnteriorMin < LIMITE_JORNADA_DIRECAO_ATENCAO_MIN;

        // Rodada 73 , mesmo raciocínio do cronômetro: usa o desvio de relógio conhecido (GPS), não o relógio crú do aparelho.
        const faltamMin = jornadaAnteriorIncompleta
          ? null
          : minutosFaltantesDescansoInterjornada(
              ultimo.timestampEvento,
              agoraConfiavel(),
            );
        if (faltamMin !== null) {
          const descansadoMin = DESCANSO_INTERJORNADA_MINIMO_MIN - faltamMin;
          Alert.alert(
            "Descanso entre jornadas abaixo do mínimo legal",
            `Você descansou apenas ${formatarHorasMin(descansadoMin)} desde o fim da sua última jornada. ` +
              `A Lei do Motorista exige um descanso mínimo de 11:00 entre jornadas , ainda faltam ` +
              `${formatarHorasMin(faltamMin)} para completar esse mínimo.

` +
              `A lei não impede o registro, então você pode continuar mesmo assim, mas isso vai gerar ` +
              `um alerta crítico visível para o gestor da sua empresa.

` +
              `Você realmente quer iniciar outra jornada agora, sem completar o descanso mínimo?`,
            [
              { text: "Cancelar", style: "cancel" },
              {
                text: "Sim, iniciar mesmo assim",
                style: "destructive",
                onPress: () => void prosseguirComRegistro(tipoEvento, rotulo),
              },
            ],
          );
          return;
        }
      }
    }

    void prosseguirComRegistro(tipoEvento, rotulo);
  }

  async function prosseguirComRegistro(tipoEvento: TipoEvento, rotulo: string) {
    const hoje = dateParaDataIso(new Date());
    const datasFolga = await obterDatasFolgaAvisadasLocal();
    if (datasFolga.includes(hoje)) {
      Alert.alert(
        "Hoje está marcado como folga",
        `${dataIsoParaBr(hoje)} está marcado como folga (avisada por você ou concedida pela empresa). Se continuar e registrar "${rotulo}", essa folga será anulada no sistema , o dia passa a contar como trabalhado, não mais como folga, e o gestor vai ser avisado.`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Continuar e anular a folga",
            style: "destructive",
            onPress: () =>
              void continuarAnulandoFolga(tipoEvento, rotulo, hoje),
          },
        ],
      );
      return;
    }

    void seguirComRegistro(tipoEvento, rotulo);
  }

  async function continuarAnulandoFolga(
    tipoEvento: TipoEvento,
    rotulo: string,
    hoje: string,
  ) {
    const credenciais = await obterCredenciais();
    if (credenciais) {
      // Rodada 58 , o cache local não distingue qual dos dois tipos
      // de folga é (o motorista mesmo avisou, ou a empresa concedeu),
      // então tenta anular nos dois , cada endpoint é idempotente (não
      // é erro anular um dia que não tinha aquele tipo específico de
      // folga), então não tem problema chamar os dois sempre.
      await Promise.all([
        anularAutorrelatoFolga(credenciais, hoje).catch(() => {
          // Sem rede agora, ou não era esse o tipo , melhor esforço
          // (ver limitação documentada na Rodada 57/58).
        }),
        anularFolgaConcedida(credenciais, hoje).catch(() => {
          // Idem.
        }),
      ]);
    }
    await removerDataFolgaAvisadaLocal(hoje);
    void seguirComRegistro(tipoEvento, rotulo);
  }

  /**
   * Checagem de integridade do aparelho (ver `security/deviceIntegrity.ts`)
   * ANTES de confirmar o registro. "Mock location" habilitado bloqueia
   * de verdade (é o vetor de fraude de GPS que a Lei do Motorista mais
   * se importa); root/jailbreak/hooking não bloqueia, só entra como
   * flag auditada junto do registro.
   */
  async function seguirComRegistro(tipoEvento: TipoEvento, rotulo: string) {
    // Já tem um registro em andamento (ou a confirmação já foi
    // disparada) , ignora um segundo toque enquanto isso.
    if (enviando !== null) return;

    const integridade = avaliarIntegridadeDispositivo();
    if (integridade.bloqueado) {
      Alert.alert(
        "Não foi possível registrar",
        integridade.motivoBloqueio ??
          "Aparelho reprovado na checagem de segurança.",
      );
      return;
    }

    // Rodada 45 , sem permissão de localização concedida, não deixa
    // nem abrir a confirmação do ponto. `canAskAgain: false` (negada
    // permanentemente) não tem diálogo nativo pra oferecer de novo ,
    // só dá pra resolver nos Ajustes do aparelho.
    const permissao = await obterPermissaoLocalizacao();
    if (permissao !== Location.PermissionStatus.GRANTED) {
      Alert.alert(
        "Localização necessária",
        'Para registrar o ponto é preciso permitir o acesso à localização do aparelho ("ao usar o app"). Sem essa permissão não é possível bater o ponto.',
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Abrir ajustes", onPress: () => void Linking.openSettings() },
        ],
      );
      return;
    }

    // Rodada 49 , pedido explícito do usuário: a permissão "Sempre"
    // (background) deixou de ser opcional. Sem ela concedida, o
    // motorista não consegue usar o app pra bater ponto nenhum , não
    // é mais só a amostragem antifraude que fica desativada (como era
    // nas Rodadas 45/46/48), agora é um pré-requisito de uso.
    const permissaoSempre = await obterPermissaoLocalizacaoSempre();
    if (permissaoSempre !== Location.PermissionStatus.GRANTED) {
      Alert.alert(
        'Localização "Sempre" necessária',
        'Para usar o app é preciso permitir o acesso à localização "Sempre"/"o tempo todo" nas configurações do aparelho (usada de forma esparsa, só durante a direção, para a checagem antifraude).',
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Abrir ajustes", onPress: () => void Linking.openSettings() },
        ],
      );
      return;
    }

    // Rodada 111 , abre o popup próprio (com o campo de observação
    // dentro dele) em vez do Alert.alert nativo, que não permite
    // nenhum campo de texto.
    setConfirmacaoPonto({
      tipoEvento,
      rotulo,
      horarioExibido: new Date().toLocaleTimeString("pt-BR"),
      flagsIntegridadeDispositivo: integridade.flagsParaAuditoria,
    });
  }

  function cancelarConfirmacaoPonto() {
    setConfirmacaoPonto(null);
    setObservacao("");
  }

  function confirmarPontoComObservacao() {
    if (!confirmacaoPonto) return;
    const { tipoEvento, flagsIntegridadeDispositivo } = confirmacaoPonto;
    setConfirmacaoPonto(null);
    void registrarEvento(tipoEvento, flagsIntegridadeDispositivo);
  }

  function abrirModalVeiculo() {
    setPlacaModal(veiculo?.placa ?? "");
    setModalVeiculoAberto(true);
  }

  async function confirmarTrocaVeiculo() {
    const placaNormalizada = placaModal
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!placaNormalizada) return;

    const credenciais = await obterCredenciais();
    if (!credenciais) return;

    const ehTroca = veiculo && veiculo.placa !== placaNormalizada;

    const confirmar = async () => {
      setSalvandoVeiculo(true);
      try {
        const atualizado = await atualizarVeiculo(credenciais, {
          placa: placaNormalizada,
          idRastreador: veiculo?.idRastreador ?? undefined,
          tecnologiaRastreador:
            (veiculo?.tecnologiaRastreador as TecnologiaRastreador) ??
            undefined,
        });
        setVeiculo(atualizado);
        setModalVeiculoAberto(false);
      } catch (err) {
        // Mostra o motivo real (o backend já responde com uma mensagem
        // legível , formato de placa inválido, sem vínculo de
        // dispositivo, etc.) em vez de mascarar tudo como "formato ou
        // conexão", que dificultava diagnosticar o problema de verdade.
        Alert.alert(
          "Não foi possível salvar",
          err instanceof Error && err.message
            ? err.message
            : "Confira a placa (formato ABC1234 ou ABC1D23) e a conexão.",
        );
      } finally {
        setSalvandoVeiculo(false);
      }
    };

    if (ehTroca) {
      Alert.alert(
        "Confirmar troca de veículo",
        `Trocar de "${veiculo?.placa}" para "${placaNormalizada}"? Isso fica registrado e visível para o gestor.`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar troca", onPress: () => void confirmar() },
        ],
      );
    } else {
      void confirmar();
    }
  }

  return (
    <ScrollView
      contentContainerStyle={estilos.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={estilos.cabecalho}>
        <Text style={estilos.titulo}>Registrar ponto</Text>
        <TouchableOpacity
          style={estilos.botaoTema}
          onPress={alternarTema}
          accessibilityLabel={
            tema === "claro"
              ? "Mudar para tema escuro"
              : "Mudar para tema claro"
          }
        >
          <Text style={estilos.botaoTemaTexto}>
            {tema === "claro" ? "🌙" : "☀️"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Rodada 69 , o número só aparece nos estados que guardam duração de
          verdade (direção/descanso/espera/aguardando documentação). Fora
          disso (início de jornada, ou qualquer "tempo indefinido" depois
          de fechar uma etapa) não existe cronômetro nenhum , só o aviso
          abaixo, pra não parecer que algo está sendo contado. */}
      {cronometroMs !== null && (
        <View style={estilos.cronometroCaixa}>
          <Text style={estilos.cronometroTexto}>
            {formatarDuracao(cronometroMs)}
          </Text>
          <Text style={estilos.cronometroLegenda}>
            desde{" "}
            {ultimoRelevante
              ? rotuloDoTipo(ultimoRelevante).toLowerCase()
              : ","}
          </Text>
        </View>
      )}

      {emTempoIndefinido && (
        <View style={estilos.avisoIndefinidoCaixa}>
          <Text style={estilos.avisoIndefinidoTexto}>
            ⚠ Escolha uma ação agora
          </Text>
          <Text style={estilos.avisoIndefinidoSubtexto}>
            Esse tempo não está contando como direção, descanso ou espera até
            você selecionar uma opção abaixo.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={estilos.veiculoCaixa}
        onPress={abrirModalVeiculo}
      >
        <Text style={estilos.veiculoTexto}>
          Veículo:{" "}
          <Text style={estilos.veiculoPlaca}>
            {veiculo?.placa ?? "não informado"}
          </Text>
        </Text>
        <Text style={estilos.veiculoAlterar}>alterar</Text>
      </TouchableOpacity>

      <View style={estilos.grade}>
        {botoesPrincipais.map(({ tipo, rotulo }) => (
          <TouchableOpacity
            key={tipo}
            style={[
              estilos.botaoEvento,
              enviando === tipo && estilos.botaoEventoAtivo,
            ]}
            onPress={() => void confirmarERegistrar(tipo, rotulo)}
            disabled={enviando !== null}
          >
            <Text style={estilos.botaoEventoTexto}>{rotulo}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Rodada 64 , pedido do usuário: "Avisar folga" saiu daqui
          (aparecia fixo embaixo dos botões em toda etapa de registrar
          ponto, competindo com eles) e foi para a aba "Horas", junto
          com o resto do que já é sobre folga (ver HorasScreen.tsx). */}

      <Modal
        visible={modalVeiculoAberto}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVeiculoAberto(false)}
      >
        <View style={estilos.modalFundo}>
          <View style={estilos.modalCaixa}>
            <Text style={estilos.modalTitulo}>Veículo de tração</Text>
            <Text style={estilos.modalDescricao}>
              Placa do cavalo mecânico que está puxando a carga agora. Trocar a
              placa fica visível para o gestor.
            </Text>
            <TextInput
              style={estilos.input}
              placeholder="ABC1234 ou ABC1D23"
              placeholderTextColor={cores.inputPlaceholder}
              autoCapitalize="characters"
              maxLength={7}
              value={placaModal}
              onChangeText={setPlacaModal}
            />
            <View style={estilos.modalBotoes}>
              <TouchableOpacity
                style={estilos.botaoModalCancelar}
                onPress={() => setModalVeiculoAberto(false)}
              >
                <Text style={estilos.botaoModalCancelarTexto}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={estilos.botaoModalConfirmar}
                onPress={() => void confirmarTrocaVeiculo()}
                disabled={salvandoVeiculo || !placaModal.trim()}
              >
                <Text style={estilos.botaoModalConfirmarTexto}>
                  {salvandoVeiculo ? "Salvando..." : "Salvar"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rodada 111 , popup próprio de confirmação do ponto, com o
          campo de observação dentro dele (antes era um Alert.alert
          nativo, que não permite nenhum campo de texto, e a
          observação ficava fixa na tela acima dos botões o tempo
          todo , pedido do usuário: deixar fixo "está inviável e
          confuso"). */}
      <Modal
        visible={confirmacaoPonto !== null}
        transparent
        animationType="fade"
        onRequestClose={cancelarConfirmacaoPonto}
      >
        <View style={estilos.modalFundo}>
          <View style={estilos.modalCaixa}>
            <Text style={estilos.modalTitulo}>Confirmar ponto</Text>
            {confirmacaoPonto && (
              <Text style={estilos.modalDescricao}>
                Registrar "{confirmacaoPonto.rotulo}" agora (
                {confirmacaoPonto.horarioExibido})?
              </Text>
            )}
            <TextInput
              style={estilos.input}
              placeholder="Observação (opcional)"
              placeholderTextColor={cores.inputPlaceholder}
              value={observacao}
              onChangeText={setObservacao}
              autoFocus
            />
            <View style={estilos.modalBotoes}>
              <TouchableOpacity
                style={estilos.botaoModalCancelar}
                onPress={cancelarConfirmacaoPonto}
              >
                <Text style={estilos.botaoModalCancelarTexto}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={estilos.botaoModalConfirmar}
                onPress={confirmarPontoComObservacao}
              >
                <Text style={estilos.botaoModalConfirmarTexto}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={resultadoPonto !== null && enviando === null}
        transparent
        animationType="fade"
        onRequestClose={() => setResultadoPonto(null)}
      >
        <View style={estilos.modalFundo}>
          <View style={estilos.modalCaixa}>
            <Text style={estilos.modalTitulo}>
              {resultadoPonto?.status === "ENVIADO"
                ? "Ponto registrado"
                : resultadoPonto?.status === "ERRO"
                  ? "Ponto NÃO registrado"
                  : "Ponto salvo no aparelho"}
            </Text>
            <Text style={estilos.modalDescricao}>
              {resultadoPonto?.status === "ENVIADO" &&
                `"${resultadoPonto.rotulo}" foi registrado com sucesso.`}
              {resultadoPonto?.status === "ERRO" &&
                `"${resultadoPonto.rotulo}" não foi aceito: ${resultadoPonto.erro ?? "erro ao processar o registro"}`}
              {resultadoPonto?.status === "PENDENTE" &&
                `"${resultadoPonto.rotulo}" ficou guardado e será enviado assim que houver internet.`}
            </Text>
            <View style={estilos.modalBotoes}>
              <TouchableOpacity
                style={estilos.botaoModalCancelar}
                onPress={() => setResultadoPonto(null)}
              >
                <Text style={estilos.botaoModalCancelarTexto}>Fechar</Text>
              </TouchableOpacity>
              {onVerHistorico && (
                <TouchableOpacity
                  style={estilos.botaoModalConfirmar}
                  onPress={() => {
                    setResultadoPonto(null);
                    onVerHistorico();
                  }}
                >
                  <Text style={estilos.botaoModalConfirmarTexto}>
                    Ver no histórico (comprovante)
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={enviando !== null} transparent animationType="fade">
        <View style={estilos.carregandoFundo}>
          <View style={estilos.carregandoCaixa}>
            <ActivityIndicator size="large" color={cores.primario} />
            <Text style={estilos.carregandoTexto}>Registrando ponto...</Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    container: {
      padding: 20,
      paddingTop: 60,
      gap: 12,
      backgroundColor: cores.fundo,
      flexGrow: 1,
    },
    cabecalho: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
    botaoTema: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: cores.fundoCartao,
      borderWidth: 1,
      borderColor: cores.borda,
    },
    botaoTemaTexto: { fontSize: 18 },
    cronometroCaixa: {
      backgroundColor: cores.fundoCartao,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: cores.borda,
      paddingVertical: 14,
      alignItems: "center",
    },
    cronometroTexto: {
      fontSize: 32,
      fontWeight: "700",
      color: cores.texto,
      fontVariant: ["tabular-nums"],
    },
    cronometroLegenda: {
      fontSize: 12,
      color: cores.textoSecundario,
      marginTop: 2,
    },
    // Rodada 69 , pedido do usuário: aviso bem mais chamativo (vermelho,
    // texto maior e em negrito) do que o antigo destaque laranja, já que
    // agora ele aparece SOZINHO (sem número contando ao lado) e precisa
    // chamar a atenção do motorista pra escolher uma ação.
    avisoIndefinidoCaixa: {
      backgroundColor: "#fef2f2",
      borderRadius: 12,
      borderWidth: 2,
      borderColor: "#dc2626",
      paddingVertical: 16,
      paddingHorizontal: 14,
      alignItems: "center",
    },
    avisoIndefinidoTexto: {
      fontSize: 18,
      fontWeight: "800",
      color: "#b91c1c",
      textAlign: "center",
    },
    avisoIndefinidoSubtexto: {
      fontSize: 13,
      fontWeight: "600",
      color: "#991b1b",
      marginTop: 6,
      textAlign: "center",
    },
    veiculoCaixa: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: cores.fundoCartao,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: cores.borda,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    veiculoTexto: { fontSize: 13, color: cores.textoSecundario },
    veiculoPlaca: { fontWeight: "700", color: cores.texto },
    veiculoAlterar: {
      fontSize: 12,
      color: cores.texto,
      textDecorationLine: "underline",
    },
    input: {
      backgroundColor: cores.inputFundo,
      color: cores.texto,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      borderWidth: 1,
      borderColor: cores.inputBorda,
    },
    // Pedido explícito do usuário: cada status vira um retângulo grande,
    // empilhado um abaixo do outro (não mais em grade 2 colunas) , fonte
    // maior, mais fácil de enxergar e acertar o toque pra qualquer pessoa.
    grade: { gap: 12, marginTop: 8 },
    botaoEvento: {
      backgroundColor: cores.primario,
      borderRadius: 12,
      paddingVertical: 22,
      paddingHorizontal: 16,
      width: "100%",
    },
    botaoEventoAtivo: { opacity: 0.5 },
    botaoEventoTexto: {
      color: cores.primarioTexto,
      fontWeight: "700",
      fontSize: 19,
      textAlign: "center",
    },
    modalFundo: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      padding: 24,
    },
    modalCaixa: {
      backgroundColor: cores.fundo,
      borderRadius: 14,
      padding: 20,
      gap: 10,
    },
    modalTitulo: { fontSize: 18, fontWeight: "700", color: cores.texto },
    modalDescricao: { fontSize: 13, color: cores.textoSecundario },
    modalBotoes: { flexDirection: "row", gap: 10, marginTop: 8 },
    botaoModalCancelar: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: cores.borda,
      alignItems: "center",
    },
    botaoModalCancelarTexto: {
      color: cores.textoSecundario,
      fontWeight: "600",
    },
    botaoModalConfirmar: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: cores.primario,
      alignItems: "center",
    },
    botaoModalConfirmarTexto: { color: cores.primarioTexto, fontWeight: "600" },
    carregandoFundo: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.35)",
      alignItems: "center",
      justifyContent: "center",
    },
    carregandoCaixa: {
      backgroundColor: cores.fundo,
      borderRadius: 14,
      paddingVertical: 28,
      paddingHorizontal: 36,
      alignItems: "center",
      gap: 12,
    },
    carregandoTexto: { color: cores.texto, fontWeight: "600" },
  });
}
