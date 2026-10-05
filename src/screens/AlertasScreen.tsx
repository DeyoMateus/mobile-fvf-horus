import { useCallback, useEffect, useState } from "react";
import { renderizarHorarios } from "../utils/horariosMensagem";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { listarMeusAlertas } from "../api/alertas";
import type { AlertaJornada } from "../api/alertas";
import { AlertaDetalheModal } from "../components/AlertaDetalheModal";
import {
  definirAlertasLimposAte,
  garantirCarimboInicial,
  limparHistoricoAlertaJornadaLocal,
  marcarAlertaComoAberto,
  obterAlertasAbertosRecentes,
  obterAlertasLimposAte,
  obterAlertasVistoAte,
} from "../storage/alertaJornadaLocal";
import { rotuloAlerta } from "../domain/alertasInfo";
import { registrarAlertaVisualizadoPendente } from "../storage/db";
import { BotaoMinimizar } from "../components/BotaoMinimizar";
import { obterCredenciais } from "../storage/secureCredentials";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

const CORES_SEVERIDADE: Record<AlertaJornada["severidade"], string> = {
  INFO: "#374151",
  ATENCAO: "#b45309",
  CRITICO: "#b91c1c",
};

const QTD_PADRAO = 10;
const QTD_INCREMENTO = 10;

/**
 * Aba dedicada só a alertas , antes eles apareciam como uma caixa
 * dentro do Histórico, sem jeito nenhum de fechar/desfazer (só as 3
 * mensagens mais recentes, sempre visíveis). Aqui, ao contrário do
 * Histórico (que é a prova local do que foi batido neste aparelho e
 * por isso fica salvo no SQLite), os alertas não precisam ficar
 * salvos localmente , a tela sempre busca a lista atual do backend
 * (a mesma fonte que já alimenta o alerta "tipo ligação" e o sininho
 * do painel do gestor), então puxar pra atualizar já é suficiente pra
 * refletir o estado real.
 *
 * Mesma lógica de paginação do Histórico: só os 10 mais recentes por
 * padrão, com "carregar mais" pro resto.
 */
export function AlertasScreen({
  onTemAlertaNaoVistoMudou,
}: {
  /**
   * Rodada 60 , pedido do usuário: antes, fechar um alerta só
   * atualizava a bolinha vermelha do menu no próximo poll automático
   * (`App.tsx`), então ela continuava vermelha por um tempo mesmo já
   * tendo sido "vista" , parecia que só sumia "atualizando a tela".
   * Este callback avisa o App.tsx NA HORA, sempre que o conjunto de
   * alertas não abertos desta tela muda (ao abrir um alerta, ao
   * carregar a lista, ou ao limpar o histórico).
   */
  onTemAlertaNaoVistoMudou?: (valor: boolean) => void;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [alertas, setAlertas] = useState<AlertaJornada[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [qtdExibida, setQtdExibida] = useState(QTD_PADRAO);
  const [selecionado, setSelecionado] = useState<AlertaJornada | null>(null);
  // Rodada 55 , só pra decidir, item a item, se mostra a bolinha de "não
  // aberto" na lista (ver `alertaNaoAberto` abaixo). Vem do SecureStore,
  // guardado localmente pra não reler a cada render.
  const [vistoAte, setVistoAte] = useState<string | null>(null);
  const [abertosRecentes, setAbertosRecentes] = useState<string[]>([]);
  const [minimizado, setMinimizado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      const [dados, limposAte, abertosRecentesAtual] = await Promise.all([
        listarMeusAlertas(credenciais),
        obterAlertasLimposAte(),
        obterAlertasAbertosRecentes(),
      ]);
      // Mais recente primeiro.
      dados.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      // Rodada 55.1 , sobre a lista completa (antes do filtro de "limpos"
      // abaixo): garante que, se o carimbo nunca foi definido, tudo que
      // já existe agora conte como visto , evita a bolinha ficar
      // vermelha pra sempre em alertas antigos que nunca passaram por
      // este mecanismo novo.
      const vistoAteAtual = await garantirCarimboInicial(dados);
      // Rodada 50 , esconde (só neste aparelho) o que já foi "limpo":
      // tudo com createdAt até o momento da última limpeza. Um alerta
      // mais novo que chegar depois disso volta a aparecer normalmente.
      const visiveis = limposAte
        ? dados.filter(
            (a) =>
              new Date(a.createdAt).getTime() > new Date(limposAte).getTime(),
          )
        : dados;
      setAlertas(visiveis);
      setVistoAte(vistoAteAtual);
      setAbertosRecentes(abertosRecentesAtual);
      onTemAlertaNaoVistoMudou?.(
        algumNaoAberto(visiveis, vistoAteAtual, abertosRecentesAtual),
      );
    } catch {
      // Sem internet agora , mantém a última lista carregada, sem travar a tela.
    } finally {
      setCarregando(false);
    }
  }, [onTemAlertaNaoVistoMudou]);

  /**
   * Rodada 55 , pedido do usuário: a bolinha de notificação fica só nos
   * alertas que chegaram por último e ainda não foram abertos
   * individualmente (não só a aba visitada). `abertosRecentes` só
   * importa pros que são mais novos que `vistoAte` , os mais antigos já
   * estão cobertos pelo próprio carimbo.
   */
  function alertaNaoAberto(item: AlertaJornada): boolean {
    return algumNaoAberto([item], vistoAte, abertosRecentes);
  }

  /** Mesma regra de `alertaJornadaLocal.ts#existeAlertaNaoAberto`, mas local (sem SecureStore) , usada pra avisar o App.tsx na hora. */
  function algumNaoAberto(
    lista: AlertaJornada[],
    va: string | null,
    ar: string[],
  ): boolean {
    return lista.some((item) => {
      if (va && new Date(item.createdAt).getTime() <= new Date(va).getTime())
        return false;
      return !ar.includes(item.id);
    });
  }

  function abrirAlerta(item: AlertaJornada) {
    setSelecionado(item);
    // Rodada 126 , pedido do usuário: abrir o alerta aqui também é o
    // motorista dando ciência dele , registra na fila local
    // (offline-first) pro SyncService avisar o backend quando der.
    // Idempotente no backend, então não tem problema repetir se o
    // motorista abrir de novo um que já tinha marcado.
    if (!item.motoristaVisualizadoEm) {
      registrarAlertaVisualizadoPendente(item.id);
    }
    if (!alertaNaoAberto(item)) return;
    void marcarAlertaComoAberto(item.id, alertas).then(() => {
      // Relê o estado local (pode ter avançado o carimbo e zerado a
      // lista de recentes) pra bolinha desse item sumir na hora, sem
      // esperar o próximo "puxar pra atualizar".
      void Promise.all([
        obterAlertasVistoAte(),
        obterAlertasAbertosRecentes(),
      ]).then(([va, ar]) => {
        setVistoAte(va);
        setAbertosRecentes(ar);
        // Rodada 60 , avisa o App.tsx na hora: a bolinha do MENU (não
        // só a bolinha deste item na lista) precisa sumir assim que o
        // motorista fecha a tela do alerta, sem esperar o próximo poll.
        onTemAlertaNaoVistoMudou?.(algumNaoAberto(alertas, va, ar));
      });
    });
  }

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alertasExibidos = alertas.slice(0, qtdExibida);
  const restantes = alertas.length - alertasExibidos.length;

  function confirmarLimpezaHistorico() {
    if (alertas.length === 0) return;

    Alert.alert(
      "Limpar alertas",
      "Isso esconde os alertas atuais desta lista, só neste aparelho , eles continuam existindo no sistema da empresa. Se surgir um alerta novo depois, ele aparece normalmente.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Limpar",
          style: "destructive",
          onPress: () => {
            const maisRecente = alertas[0].createdAt;
            void Promise.all([
              definirAlertasLimposAte(maisRecente),
              limparHistoricoAlertaJornadaLocal(),
            ]).then(() => {
              setAlertas([]);
              onTemAlertaNaoVistoMudou?.(false);
            });
          },
        },
      ],
    );
  }

  return (
    <View style={estilos.container}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <Text style={estilos.titulo}>Alertas</Text>
        <TouchableOpacity
          style={[
            estilos.botaoLimpar,
            alertas.length === 0 && estilos.botaoLimparDesabilitado,
          ]}
          onPress={confirmarLimpezaHistorico}
          disabled={alertas.length === 0}
        >
          <Text style={estilos.botaoLimparTexto}>Limpar histórico</Text>
        </TouchableOpacity>
      </View>
      <Text style={estilos.subtitulo}>
        Toque num alerta pra ver o que aconteceu e o que fazer.
      </Text>
      <View style={{ marginBottom: 8 }}>
        <BotaoMinimizar
          minimizado={minimizado}
          onAlternar={() => setMinimizado((v) => !v)}
          rotulo="alertas"
        />
      </View>

      <FlatList
        data={minimizado ? [] : alertasExibidos}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={carregando}
            onRefresh={() => void carregar()}
          />
        }
        contentContainerStyle={estilos.lista}
        ListEmptyComponent={
          minimizado ? (
            <Text style={estilos.vazio}>Alertas minimizados.</Text>
          ) : !carregando ? (
            <Text style={estilos.vazio}>Nenhum alerta por enquanto.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={estilos.item}
            onPress={() => abrirAlerta(item)}
          >
            <View
              style={[
                estilos.severidadePonto,
                { backgroundColor: CORES_SEVERIDADE[item.severidade] },
              ]}
            />
            <View style={{ flex: 1 }}>
              <View style={estilos.itemTituloLinha}>
                <Text style={estilos.itemTitulo}>{rotuloAlerta(item)}</Text>
                {alertaNaoAberto(item) && (
                  <View style={estilos.bolinhaNaoAberto} />
                )}
              </View>
              <Text style={estilos.itemMensagem} numberOfLines={2}>
                {renderizarHorarios(item.mensagem)}
              </Text>
              <Text style={estilos.itemData}>
                {new Date(item.createdAt).toLocaleString("pt-BR")}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          !minimizado && restantes > 0 ? (
            <TouchableOpacity
              style={estilos.botaoCarregarMais}
              onPress={() => setQtdExibida((v) => v + QTD_INCREMENTO)}
            >
              <Text style={estilos.botaoCarregarMaisTexto}>
                Carregar mais ({restantes} restantes)
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <AlertaDetalheModal
        alerta={selecionado}
        onFechar={() => setSelecionado(null)}
      />
    </View>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: 60,
      paddingHorizontal: 20,
      backgroundColor: cores.fundo,
    },
    titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
    subtitulo: {
      fontSize: 13,
      color: cores.textoSecundario,
      marginTop: 2,
      marginBottom: 12,
    },
    botaoLimpar: {
      borderWidth: 1,
      borderColor: cores.borda,
      backgroundColor: cores.fundoCartao,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 12,
      marginTop: 4,
    },
    botaoLimparDesabilitado: { opacity: 0.5 },
    botaoLimparTexto: { fontSize: 12, fontWeight: "700", color: cores.texto },
    lista: { paddingBottom: 24, gap: 8 },
    vazio: { textAlign: "center", color: cores.textoSecundario, marginTop: 40 },
    item: {
      flexDirection: "row",
      gap: 10,
      backgroundColor: cores.fundoCartao,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: cores.borda,
      padding: 12,
      alignItems: "flex-start",
    },
    severidadePonto: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
    itemTituloLinha: { flexDirection: "row", alignItems: "center", gap: 6 },
    itemTitulo: { fontSize: 14, fontWeight: "700", color: cores.texto },
    // Rodada 55 , bolinha por alerta individual, ver `alertaNaoAberto`.
    bolinhaNaoAberto: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: cores.perigo,
    },
    itemMensagem: { fontSize: 13, color: cores.textoSecundario, marginTop: 2 },
    itemData: { fontSize: 11, color: cores.textoSecundario, marginTop: 4 },
    botaoCarregarMais: { paddingVertical: 14, alignItems: "center" },
    botaoCarregarMaisTexto: {
      color: cores.texto,
      fontWeight: "600",
      textDecorationLine: "underline",
    },
  });
}
