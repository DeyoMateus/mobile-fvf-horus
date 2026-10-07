import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { AppStateStatus } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { DefinirPinScreen } from "./src/screens/DefinirPinScreen";
import { DesbloqueioScreen } from "./src/screens/DesbloqueioScreen";
import { HistoricoScreen } from "./src/screens/HistoricoScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { RegistrarPontoScreen } from "./src/screens/RegistrarPontoScreen";
import { AlertasScreen } from "./src/screens/AlertasScreen";
import { AjustesEmpresaScreen } from "./src/screens/AjustesEmpresaScreen";
import { HorasScreen } from "./src/screens/HorasScreen";
import { PerfilMotoristaScreen } from "./src/screens/PerfilMotoristaScreen";
import {
  iniciarBanco,
  listarEventosDaJornadaAtual,
  ultimoRegistroRelevante,
} from "./src/storage/db";
import { alertaDirecaoContinuaAindaVale } from "./src/domain/direcaoContinua";
import { estaEmTempoIndefinido } from "./src/domain/regrasJornada";
import { agoraConfiavel } from "./src/utils/relogioConfiavel";
import {
  exigirRestauracaoNoProximoVinculo,
  restaurarSeAparelhoNovo,
} from "./src/sync/restauracaoService";
import { sincronizarLembretesDeJornada } from "./src/notifications/lembretesJornada";
import { iniciarBancoCienciasPendentes } from "./src/storage/db";
import { iniciarBancoAjustesVistosLocalmente } from "./src/storage/db";
import {
  iniciarBancoAlertasVisualizadosPendentes,
  registrarAlertaVisualizadoPendente,
} from "./src/storage/db";
import { iniciarBancoAjusteGestor } from "./src/storage/db";
import {
  limparVinculo,
  obterCredenciais,
} from "./src/storage/secureCredentials";
import { limparPin, temPinCadastrado } from "./src/storage/pin";
import {
  iniciarSincronizacaoAutomatica,
  registrarCallbackRegistroRecusado,
  registrarCallbackRevogacao,
} from "./src/sync/syncService";
import { registrarSincronizacaoEmBackground } from "./src/sync/backgroundTask";
import {
  pararAmostragemSeNaoEstaDirigindo,
  retomarAmostragemSeDirigindo,
} from "./src/sync/localizacaoBackgroundTask";
import { obterVeiculo } from "./src/api/veiculo";
import type { CredenciaisDispositivo } from "./src/types";
import { iniciarBancoAmostrasLocalizacao } from "./src/storage/db";
import {
  configurarExibicaoDeNotificacoes,
  registrarPushTokenSeNecessario,
} from "./src/notifications/pushRegistration";
import { sincronizarRelogioConfiavelSeNecessario } from "./src/sync/relogioConfiavelSync";
import { configurarPinningSsl } from "./src/security/sslPinning";
import { ThemeProvider, useTema } from "./src/theme/ThemeContext";
import { bloqueioSuprimido } from "./src/security/appLockSuppression";
import type { CoresTema } from "./src/theme/ThemeContext";
import { listarMeusAlertas } from "./src/api/alertas";
import { verificarVinculoAtivo } from "./src/api/motorista";
import type { AlertaJornada } from "./src/api/alertas";
import { AlertaJornadaOverlay } from "./src/components/AlertaJornadaOverlay";
import { AlertaLocalTelaCheia } from "./src/components/AlertaLocalTelaCheia";
import {
  alertaJaTocado,
  alertaSilenciado,
  definirAlertaSilenciado,
  existeAlertaNaoAberto,
  marcarAlertaComoTocado,
  obterAlertasLimposAte,
} from "./src/storage/alertaJornadaLocal";
import { listarMinhasSolicitacoes } from "./src/api/solicitacoesAjuste";
import { existeDecisaoNaoVista } from "./src/storage/solicitacaoAjusteLocal";

// Rodada 151 , bateria: 45s (era 20s) e só com o app em primeiro plano.
const INTERVALO_POLL_ALERTAS_MS = 45000;

/**
 * Ajuste do teclado (pedido do usuário , campos ficavam escondidos
 * atrás do teclado, sem jeito de rolar a tela pra ver o que estava
 * digitando).
 *
 * Rodada 56 tentou deixar o Android por conta do próprio SO
 * (`adjustResize`), mas isso não funciona testando pelo Expo Go: o
 * Expo Go é um app já compilado, com o próprio `AndroidManifest.xml`
 * dele (fixo, não o do nosso `app.json`) , na prática o
 * `windowSoftInputMode` que valeria pra nós não é aplicado dentro do
 * Expo Go, então o teclado continuava cobrindo os campos igual no
 * Android. Corrigido usando `KeyboardAvoidingView` nos dois sistemas:
 * `padding` no iOS, `height` no Android (a opção recomendada pelo
 * próprio React Native pra essa plataforma).
 */
const COMPORTAMENTO_TECLADO = Platform.OS === "ios" ? "padding" : "height";

// Rodada 86 , pedido do usuário: o alerta de "aviso" (5h de direção
// contínua, ATENÇÃO , ainda não é o limite legal de 5h30) não tocava
// nem vibrava, só o CRÍTICO (5h30, EXCEDIDA) tocaria , e mesmo esse só
// se o app estivesse em primeiro plano e desbloqueado no momento exato.
// Corrigido a metade que dava pra corrigir sem build nativo: agora os
// TRÊS tipos de estouro de jornada tocam a tela cheia (com vibração)
// tanto no limiar de ATENÇÃO (perto do limite) quanto no de CRÍTICO
// (excedido) , antes só o CRÍTICO tocava, ver `verificarAlertas` abaixo.
// Também reincide (ver `agendarReincidencia`) pros dois limiares agora,
// não só pro crítico.
const TIPOS_ESTOURO_JORNADA = new Set([
  "DIRECAO_CONTINUA_PROXIMA_LIMITE",
  "DIRECAO_CONTINUA_EXCEDIDA",
  "JORNADA_DIRECAO_PROXIMA_LIMITE",
  "JORNADA_DIRECAO_EXCEDIDA",
  "ESPERA_PROXIMA_LIMITE",
  "ESPERA_LIMITE_LEGAL_ATINGIDO",
  // Rodada 142 , jornada aberta sem escolher a próxima etapa.
  "TEMPO_INDEFINIDO_PROXIMO_LIMITE",
  "TEMPO_INDEFINIDO_PROLONGADO",
]);
const INTERVALO_REINCIDENCIA_MS = 40 * 60 * 1000;

type Aba = "PONTO" | "HISTORICO" | "HORAS" | "ALERTAS" | "AJUSTES" | "PERFIL";

/**
 * Rodada 52 , a barra de abas tinha 6 itens, muita coisa pra caber numa
 * tela de celular de forma clara; só as mais usadas ficam na barra, o
 * resto vai pro menu lateral, aberto pelo botão "Menu" à direita.
 *
 * Rodada 54 , reduzido de novo, a pedido do usuário: só "Registrar
 * ponto" e "Histórico" ficam na barra agora; Alertas, Ajustes, Horas e
 * Perfil foram todos pro menu lateral.
 */
const ABAS_PRINCIPAIS: { chave: Aba; rotulo: string }[] = [
  { chave: "PONTO", rotulo: "Registrar ponto" },
  { chave: "HISTORICO", rotulo: "Histórico" },
];
const ABAS_MENU: { chave: Aba; rotulo: string }[] = [
  { chave: "ALERTAS", rotulo: "Alertas" },
  { chave: "AJUSTES", rotulo: "Ajustes" },
  { chave: "HORAS", rotulo: "Horas" },
  { chave: "PERFIL", rotulo: "Perfil" },
];
const LARGURA_MENU_LATERAL = Math.min(
  280,
  Dimensions.get("window").width * 0.78,
);

// Sem biblioteca de navegação de propósito: só duas telas depois do
// vínculo, um switcher simples evita puxar @react-navigation inteiro
// (menos dependências nativas = menos coisa pra dar incompatibilidade
// de versão entre SDKs do Expo).
//
// A SafeAreaView do 'react-native' puro (deprecated) só funciona no iOS
// , no Android ela não faz nada, então em telefones com navegação por
// gestos ou barra de sistema o rodapé com as abas ("Registrar ponto" /
// "Histórico") ficava desenhado por baixo da barra de navegação do
// Android e sumia da tela. Trocado por react-native-safe-area-context,
// que calcula o inset de verdade em tempo de execução em qualquer
// aparelho, dentro do Expo Go inclusive.
function AppInterno() {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [pronto, setPronto] = useState(false);
  const [vinculado, setVinculado] = useState(false);
  // Rodada 141 , sobe quando um aparelho novo recebeu o histórico do
  // servidor, pra as telas relerem o banco local.
  const [versaoRestauracao, setVersaoRestauracao] = useState(0);
  const [pinConfigurado, setPinConfigurado] = useState(false);
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [aba, setAba] = useState<Aba>("PONTO");
  const [menuAberto, setMenuAberto] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current; // 0 = fechado, 1 = aberto
  const [filaAlertasJornada, setFilaAlertasJornada] = useState<AlertaJornada[]>(
    [],
  );
  // Rodada 54 , bolinha de notificação no botão "Menu"/item "Alertas",
  // agora que Alertas saiu da barra principal (ver ABAS_MENU acima).
  const [temAlertaNaoVisto, setTemAlertaNaoVisto] = useState(false);
  // Pedido do usuário: mesma bolinha de notificação dos Alertas, agora
  // também pra quando o RH decide (aprova/reprova) um pedido de ajuste
  // que o motorista mandou.
  const [temAjusteNaoVisto, setTemAjusteNaoVisto] = useState(false);
  const [silenciadoAlertaJornada, setSilenciadoAlertaJornada] = useState(false);
  const estadoAppAnterior = useRef<AppStateStatus>(AppState.currentState);
  const temporizadoresReincidencia = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  // Rodada 44 , a limpeza do vínculo local agora é uma função só,
  // chamada tanto pela detecção via fila de sincronização (abaixo)
  // quanto pela checagem ativa que roda uma vez ao abrir o app (só
  // essa segunda pega o caso de um motorista que não bate ponto de
  // novo depois do vínculo ter sido revogado/apagado).
  /**
   * Rodada 104 , pedido do usuário: se o veículo vinculado já tem um
   * rastreador dedicado cadastrado, não religa o GPS contínuo do
   * celular pra amostragem antifraude de direção (ver comentário em
   * `iniciarAmostragemDirecao`, em `localizacaoBackgroundTask.ts`). Sem
   * internet ou erro ao consultar o veículo, assume que NÃO tem
   * rastreador dedicado (mais seguro manter a cobertura antifraude do
   * que desligá-la por engano).
   */
  async function retomarAmostragemComCheckDeRastreador(
    credenciais: CredenciaisDispositivo,
  ) {
    let temRastreador = false;
    try {
      const veiculo = await obterVeiculo(credenciais);
      temRastreador = Boolean(veiculo?.idRastreador);
    } catch {
      temRastreador = false;
    }
    void retomarAmostragemSeDirigindo(temRastreador);
  }

  async function encerrarVinculoLocal() {
    await limparVinculo();
    await limparPin();
    exigirRestauracaoNoProximoVinculo();
    setVinculado(false);
    setPinConfigurado(false);
    setDesbloqueado(false);
    Alert.alert(
      "Vínculo deste aparelho encerrado",
      "A empresa revogou o vínculo deste celular (ou aprovou uma troca para outro aparelho). Se isto for engano, solicite a troca novamente na tela seguinte.",
    );
  }

  useEffect(() => {
    configurarPinningSsl();
    iniciarBanco();
    iniciarBancoAmostrasLocalizacao();
    iniciarBancoCienciasPendentes();
    iniciarBancoAjustesVistosLocalmente();
    iniciarBancoAlertasVisualizadosPendentes();
    iniciarBancoAjusteGestor();
    configurarExibicaoDeNotificacoes();
    Promise.all([obterCredenciais(), temPinCadastrado()]).then(
      ([c, temPin]) => {
        setVinculado(c !== null);
        setPinConfigurado(temPin);
        setPronto(true);
        if (c !== null) {
          void registrarPushTokenSeNecessario();
          void sincronizarRelogioConfiavelSeNecessario();
          void retomarAmostragemComCheckDeRastreador(c);
          // Checagem ativa, uma vez, ao abrir o app com internet , ver
          // o comentário de verificarVinculoAtivo. Sem internet ou erro
          // de servidor não faz nada (null); só age no 401 explícito.
          void verificarVinculoAtivo(c).then((ativo) => {
            if (ativo === false) void encerrarVinculoLocal();
          });
        }
      },
    );

    // Se o backend rejeitar 401 de forma consistente (toda a fila
    // pendente, não um erro isolado), o vínculo deste aparelho foi
    // revogado , provavelmente a empresa aprovou a troca pra outro
    // celular. Limpa as credenciais locais (elas já não valem nada) e
    // volta pro Onboarding, que já tem a seção de solicitar troca.
    registrarCallbackRevogacao(() => {
      void encerrarVinculoLocal();
    });
    registrarCallbackRegistroRecusado((itens) => {
      Alert.alert(
        "Ponto não registrado",
        itens
          .map((i) => `${i.tipoEvento.replace(/_/g, " ")}: ${i.erro}`)
          .join("\n\n") +
          "\n\nO app voltou para o último ponto válido. Procure o gestor para ajustar se for necessário.",
      );
    });

    const parar = iniciarSincronizacaoAutomatica();
    void registrarSincronizacaoEmBackground();
    return () => {
      registrarCallbackRevogacao(null);
      registrarCallbackRegistroRecusado(null);
      parar();
    };
  }, []);

  // Trava o app sempre que ele sai de primeiro plano (troca de app,
  // tela bloqueada, minimizado) , é exatamente o momento em que o
  // celular pode passar de mão. Volta a pedir o PIN em toda retomada,
  // não só na abertura a frio.
  useEffect(() => {
    const assinatura = AppState.addEventListener("change", (proximoEstado) => {
      const veioDeAtivo = estadoAppAnterior.current === "active";
      const foiPraFundo = proximoEstado !== "active";
      // Suprimido = foi o próprio app que abriu uma interface do
      // sistema (ex.: folha de compartilhamento do comprovante), não
      // uma troca de app de verdade , não trava nesse caso (ver
      // appLockSuppression.ts).
      if (veioDeAtivo && foiPraFundo && !bloqueioSuprimido()) {
        setDesbloqueado(false);
      }
      // Rodada 151 , ao voltar pro app, reconcilia os avisos locais
      // (direção contínua/tempo indefinido) com o relógio confiável.
      if (proximoEstado === "active" && !veioDeAtivo) {
        void sincronizarLembretesDeJornada();
        void pararAmostragemSeNaoEstaDirigindo();
        // Aparelho novo que ainda não conseguiu restaurar o histórico do
        // servidor (estava sem rede): tenta de novo ao voltar pro app.
        void restaurarSeAparelhoNovo().then((n) => {
          if (n > 0) setVersaoRestauracao((v) => v + 1);
        });
      }
      estadoAppAnterior.current = proximoEstado;
    });
    return () => assinatura.remove();
  }, []);

  useEffect(() => {
    void alertaSilenciado().then(setSilenciadoAlertaJornada);
  }, []);

  useEffect(() => {
    const timers = temporizadoresReincidencia.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  /**
   * Alerta de estouro de jornada "tipo ligação": enquanto o app está
   * desbloqueado (motorista com o celular na mão), verifica
   * periodicamente se surgiu algum alerta CRÍTICO novo (direção
   * contínua excedida, jornada de direção excedida, espera no limite
   * legal) e toca em tela cheia. Só cobre o app em primeiro plano , o
   * disparo mesmo com o app fechado depende do build EAS/dev-client e
   * de push configurado (ver claude/bloqueios-dependentes-do-usuario.md),
   * que ainda são pendências.
   */
  // Rodada 141 , aparelho novo: traz jornada/histórico do servidor.
  useEffect(() => {
    if (!vinculado || !desbloqueado) return;
    void restaurarSeAparelhoNovo().then((n) => {
      if (n > 0) setVersaoRestauracao((v) => v + 1);
      void sincronizarLembretesDeJornada();
    });
  }, [vinculado, desbloqueado]);

  useEffect(() => {
    if (!vinculado || !desbloqueado) return;
    let cancelado = false;

    async function verificarAlertas() {
      const credenciais = await obterCredenciais();
      if (!credenciais || cancelado) return;
      try {
        const alertas = await listarMeusAlertas(credenciais);
        const novos: AlertaJornada[] = [];
        for (const alerta of alertas) {
          // Rodada 86 , antes só CRÍTICO tocava a tela cheia; agora o
          // limiar de ATENÇÃO ("aviso", ex.: 5h de direção contínua,
          // perto do limite de 5h30) também toca pros três tipos de
          // estouro de jornada , CRÍTICO de qualquer tipo continua
          // tocando como antes (antifraude/integridade inclusive).
          if (
            alerta.severidade !== "CRITICO" &&
            !TIPOS_ESTOURO_JORNADA.has(alerta.tipo)
          )
            continue;
          if (await alertaJaTocado(alerta.id)) continue;
          // Alerta que chegou ATRASADO ao aparelho (app fechado/sem sinal)
          // e já não descreve a situação atual (o motorista fez a pausa e
          // recomeçou a contagem, ou já escolheu a próxima etapa): não abre
          // a tela vermelha. Continua na lista de Alertas como histórico.
          // Alerta antigo (aparelho novo / app muito tempo fechado): se foi
          // gerado há mais de 6 h, é histórico, não abre a tela vermelha.
          const idadeAlertaMs =
            agoraConfiavel() - new Date(alerta.createdAt).getTime();
          if (Number.isFinite(idadeAlertaMs) && idadeAlertaMs > 6 * 3_600_000) {
            await marcarAlertaComoTocado(alerta.id);
            continue;
          }
          const aindaVale =
            alerta.tipo === "DIRECAO_CONTINUA_PROXIMA_LIMITE" ||
            alerta.tipo === "DIRECAO_CONTINUA_EXCEDIDA"
              ? alertaDirecaoContinuaAindaVale(
                  alerta.tipo,
                  listarEventosDaJornadaAtual(),
                  agoraConfiavel(),
                )
              : alerta.tipo === "TEMPO_INDEFINIDO_PROXIMO_LIMITE" ||
                  alerta.tipo === "TEMPO_INDEFINIDO_PROLONGADO"
                ? estaEmTempoIndefinido(
                    ultimoRegistroRelevante()?.tipoEvento ?? null,
                  )
                : true;
          if (!aindaVale) {
            await marcarAlertaComoTocado(alerta.id);
            continue;
          }
          // Marca como tocado ANTES de enfileirar , mesmo se o
          // motorista não fechar a tempo do próximo poll, não entra
          // de novo na fila (evita loop de alerta eterno).
          await marcarAlertaComoTocado(alerta.id);
          novos.push(alerta);
        }
        if (novos.length && !cancelado) {
          setFilaAlertasJornada((atual) => [...atual, ...novos]);
        }

        // Rodada 54/55 , mesma lista já buscada acima, sem chamada de
        // rede extra: reaproveitada só pra saber se tem alerta (qualquer
        // severidade) ainda não ABERTO individualmente pelo motorista
        // (ver `alertaJornadaLocal.ts`/`AlertasScreen.tsx` , só visitar
        // a aba Alertas não conta, tem que abrir o alerta pra ver).
        //
        // Rodada 55.1 , precisa considerar o mesmo filtro de "Limpar
        // histórico" que a tela de Alertas usa: sem isso, um alerta
        // escondido da lista (porque o motorista já limpou) continuava
        // contando pra bolinha, mesmo com a lista aparecendo vazia.
        if (!cancelado) {
          const limposAte = await obterAlertasLimposAte();
          const alertasVisiveis = limposAte
            ? alertas.filter(
                (a) =>
                  new Date(a.createdAt).getTime() >
                  new Date(limposAte).getTime(),
              )
            : alertas;
          setTemAlertaNaoVisto(await existeAlertaNaoAberto(alertasVisiveis));
        }
      } catch {
        // Sem rede agora , tenta de novo no próximo ciclo.
      }
    }

    void verificarAlertas();
    const id = setInterval(() => {
      if (AppState.currentState === "active") void verificarAlertas();
    }, INTERVALO_POLL_ALERTAS_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [vinculado, desbloqueado]);

  /**
   * Pedido do usuário: o motorista não ficava sabendo quando o RH
   * decidia (aprovava/reprovava) um pedido de ajuste , só descobria se
   * entrasse na aba "Ajustes" por conta própria. Mesmo padrão de
   * polling do `verificarAlertas` acima, verificando
   * `listarMinhasSolicitacoes` e acendendo a bolinha quando existe uma
   * decisão nova desde a última vez que o motorista abriu essa aba.
   */
  useEffect(() => {
    if (!vinculado || !desbloqueado) return;
    let cancelado = false;

    async function verificarAjustes() {
      const credenciais = await obterCredenciais();
      if (!credenciais || cancelado) return;
      try {
        const solicitacoes = await listarMinhasSolicitacoes(credenciais);
        if (!cancelado) {
          setTemAjusteNaoVisto(await existeDecisaoNaoVista(solicitacoes));
        }
      } catch {
        // Sem rede agora , tenta de novo no próximo ciclo.
      }
    }

    void verificarAjustes();
    const id = setInterval(() => {
      if (AppState.currentState === "active") void verificarAjustes();
    }, INTERVALO_POLL_ALERTAS_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [vinculado, desbloqueado]);

  /**
   * Reincidência: se o motorista fechar um alerta de estouro de jornada
   * de verdade (não fraude/integridade) e continuar sem registrar nada
   * que resolva a situação, o MESMO alerta volta a tocar 40min depois ,
   * e assim sucessivamente, até resolver. Puramente client-side (não
   * depende do backend gerar um alerta novo): compara o timestamp do
   * último evento relevante batido neste aparelho contra o momento em
   * que o timer foi armado.
   */
  function agendarReincidencia(alerta: AlertaJornada) {
    if (!TIPOS_ESTOURO_JORNADA.has(alerta.tipo)) return;
    const armadoEm = Date.now();
    const id = setTimeout(() => {
      const ultimo = ultimoRegistroRelevante();
      const resolvidoDepois =
        ultimo && new Date(ultimo.timestampEvento).getTime() > armadoEm;
      if (!resolvidoDepois) {
        setFilaAlertasJornada((atual) => [...atual, alerta]);
      }
    }, INTERVALO_REINCIDENCIA_MS);
    temporizadoresReincidencia.current[alerta.id] = id;
  }

  function fecharAlertaJornada() {
    const alertaFechado = filaAlertasJornada[0];
    setFilaAlertasJornada((atual) => atual.slice(1));
    if (alertaFechado) {
      agendarReincidencia(alertaFechado);
      // Rodada 126 , pedido do usuário: tocar "Ciente, fechar alerta"
      // aqui também é o motorista dando ciência do alerta , registra
      // na fila local (offline-first, mesmo padrão da ciência de
      // ajuste) pro SyncService avisar o backend quando der. O alerta
      // em si nunca é apagado nem alterado , só ganha esse carimbo.
      registrarAlertaVisualizadoPendente(alertaFechado.id);
    }
  }

  async function silenciarAlertaJornada() {
    await definirAlertaSilenciado(true);
    setSilenciadoAlertaJornada(true);
  }

  // Rodada 126 , pedido do usuário: faltava o caminho de volta de
  // silenciarAlertaJornada acima , uma vez silenciado, ficava assim
  // para sempre neste aparelho, sem jeito nenhum de reativar.
  async function reativarAlertaJornada() {
    await definirAlertaSilenciado(false);
    setSilenciadoAlertaJornada(false);
  }

  async function esqueciOPin() {
    await limparVinculo();
    await limparPin();
    setPinConfigurado(false);
    setDesbloqueado(false);
    setVinculado(false);
  }

  function abrirMenu() {
    setMenuAberto(true);
    Animated.timing(menuAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }

  function fecharMenu() {
    Animated.timing(menuAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setMenuAberto(false);
    });
  }

  function selecionarAbaDoMenu(chave: Aba) {
    setAba(chave);
    // Rodada 55 , não zera mais a bolinha só por entrar na aba: agora
    // só some alerta a alerta, ao abrir cada um de fato (dentro de
    // `AlertasScreen.tsx`). O próximo poll de `verificarAlertas` reflete
    // isso.
    fecharMenu();
  }

  if (!pronto) return null;

  if (!vinculado) {
    return (
      <SafeAreaView
        style={estilos.raiz}
        edges={["top", "left", "right", "bottom"]}
      >
        <StatusBar style={cores.statusBar} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={COMPORTAMENTO_TECLADO}
        >
          <OnboardingScreen
            onVinculado={() => {
              exigirRestauracaoNoProximoVinculo();
              setVinculado(true);
              void registrarPushTokenSeNecessario();
              void obterCredenciais().then((credenciais) => {
                if (credenciais)
                  void retomarAmostragemComCheckDeRastreador(credenciais);
              });
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (!pinConfigurado) {
    return (
      <SafeAreaView
        style={estilos.raiz}
        edges={["top", "left", "right", "bottom"]}
      >
        <StatusBar style={cores.statusBar} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={COMPORTAMENTO_TECLADO}
        >
          <DefinirPinScreen
            onDefinido={() => {
              setPinConfigurado(true);
              setDesbloqueado(true);
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (!desbloqueado) {
    return (
      <SafeAreaView
        style={estilos.raiz}
        edges={["top", "left", "right", "bottom"]}
      >
        <StatusBar style={cores.statusBar} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={COMPORTAMENTO_TECLADO}
        >
          <DesbloqueioScreen
            onDesbloqueado={() => setDesbloqueado(true)}
            onEsqueciOPin={() => void esqueciOPin()}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={estilos.raiz} edges={["top", "left", "right"]}>
      <StatusBar style={cores.statusBar} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={COMPORTAMENTO_TECLADO}
      >
        {aba === "PONTO" && (
          <RegistrarPontoScreen
            key={versaoRestauracao}
            onVerHistorico={() => setAba("HISTORICO")}
          />
        )}
        {aba === "HISTORICO" && <HistoricoScreen key={versaoRestauracao} />}
        {aba === "HORAS" && <HorasScreen />}
        {aba === "ALERTAS" && (
          <AlertasScreen onTemAlertaNaoVistoMudou={setTemAlertaNaoVisto} />
        )}
        {aba === "AJUSTES" && (
          <AjustesEmpresaScreen
            onTemAjusteNaoVistoMudou={setTemAjusteNaoVisto}
          />
        )}
        {aba === "PERFIL" && (
          <PerfilMotoristaScreen
            alertaJornadaSilenciado={silenciadoAlertaJornada}
            onReativarAlertaJornada={() => void reativarAlertaJornada()}
          />
        )}
      </KeyboardAvoidingView>
      <SafeAreaView edges={["bottom"]} style={estilos.tabsArea}>
        <View style={estilos.tabs}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={estilos.tabsRolagem}
          >
            {ABAS_PRINCIPAIS.map(({ chave, rotulo }) => (
              <TouchableOpacity
                key={chave}
                style={[estilos.tab, aba === chave && estilos.tabAtiva]}
                onPress={() => setAba(chave)}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    estilos.tabTexto,
                    aba === chave && estilos.tabTextoAtiva,
                  ]}
                >
                  {rotulo}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Rodada 52/54 , botão fixo à direita da barra, fora da
              rolagem, sempre visível: abre o menu lateral com o que não
              está na barra principal (Alertas, Ajustes, Horas, Perfil).
              Fica destacado como as outras abas quando a tela atual é
              uma dessas escondidas, pra não parecer que "sumiu" de onde
              estava. Bolinha vermelha (Rodada 54) quando há alerta novo
              ainda não visto. */}
          <TouchableOpacity
            style={[
              estilos.tab,
              estilos.botaoMenu,
              ABAS_MENU.some((a) => a.chave === aba) && estilos.tabAtiva,
            ]}
            onPress={abrirMenu}
            activeOpacity={0.75}
          >
            <View>
              <Text
                style={[
                  estilos.tabTexto,
                  ABAS_MENU.some((a) => a.chave === aba) &&
                    estilos.tabTextoAtiva,
                ]}
              >
                ☰ Menu
              </Text>
              {(temAlertaNaoVisto || temAjusteNaoVisto) && (
                <View style={estilos.bolinhaNotificacao} />
              )}
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {menuAberto && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={fecharMenu}>
            <Animated.View style={[estilos.menuFundo, { opacity: menuAnim }]} />
          </Pressable>
          <Animated.View
            style={[
              estilos.menuLateral,
              {
                transform: [
                  {
                    translateX: menuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [LARGURA_MENU_LATERAL, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <SafeAreaView
              edges={["top", "right", "bottom"]}
              style={{ flex: 1 }}
            >
              <View style={estilos.menuCabecalho}>
                <Text style={estilos.menuTitulo}>Mais opções</Text>
                <TouchableOpacity onPress={fecharMenu} hitSlop={10}>
                  <Text style={estilos.menuFechar}>✕</Text>
                </TouchableOpacity>
              </View>
              {ABAS_MENU.map(({ chave, rotulo }) => (
                <TouchableOpacity
                  key={chave}
                  style={[
                    estilos.menuItem,
                    aba === chave && estilos.menuItemAtivo,
                  ]}
                  onPress={() => selecionarAbaDoMenu(chave)}
                >
                  <View style={estilos.menuItemLinha}>
                    <Text
                      style={[
                        estilos.menuItemTexto,
                        aba === chave && estilos.menuItemTextoAtivo,
                      ]}
                    >
                      {rotulo}
                    </Text>
                    {chave === "ALERTAS" && temAlertaNaoVisto && (
                      <View style={estilos.bolinhaNotificacaoMenuItem} />
                    )}
                    {chave === "AJUSTES" && temAjusteNaoVisto && (
                      <View style={estilos.bolinhaNotificacaoMenuItem} />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </SafeAreaView>
          </Animated.View>
        </>
      )}

      {filaAlertasJornada[0] && (
        <AlertaJornadaOverlay
          alerta={filaAlertasJornada[0]}
          silenciado={silenciadoAlertaJornada}
          onFechar={fecharAlertaJornada}
          onPedirSilenciar={() => void silenciarAlertaJornada()}
        />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInterno />
        <AlertaLocalTelaCheia />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: cores.fundo },
    tabsArea: {
      borderTopWidth: 1,
      borderTopColor: cores.borda,
      backgroundColor: cores.fundo,
    },
    // Rodada 52 , a barra virou uma linha com a parte rolável (as 4
    // abas principais) à esquerda e o botão "Menu" fixo à direita,
    // fora da rolagem , antes só existia gap:8 direto num flexDirection
    // row (era só a ScrollView com as 6 abas dentro dela).
    tabs: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    tabsRolagem: { flexDirection: "row", gap: 8 },
    // Rodada 50 , pedido do usuário: os botões de trocar de aba
    // ganharam formato de "chip" (mesmo padrão visual já usado nos
    // filtros de período do Histórico), pra ficar nítido qual aba
    // está ativa, em vez de só um texto sublinhado sutil.
    tab: {
      minWidth: 84,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: cores.borda,
      backgroundColor: cores.fundoCartao,
      alignItems: "center",
    },
    botaoMenu: { minWidth: 0 },
    tabAtiva: { backgroundColor: cores.primario, borderColor: cores.primario },
    tabTexto: { color: cores.tabInativa, fontWeight: "600", fontSize: 12 },
    tabTextoAtiva: { color: cores.primarioTexto },

    // Rodada 52 , menu lateral com o que não coube nas 4 abas
    // principais (Horas, Perfil). Fundo escurecido (fecha ao tocar
    // fora) + painel deslizando a partir da borda direita.
    menuFundo: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    menuLateral: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      width: LARGURA_MENU_LATERAL,
      backgroundColor: cores.fundo,
      borderLeftWidth: 1,
      borderLeftColor: cores.borda,
    },
    menuCabecalho: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: cores.borda,
    },
    menuTitulo: { fontSize: 16, fontWeight: "700", color: cores.texto },
    menuFechar: {
      fontSize: 18,
      color: cores.textoSecundario,
      paddingHorizontal: 4,
    },
    menuItem: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: cores.borda,
    },
    menuItemAtivo: { backgroundColor: cores.fundoCartao },
    menuItemTexto: { fontSize: 15, fontWeight: "600", color: cores.texto },
    menuItemTextoAtivo: { color: cores.primario },
    // Rodada 54 , bolinha de notificação ("tem alerta novo") no
    // botão "☰ Menu" e no item "Alertas" dentro do menu lateral.
    menuItemLinha: { flexDirection: "row", alignItems: "center", gap: 8 },
    bolinhaNotificacao: {
      position: "absolute",
      top: -2,
      right: -8,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: cores.perigo,
    },
    bolinhaNotificacaoMenuItem: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: cores.perigo,
    },
  });
}
