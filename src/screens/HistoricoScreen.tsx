import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { listarAutorrelatosFolga } from "../api/autorrelatoFolga";
import type { AutorrelatoFolga } from "../api/autorrelatoFolga";
import { listarFolgasConcedidas } from "../api/folgaConcedida";
import type { FolgaConcedida } from "../api/folgaConcedida";
import {
  baixarEcompartilharComprovante,
  baixarEcompartilharEspelhoRepP,
} from "../api/comprovante";
import { DataInput } from "../components/DataInput";
import { BotaoMinimizar } from "../components/BotaoMinimizar";
import { RegistroDetalheModal } from "../components/RegistroDetalheModal";
import { listarRegistros } from "../storage/db";
import { obterCredenciais } from "../storage/secureCredentials";
import { sincronizarFila } from "../sync/syncService";
import type { CredenciaisDispositivo, RegistroLocal } from "../types";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

/**
 * Rodada 57 , pedido do usuário: os avisos de folga também aparecem
 * aqui no Histórico, junto dos pontos batidos , afinal também foi um
 * envio feito pro servidor, mesmo não sendo um `RegistroJornada`. Tipo
 * "guarda-chuva" pra poder misturar os dois na mesma lista/ordenação.
 */
type ItemHistorico =
  | { tipo: "PONTO"; dado: RegistroLocal }
  | { tipo: "FOLGA_AVISADA"; dado: AutorrelatoFolga }
  | { tipo: "FOLGA_CONCEDIDA"; dado: FolgaConcedida };

const CORES_STATUS: Record<RegistroLocal["status"], string> = {
  PENDENTE: "#b45309",
  ENVIADO: "#15803d",
  ERRO: "#b91c1c",
};

const QTD_PADRAO = 10;
const QTD_INCREMENTO = 10;

type FiltroHistorico = "NENHUM" | "DATA" | "INTERVALO";
type PresetComprovante =
  | "HOJE"
  | "7_DIAS"
  | "30_DIAS"
  | "MES_ATUAL"
  | "PERSONALIZADO"
  | "TUDO";

/** "AAAA-MM-DD" no fuso do próprio aparelho (não UTC) , pra comparar com o que o motorista digita. */
function dataLocalIso(data: Date): string {
  return data.toLocaleDateString("en-CA");
}

function dataDoRegistroLocal(timestampEvento: string): string {
  return dataLocalIso(new Date(timestampEvento));
}

/**
 * Histórico local , mostra os eventos batidos neste aparelho, inclusive
 * os que ainda não foram sincronizados. É a prova, pro próprio
 * motorista, de que o ponto foi batido mesmo estando sem internet no
 * momento (fica "PENDENTE" até sincronizar, nunca some).
 *
 * Por padrão mostra só os 10 mais recentes (lista pode crescer muito
 * ao longo de meses de uso) , "carregar mais" ou um filtro por data
 * específica/intervalo dão acesso ao resto sem precisar rolar uma
 * lista enorme.
 *
 * Também tem o botão de baixar/compartilhar o comprovante em PDF do
 * período , pedido explícito do usuário além da sincronização. Os
 * alertas de jornada saíram daqui (Rodada 11) e ganharam aba própria
 * ("Alertas", ver AlertasScreen.tsx) , antes apareciam como uma caixa
 * sem jeito nenhum de fechar.
 */
export function HistoricoScreen() {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [registros, setRegistros] = useState<RegistroLocal[]>([]);
  const [folgas, setFolgas] = useState<AutorrelatoFolga[]>([]);
  const [folgasConcedidas, setFolgasConcedidas] = useState<FolgaConcedida[]>(
    [],
  );
  const [sincronizando, setSincronizando] = useState(false);
  const [baixandoComprovante, setBaixandoComprovante] = useState(false);
  const [baixandoEspelhoRepP, setBaixandoEspelhoRepP] = useState(false);
  const [mostrarComprovante, setMostrarComprovante] = useState(false);
  const [presetComprovante, setPresetComprovante] =
    useState<PresetComprovante | null>(null);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [credenciais, setCredenciais] = useState<CredenciaisDispositivo | null>(
    null,
  );
  const [registroSelecionado, setRegistroSelecionado] =
    useState<RegistroLocal | null>(null);

  const [filtroHistorico, setFiltroHistorico] =
    useState<FiltroHistorico>("NENHUM");
  const [filtroDataUnica, setFiltroDataUnica] = useState("");
  const [filtroIntervaloInicio, setFiltroIntervaloInicio] = useState("");
  const [filtroIntervaloFim, setFiltroIntervaloFim] = useState("");
  const [qtdExibida, setQtdExibida] = useState(QTD_PADRAO);
  const [historicoMinimizado, setHistoricoMinimizado] = useState(false);

  useEffect(() => {
    void listarRegistros().then(setRegistros);
    void obterCredenciais().then(async (creds) => {
      setCredenciais(creds);
      if (!creds) return;
      try {
        setFolgas(await listarAutorrelatosFolga(creds));
      } catch {
        // Sem rede agora , segue sem as folgas por enquanto, não trava a tela.
      }
      // Rodada 58 , folga concedida pela empresa entra na mesma lista.
      try {
        setFolgasConcedidas(await listarFolgasConcedidas(creds));
      } catch {
        // Sem rede agora , segue sem elas por enquanto.
      }
    });
  }, []);

  const recarregar = useCallback(async () => {
    setSincronizando(true);
    await sincronizarFila();
    setRegistros(await listarRegistros());
    const creds = credenciais ?? (await obterCredenciais());
    if (creds) {
      try {
        setFolgas(await listarAutorrelatosFolga(creds));
      } catch {
        // Sem rede agora , mantém a última lista de folgas carregada.
      }
      try {
        setFolgasConcedidas(await listarFolgasConcedidas(creds));
      } catch {
        // Sem rede agora , mantém a última lista carregada.
      }
    }
    setSincronizando(false);
  }, [credenciais]);

  // Filtro é sobre a lista LOCAL (já carregada no aparelho, ou já
  // buscada da API no caso das folgas) , não é uma nova consulta, só
  // reduz o que aparece na tela. Mesmo filtro de data se aplica aos
  // dois tipos (ponto e folga), comparando pelo dia calendário de cada
  // um.
  const dentroDoFiltro = useCallback(
    (dia: string) => {
      if (filtroHistorico === "DATA" && filtroDataUnica.trim()) {
        return dia === filtroDataUnica.trim();
      }
      if (
        filtroHistorico === "INTERVALO" &&
        (filtroIntervaloInicio.trim() || filtroIntervaloFim.trim())
      ) {
        const inicio = filtroIntervaloInicio.trim();
        const fim = filtroIntervaloFim.trim();
        if (inicio && dia < inicio) return false;
        if (fim && dia > fim) return false;
        return true;
      }
      return true;
    },
    [
      filtroHistorico,
      filtroDataUnica,
      filtroIntervaloInicio,
      filtroIntervaloFim,
    ],
  );

  // Rodada 57 , mistura pontos e avisos de folga na mesma lista,
  // ordenados pelo dia a que cada um se refere (mais recente primeiro)
  // , um aviso de folga aparece encaixado no lugar certo da linha do
  // tempo, junto dos pontos batidos em volta daquele dia.
  const itensCombinados = useMemo(() => {
    const itensPonto: ItemHistorico[] = registros
      .filter((r) => dentroDoFiltro(dataDoRegistroLocal(r.timestampEvento)))
      .map((r) => ({ tipo: "PONTO", dado: r }));
    const itensFolgaAvisada: ItemHistorico[] = folgas
      .filter((f) => dentroDoFiltro(f.data.slice(0, 10)))
      .map((f) => ({ tipo: "FOLGA_AVISADA", dado: f }));
    const itensFolgaConcedida: ItemHistorico[] = folgasConcedidas
      .filter((f) => dentroDoFiltro(f.data.slice(0, 10)))
      .map((f) => ({ tipo: "FOLGA_CONCEDIDA", dado: f }));

    return [...itensPonto, ...itensFolgaAvisada, ...itensFolgaConcedida].sort(
      (a, b) => {
        const diaDe = (item: ItemHistorico) =>
          item.tipo === "PONTO" ? item.dado.timestampEvento : item.dado.data;
        return new Date(diaDe(b)).getTime() - new Date(diaDe(a)).getTime();
      },
    );
  }, [registros, folgas, folgasConcedidas, dentroDoFiltro]);

  const itensExibidos = useMemo(
    () => itensCombinados.slice(0, qtdExibida),
    [itensCombinados, qtdExibida],
  );
  const restantes = itensCombinados.length - itensExibidos.length;

  function mudarFiltroHistorico(novo: FiltroHistorico) {
    setFiltroHistorico(novo);
    setQtdExibida(QTD_PADRAO);
  }

  function validarData(texto: string): string | undefined {
    if (!texto.trim()) return undefined;
    // Aceita AAAA-MM-DD (o mais fácil de digitar sem um date picker nativo).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto.trim())) {
      throw new Error(`Data inválida: "${texto}". Use o formato AAAA-MM-DD.`);
    }
    return texto.trim();
  }

  function aplicarPresetComprovante(preset: PresetComprovante) {
    setPresetComprovante(preset);
    const hoje = new Date();
    if (preset === "TUDO") {
      setDataInicio("");
      setDataFim("");
      return;
    }
    if (preset === "HOJE") {
      const d = dataLocalIso(hoje);
      setDataInicio(d);
      setDataFim(d);
      return;
    }
    if (preset === "7_DIAS" || preset === "30_DIAS") {
      const dias = preset === "7_DIAS" ? 7 : 30;
      const inicio = new Date(hoje);
      inicio.setDate(inicio.getDate() - (dias - 1));
      setDataInicio(dataLocalIso(inicio));
      setDataFim(dataLocalIso(hoje));
      return;
    }
    if (preset === "MES_ATUAL") {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      setDataInicio(dataLocalIso(inicio));
      setDataFim(dataLocalIso(hoje));
      return;
    }
    // PERSONALIZADO: não altera os campos, só libera a edição manual.
  }

  async function baixarComprovante() {
    setBaixandoComprovante(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) {
        Alert.alert(
          "Dispositivo não vinculado",
          "Este aparelho ainda não está vinculado a um motorista. Peça pra empresa vincular o telefone no painel antes de gerar o comprovante.",
        );
        return;
      }
      const inicio = validarData(dataInicio);
      const fim = validarData(dataFim);
      const resultado = await baixarEcompartilharComprovante(credenciais, {
        inicio,
        fim,
      });
      if (!resultado.compartilhado) {
        Alert.alert(
          "Comprovante gerado",
          "O PDF foi baixado, mas este aparelho não tem um app de compartilhamento disponível. O arquivo ficou salvo apenas temporariamente no app.",
        );
      } else {
        Alert.alert(
          "Comprovante gerado",
          "O PDF foi baixado e a tela de compartilhamento foi aberta.",
        );
      }
    } catch (err) {
      Alert.alert(
        "Não foi possível baixar",
        err instanceof Error ? err.message : "Erro desconhecido",
      );
    } finally {
      setBaixandoComprovante(false);
    }
  }

  async function baixarEspelhoRepP() {
    setBaixandoEspelhoRepP(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) {
        Alert.alert(
          "Dispositivo não vinculado",
          "Este aparelho ainda não está vinculado a um motorista. Peça pra empresa vincular o telefone no painel antes de gerar o espelho de ponto.",
        );
        return;
      }
      const inicio = validarData(dataInicio);
      const fim = validarData(dataFim);
      const resultado = await baixarEcompartilharEspelhoRepP(credenciais, {
        inicio,
        fim,
      });
      if (!resultado.compartilhado) {
        Alert.alert(
          "Espelho de Ponto gerado",
          "O PDF foi baixado, mas este aparelho não tem um app de compartilhamento disponível. O arquivo ficou salvo apenas temporariamente no app.",
        );
      } else {
        Alert.alert(
          "Espelho de Ponto gerado",
          "O PDF foi baixado e a tela de compartilhamento foi aberta.",
        );
      }
    } catch (err) {
      Alert.alert(
        "Não foi possível baixar",
        err instanceof Error ? err.message : "Erro desconhecido",
      );
    } finally {
      setBaixandoEspelhoRepP(false);
    }
  }

  // Rodada 56 , pedido do usuário: com o teclado aberto (ex.:
  // digitando numa das datas do filtro), não tinha como rolar a tela
  // pra ver o campo, porque este cabeçalho ficava FORA da área
  // rolável (só a FlatList rolava, e o cabeçalho era um irmão fixo
  // acima dela). Resolvido virando `ListHeaderComponent` da própria
  // FlatList , agora cabeçalho e lista rolam juntos.
  const cabecalhoLista = (
    <>
      <View style={estilos.cabecalho}>
        <Text style={estilos.titulo}>Histórico</Text>
        <TouchableOpacity onPress={recarregar} style={estilos.botaoSync}>
          <Text style={estilos.botaoSyncTexto}>
            {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={{ marginBottom: 8 }}>
        <BotaoMinimizar
          minimizado={historicoMinimizado}
          onAlternar={() => setHistoricoMinimizado((v) => !v)}
          rotulo="histórico"
        />
      </View>

      <View style={estilos.comprovanteBox}>
        <TouchableOpacity onPress={() => setMostrarComprovante((v) => !v)}>
          <Text style={estilos.linkFiltro}>
            {mostrarComprovante
              ? "ocultar comprovante ▲"
              : "Baixar / compartilhar comprovante (PDF) ▼"}
          </Text>
        </TouchableOpacity>
        {mostrarComprovante && (
          <View style={{ gap: 8 }}>
            <Text style={estilos.legendaPreset}>
              Selecione o período do comprovante:
            </Text>
            <View style={estilos.presetsLinha}>
              {(
                [
                  ["HOJE", "Hoje"],
                  ["7_DIAS", "Últimos 7 dias"],
                  ["30_DIAS", "Últimos 30 dias"],
                  ["MES_ATUAL", "Este mês"],
                  ["TUDO", "Tudo"],
                  ["PERSONALIZADO", "Personalizado"],
                ] as [PresetComprovante, string][]
              ).map(([valor, rotulo]) => (
                <TouchableOpacity
                  key={valor}
                  style={[
                    estilos.presetChip,
                    presetComprovante === valor && estilos.presetChipAtivo,
                  ]}
                  onPress={() => aplicarPresetComprovante(valor)}
                >
                  <Text
                    style={[
                      estilos.presetChipTexto,
                      presetComprovante === valor &&
                        estilos.presetChipTextoAtivo,
                    ]}
                  >
                    {rotulo}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {presetComprovante === "PERSONALIZADO" && (
              <View style={estilos.filtroPeriodo}>
                <View style={{ flex: 1 }}>
                  <DataInput
                    valor={dataInicio}
                    onAlterar={setDataInicio}
                    placeholder="Início"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <DataInput
                    valor={dataFim}
                    onAlterar={setDataFim}
                    placeholder="Fim"
                  />
                </View>
              </View>
            )}
            {presetComprovante &&
              presetComprovante !== "PERSONALIZADO" &&
              presetComprovante !== "TUDO" && (
                <Text style={estilos.legendaPeriodoEscolhido}>
                  Período: {dataInicio} até {dataFim}
                </Text>
              )}
            <TouchableOpacity
              style={estilos.botaoComprovante}
              onPress={baixarComprovante}
              disabled={baixandoComprovante || !presetComprovante}
            >
              <Text style={estilos.botaoComprovanteTexto}>
                {baixandoComprovante
                  ? "Gerando comprovante..."
                  : presetComprovante
                    ? "Baixar / compartilhar comprovante"
                    : "Selecione um período acima"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={estilos.botaoComprovante}
              onPress={baixarEspelhoRepP}
              disabled={baixandoEspelhoRepP || !presetComprovante}
            >
              <Text style={estilos.botaoComprovanteTexto}>
                {baixandoEspelhoRepP
                  ? "Gerando espelho de ponto..."
                  : presetComprovante
                    ? "Baixar Espelho de Ponto (REP-P)"
                    : "Selecione um período acima"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={estilos.filtroHistoricoBox}>
        <View style={estilos.presetsLinha}>
          {(
            [
              ["NENHUM", `Últimos ${QTD_PADRAO}`],
              ["DATA", "Data específica"],
              ["INTERVALO", "Intervalo"],
            ] as [FiltroHistorico, string][]
          ).map(([valor, rotulo]) => (
            <TouchableOpacity
              key={valor}
              style={[
                estilos.presetChip,
                filtroHistorico === valor && estilos.presetChipAtivo,
              ]}
              onPress={() => mudarFiltroHistorico(valor)}
            >
              <Text
                style={[
                  estilos.presetChipTexto,
                  filtroHistorico === valor && estilos.presetChipTextoAtivo,
                ]}
              >
                {rotulo}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {filtroHistorico === "DATA" && (
          <DataInput
            valor={filtroDataUnica}
            onAlterar={setFiltroDataUnica}
            placeholder="Data"
          />
        )}
        {filtroHistorico === "INTERVALO" && (
          <View style={estilos.filtroPeriodo}>
            <View style={{ flex: 1 }}>
              <DataInput
                valor={filtroIntervaloInicio}
                onAlterar={setFiltroIntervaloInicio}
                placeholder="De"
              />
            </View>
            <View style={{ flex: 1 }}>
              <DataInput
                valor={filtroIntervaloFim}
                onAlterar={setFiltroIntervaloFim}
                placeholder="Até"
              />
            </View>
          </View>
        )}
      </View>
    </>
  );

  return (
    <View style={estilos.container}>
      <FlatList
        data={historicoMinimizado ? [] : itensExibidos}
        ListHeaderComponent={cabecalhoLista}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => {
          if (item.tipo === "PONTO") return item.dado.idLocal;
          return item.tipo === "FOLGA_AVISADA"
            ? `folga-avisada-${item.dado.id}`
            : `folga-concedida-${item.dado.id}`;
        }}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={recarregar} />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => {
          if (item.tipo === "PONTO") {
            return (
              <TouchableOpacity
                style={estilos.linha}
                onPress={() => setRegistroSelecionado(item.dado)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={estilos.evento}>{item.dado.tipoEvento}</Text>
                  <Text style={estilos.horario}>
                    {new Date(item.dado.timestampEvento).toLocaleString(
                      "pt-BR",
                    )}
                  </Text>
                  {item.dado.status === "ERRO" && item.dado.ultimoErro && (
                    <Text style={estilos.erro}>{item.dado.ultimoErro}</Text>
                  )}
                </View>
                <Text
                  style={[
                    estilos.status,
                    { color: CORES_STATUS[item.dado.status] },
                  ]}
                >
                  {item.dado.status}
                </Text>
              </TouchableOpacity>
            );
          }

          // Rodada 57/58 , aviso/concessão de folga: só exibição (sem
          // detalhe extra pra abrir , a observação/motivo, se tiver,
          // já aparece aqui embaixo do dia).
          const observacaoOuMotivo =
            item.tipo === "FOLGA_AVISADA"
              ? item.dado.observacao
              : item.dado.motivo;
          return (
            <View style={[estilos.linha, estilos.linhaFolga]}>
              <View style={{ flex: 1 }}>
                <Text style={estilos.evento}>
                  {item.tipo === "FOLGA_AVISADA"
                    ? "Folga avisada"
                    : "Folga concedida pela empresa"}
                </Text>
                <Text style={estilos.horario}>
                  {new Date(item.dado.data).toLocaleDateString("pt-BR")}
                </Text>
                {observacaoOuMotivo && (
                  <Text style={estilos.observacaoFolga}>
                    {observacaoOuMotivo}
                  </Text>
                )}
              </View>
              <Text style={estilos.tagFolga}>FOLGA</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={estilos.vazio}>
            {historicoMinimizado
              ? "Histórico minimizado."
              : registros.length === 0 &&
                  folgas.length === 0 &&
                  folgasConcedidas.length === 0
                ? "Nenhum ponto registrado ainda."
                : "Nenhum registro no filtro selecionado."}
          </Text>
        }
        ListFooterComponent={
          !historicoMinimizado && restantes > 0 ? (
            <TouchableOpacity
              style={estilos.botaoCarregarMais}
              onPress={() => setQtdExibida((q) => q + QTD_INCREMENTO)}
            >
              <Text style={estilos.botaoCarregarMaisTexto}>
                Carregar mais ({restantes} restantes)
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <RegistroDetalheModal
        registro={registroSelecionado}
        credenciais={credenciais}
        onFechar={() => setRegistroSelecionado(null)}
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
    cabecalho: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
    },
    titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
    botaoSync: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: cores.primario,
      borderRadius: 8,
    },
    botaoSyncTexto: {
      color: cores.primarioTexto,
      fontSize: 12,
      fontWeight: "600",
    },
    comprovanteBox: { marginBottom: 12, gap: 8 },
    botaoComprovante: {
      backgroundColor: "#2563eb",
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    botaoComprovanteTexto: { color: "#fff", fontWeight: "600", fontSize: 13 },
    linkFiltro: {
      color: "#2563eb",
      fontSize: 13,
      textAlign: "center",
      fontWeight: "600",
    },
    legendaPreset: { fontSize: 12, color: cores.textoSecundario },
    legendaPeriodoEscolhido: {
      fontSize: 12,
      color: cores.textoSecundario,
      textAlign: "center",
    },
    presetsLinha: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    presetChip: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: cores.borda,
      backgroundColor: cores.fundoCartao,
    },
    presetChipAtivo: {
      backgroundColor: cores.primario,
      borderColor: cores.primario,
    },
    presetChipTexto: {
      fontSize: 12,
      fontWeight: "600",
      color: cores.textoSecundario,
    },
    presetChipTextoAtivo: { color: cores.primarioTexto },
    filtroHistoricoBox: { marginBottom: 12, gap: 8 },
    filtroPeriodo: { flexDirection: "row", gap: 8 },
    inputData: {
      flex: 1,
      backgroundColor: cores.inputFundo,
      borderRadius: 8,
      padding: 10,
      fontSize: 13,
      borderWidth: 1,
      borderColor: cores.inputBorda,
      color: cores.texto,
    },
    linha: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: cores.borda,
    },
    evento: { fontWeight: "600", fontSize: 15, color: cores.texto },
    horario: { fontSize: 12, color: cores.textoSecundario, marginTop: 2 },
    erro: { fontSize: 11, color: "#b91c1c", marginTop: 2 },
    status: { fontSize: 12, fontWeight: "700" },
    // Rodada 57 , linha de aviso de folga dentro do Histórico.
    linhaFolga: { borderLeftWidth: 3, borderLeftColor: cores.primario },
    observacaoFolga: {
      fontSize: 12,
      color: cores.textoSecundario,
      marginTop: 4,
    },
    tagFolga: { fontSize: 11, fontWeight: "700", color: cores.primario },
    vazio: { textAlign: "center", color: cores.textoSecundario, marginTop: 40 },
    botaoCarregarMais: { alignItems: "center", paddingVertical: 14 },
    botaoCarregarMaisTexto: {
      color: "#2563eb",
      fontWeight: "600",
      fontSize: 13,
    },
  });
}
