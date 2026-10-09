import { useCallback, useEffect, useMemo, useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  baixarEvidenciaAjuste,
  darCienciaAjuste,
  listarMeusAjustes,
} from "../api/tratamentos";
import {
  registrarCienciaPendente,
  marcarCienciaEnviada,
  registrarAjusteVistoLocalmente,
  obterAjustesVistosLocalmente,
} from "../storage/db";
import { marcarDecisoesComoVistas } from "../storage/solicitacaoAjusteLocal";
import type { EvidenciaTratamento, TratamentoPonto } from "../api/tratamentos";
import {
  baixarEvidenciaSolicitacao,
  criarSolicitacaoAjuste,
  listarMinhasSolicitacoes,
} from "../api/solicitacoesAjuste";
import type { SolicitacaoAjustePonto } from "../api/solicitacoesAjuste";
import { obterCredenciais } from "../storage/secureCredentials";
import { aplicarMascaraDataHoraBr } from "../utils/mascaras";
import { DataInput } from "../components/DataInput";
import { BotaoMinimizar } from "../components/BotaoMinimizar";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";
import { TIPOS_EVENTO, TipoEvento } from "../types";

const QTD_PADRAO = 10;
const QTD_INCREMENTO = 10;

const CORES_STATUS: Record<SolicitacaoAjustePonto["status"], string> = {
  PENDENTE: "#b45309",
  APROVADA: "#15803d",
  REJEITADA: "#b91c1c",
};

const ROTULO_STATUS: Record<SolicitacaoAjustePonto["status"], string> = {
  PENDENTE: "Aguardando o RH",
  APROVADA: "Aprovado",
  REJEITADA: "Não aprovado",
};

/** Mesmo tipo de filtro de período usado no Histórico/comprovante , ver `HistoricoScreen.tsx`. */
type FiltroPeriodo = "NENHUM" | "DATA" | "INTERVALO";

/** "AAAA-MM-DD" no fuso do próprio aparelho , pra comparar com o que o motorista digita no filtro. */
function diaLocalIso(dataIso: string): string {
  return new Date(dataIso).toLocaleDateString("en-CA");
}

function dentroDoPeriodo(
  dia: string,
  filtro: FiltroPeriodo,
  dataUnica: string,
  intervaloInicio: string,
  intervaloFim: string,
): boolean {
  if (filtro === "DATA" && dataUnica.trim()) {
    return dia === dataUnica.trim();
  }
  if (
    filtro === "INTERVALO" &&
    (intervaloInicio.trim() || intervaloFim.trim())
  ) {
    if (intervaloInicio.trim() && dia < intervaloInicio.trim()) return false;
    if (intervaloFim.trim() && dia > intervaloFim.trim()) return false;
    return true;
  }
  return true;
}

/** As três etapas do pedido de ajuste (Rodada 75) , uma de cada vez na tela, em cascata. */
type EtapaForm = "EVENTO" | "DATA_HORA" | "MOTIVO";

/**
 * Aba "Ajustes": tem duas coisas diferentes, de propósito separadas na
 * tela:
 *
 * 1) "Pedir ajuste" + "Minhas solicitações" , o motorista esqueceu de
 * bater um ponto e pede a correção aqui mesmo, apontando dia, horário e
 * o motivo. NUNCA vira o horário oficial sozinho: só depois que o RH
 * aprovar pelo painel é que entra na apuração/holerite (Rodada 27). Um
 * horário corrigido não comprova onde o motorista estava naquele
 * momento , quem decide é o RH, olhando a justificativa.
 *
 * 2) "Ajustes da empresa" , correções que o RH lançou direto (sem
 * pedido prévio, ex.: motorista sem acesso ao app no momento), sempre
 * com motivo e evidência anexada. O ponto do motorista NUNCA é
 * bloqueado por causa disso; ele sempre pode continuar batendo
 * normalmente.
 *
 * Discordar de qualquer uma das duas se resolve conversando direto com
 * a empresa , não existe fluxo de contestação dentro do app.
 *
 * Rodada 75 , três pedidos do usuário:
 * 1) A tela inteira era um único `ScrollView` com tudo dentro; abrir o
 *    formulário de pedido empurrava tanto conteúdo de uma vez que a
 *    rolagem travava antes do fim (o mesmo problema que o Histórico já
 *    tinha resolvido virando `FlatList` com cabeçalho , ver o
 *    comentário da Rodada 56 em `HistoricoScreen.tsx`). Mesma solução
 *    aqui: a lista de "Ajustes lançados pela empresa" virou a
 *    `FlatList` de verdade, e todo o resto (título, pedir ajuste,
 *    minhas solicitações) é o `ListHeaderComponent` dela , cabeçalho e
 *    lista rolam juntos, sem nada ficando inacessível.
 * 2) As duas listas ficavam sem limite (solicitações) ou só com
 *    "carregar mais" sem filtro (ajustes da empresa) , agora as duas
 *    têm o mesmo padrão de filtro por período + paginação que o
 *    comprovante/Histórico já usa (`dentroDoPeriodo` acima).
 * 3) O formulário de pedido mostrava evento + data/hora + motivo tudo
 *    de uma vez. Virou uma cascata de 3 etapas (`EtapaForm`): escolhe o
 *    registro, depois a data/hora, depois o motivo , sempre só uma
 *    etapa visível por vez, com um resumo curto e tocável das etapas
 *    já respondidas pra poder voltar e corrigir.
 */
interface AjustesEmpresaScreenProps {
  /** Pedido do usuário: ao abrir esta aba (que já mostra o status de
   * cada pedido em "Minhas solicitações"), zera a bolinha de notificação
   * do menu lateral , ver `App.tsx`/`solicitacaoAjusteLocal.ts`. */
  onTemAjusteNaoVistoMudou?: (valor: boolean) => void;
}

export function AjustesEmpresaScreen({
  onTemAjusteNaoVistoMudou,
}: AjustesEmpresaScreenProps = {}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);

  const [minhasSolicitacoes, setMinhasSolicitacoes] = useState<
    SolicitacaoAjustePonto[]
  >([]);
  const [ajustes, setAjustes] = useState<TratamentoPonto[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  // Filtro + paginação de "Minhas solicitações".
  const [filtroSolic, setFiltroSolic] = useState<FiltroPeriodo>("NENHUM");
  const [filtroSolicData, setFiltroSolicData] = useState("");
  const [filtroSolicIntInicio, setFiltroSolicIntInicio] = useState("");
  const [filtroSolicIntFim, setFiltroSolicIntFim] = useState("");
  const [qtdExibidaSolic, setQtdExibidaSolic] = useState(QTD_PADRAO);

  // Filtro + paginação de "Ajustes lançados pela empresa".
  const [filtroEmpresa, setFiltroEmpresa] = useState<FiltroPeriodo>("NENHUM");
  const [filtroEmpresaData, setFiltroEmpresaData] = useState("");
  const [filtroEmpresaIntInicio, setFiltroEmpresaIntInicio] = useState("");
  const [filtroEmpresaIntFim, setFiltroEmpresaIntFim] = useState("");
  const [qtdExibidaEmpresa, setQtdExibidaEmpresa] = useState(QTD_PADRAO);

  // Rodada 78 , pedido do usuário: opção de minimizar cada histórico
  // desta tela (só esconde da tela, não apaga nada).
  const [minhasSolicitacoesMinimizado, setMinhasSolicitacoesMinimizado] =
    useState(false);
  const [ajustesEmpresaMinimizado, setAjustesEmpresaMinimizado] =
    useState(false);

  const [formAberto, setFormAberto] = useState(false);
  const [etapaForm, setEtapaForm] = useState<EtapaForm>("EVENTO");
  const [tipoEvento, setTipoEvento] = useState<TipoEvento | null>(null);
  const [dataHora, setDataHora] = useState(""); // "DD/MM/AAAA HH:MM"
  // Rodada 53 , Android não tem um seletor único de data+hora: escolhe a
  // data primeiro, depois a hora, em dois diálogos nativos seguidos. iOS
  // tem `mode="datetime"` combinado, então usa só uma etapa lá.
  const [etapaSeletor, setEtapaSeletor] = useState<"FECHADO" | "DATA" | "HORA">(
    "FECHADO",
  );
  const [dataEmEscolha, setDataEmEscolha] = useState<Date | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      const [solicitacoes, ajustesEmpresa] = await Promise.all([
        listarMinhasSolicitacoes(credenciais),
        listarMeusAjustes(credenciais),
      ]);
      setMinhasSolicitacoes(solicitacoes);
      // Rodada 127 , pedido do usuário: "marcar como lido" aqui é só um
      // bookmark do próprio motorista (o gestor não precisa saber) , a
      // tela nunca pode esquecer isso ao recarregar a lista do
      // backend, então sobrepõe o que já foi marcado localmente antes
      // de qualquer coisa que o servidor diga (ou não diga, se a
      // sincronização ainda não rodou).
      const vistosLocais = obterAjustesVistosLocalmente();
      setAjustes(
        ajustesEmpresa.map((a) =>
          a.motoristaCienciaEm
            ? a
            : vistosLocais[a.id]
              ? { ...a, motoristaCienciaEm: vistosLocais[a.id] }
              : a,
        ),
      );
      // Abrir esta aba já mostra o status de cada pedido , conta como
      // "visto" pra zerar a bolinha do menu lateral.
      await marcarDecisoesComoVistas(solicitacoes);
      onTemAjusteNaoVistoMudou?.(false);
    } catch {
      // Sem internet agora , mantém a última lista carregada, sem travar a tela.
    } finally {
      setCarregando(false);
    }
  }, [onTemAjusteNaoVistoMudou]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function converterDataHora(texto: string): string | null {
    // Aceita "DD/MM/AAAA HH:MM" , digitado com máscara automática
    // (`aplicarMascaraDataHoraBr`) ou escolhido pelo seletor nativo.
    const m = texto
      .trim()
      .match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})$/);
    if (!m) return null;
    const [, dia, mes, ano, hora, minuto] = m;
    const data = new Date(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
    );
    if (Number.isNaN(data.getTime())) return null;
    return data.toISOString();
  }

  function formatarDataHoraBr(data: Date): string {
    const dia = data.getDate().toString().padStart(2, "0");
    const mes = (data.getMonth() + 1).toString().padStart(2, "0");
    const ano = data.getFullYear().toString().padStart(4, "0");
    const hora = data.getHours().toString().padStart(2, "0");
    const minuto = data.getMinutes().toString().padStart(2, "0");
    return dia + "/" + mes + "/" + ano + " " + hora + ":" + minuto;
  }

  function aoDigitarDataHora(texto: string) {
    setDataHora(aplicarMascaraDataHoraBr(texto));
  }

  function abrirSeletorDataHora() {
    setDataEmEscolha(null);
    setEtapaSeletor("DATA");
  }

  // Rodada 75 , `onChange` do datetimepicker foi descontinuado (avisa no
  // console); troca pelo substituto oficial: `onValueChange` (só chama
  // quando uma data de fato foi escolhida) + `onDismiss` (cancelamento).
  function aoEscolherDataAndroid(
    _evento: DateTimePickerChangeEvent,
    data: Date,
  ) {
    setDataEmEscolha(data);
    setEtapaSeletor("HORA");
  }

  function aoCancelarSeletorAndroid() {
    setEtapaSeletor("FECHADO");
  }

  function aoEscolherHoraAndroid(
    _evento: DateTimePickerChangeEvent,
    hora: Date,
  ) {
    setEtapaSeletor("FECHADO");
    if (!dataEmEscolha) return;
    const combinada = new Date(dataEmEscolha);
    combinada.setHours(hora.getHours(), hora.getMinutes(), 0, 0);
    setDataHora(formatarDataHoraBr(combinada));
  }

  // iOS: um único seletor com `mode="datetime"`, dentro de um modal
  // (mesmo padrão do `DataInput.tsx`, com botão "Concluído").
  function aoEscolherDataHoraIos(
    _evento: DateTimePickerChangeEvent,
    data: Date,
  ) {
    setDataEmEscolha(data);
  }

  function confirmarSeletorIos() {
    if (dataEmEscolha) setDataHora(formatarDataHoraBr(dataEmEscolha));
    setEtapaSeletor("FECHADO");
  }

  function abrirForm() {
    setFormAberto(true);
    setEtapaForm("EVENTO");
    setTipoEvento(null);
    setDataHora("");
    setJustificativa("");
    setErroForm(null);
  }

  function fecharForm() {
    setFormAberto(false);
    setEtapaForm("EVENTO");
    setTipoEvento(null);
    setDataHora("");
    setJustificativa("");
    setErroForm(null);
    setEtapaSeletor("FECHADO");
  }

  function onEscolherTipoEvento(tipo: TipoEvento) {
    setTipoEvento(tipo);
    setErroForm(null);
    setEtapaForm("DATA_HORA");
  }

  function onConfirmarDataHora() {
    setErroForm(null);
    if (!converterDataHora(dataHora)) {
      setErroForm(
        "Digite a data e hora no formato DD/MM/AAAA HH:MM (ex.: 20/09/2026 14:30).",
      );
      return;
    }
    setEtapaForm("MOTIVO");
  }

  async function onEnviarSolicitacao() {
    setErroForm(null);
    if (!tipoEvento) {
      setEtapaForm("EVENTO");
      return;
    }
    const timestampEvento = converterDataHora(dataHora);
    if (!timestampEvento) {
      setErroForm(
        "Digite a data e hora no formato DD/MM/AAAA HH:MM (ex.: 20/09/2026 14:30).",
      );
      setEtapaForm("DATA_HORA");
      return;
    }
    if (justificativa.trim().length < 10) {
      setErroForm("Explique com pelo menos 10 caracteres o que aconteceu.");
      return;
    }
    setEnviando(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      await criarSolicitacaoAjuste(credenciais, {
        tipoEvento,
        timestampEvento,
        justificativa: justificativa.trim(),
      });
      fecharForm();
      await carregar();
    } catch {
      setErroForm(
        "Não foi possível enviar agora. Confira sua internet e tente de novo.",
      );
    } finally {
      setEnviando(false);
    }
  }

  async function onDarCiencia(tratamentoId: string) {
    setProcessandoId(tratamentoId);
    try {
      // Rodada 79 , pedido do usuário: o app tem que funcionar sem
      // internet, e "marcar como lido" não pode exigir conexão nem
      // avisar sobre ela (removido o alerta "confira sua internet").
      // Agora funciona igual ao resto do app offline-first: atualiza a
      // tela e grava na fila local (SQLite) NA HORA; a tentativa de
      // rede logo em seguida é só uma otimização pra sincronizar mais
      // rápido quando há sinal. Se falhar (sem internet ou o backend
      // fora do ar), o item fica na fila e o SyncService tenta de novo
      // sozinho quando a conexão voltar , sem alertar nem travar o
      // motorista.
      setAjustes((atual) =>
        atual.map((a) =>
          a.id === tratamentoId
            ? { ...a, motoristaCienciaEm: new Date().toISOString() }
            : a,
        ),
      );
      // Rodada 127 , achado real do usuário: isto aqui é o bookmark
      // permanente (nunca é limpo), o que garante que o clique não se
      // perde ao sair e voltar pra aba , diferente da fila abaixo,
      // que é só a tentativa de avisar o backend (e some da fila
      // depois de sincronizar, tenha ela sucesso cedo ou tarde).
      registrarAjusteVistoLocalmente(tratamentoId);
      registrarCienciaPendente(tratamentoId);
      const credenciais = await obterCredenciais();
      if (credenciais) {
        try {
          await darCienciaAjuste(credenciais, tratamentoId);
          marcarCienciaEnviada(tratamentoId);
        } catch {
          // Sem internet agora , já está na fila local, sincroniza depois.
        }
      }
    } finally {
      setProcessandoId(null);
    }
  }

  async function onBaixarEvidenciaAjuste(evidencia: EvidenciaTratamento) {
    const credenciais = await obterCredenciais();
    if (!credenciais) return;
    try {
      await baixarEvidenciaAjuste(credenciais, evidencia);
    } catch {
      // Sem internet agora , sem travar a tela.
    }
  }

  async function onBaixarEvidenciaSolicitacao(
    evidencia: NonNullable<SolicitacaoAjustePonto["evidencias"]>[number],
  ) {
    const credenciais = await obterCredenciais();
    if (!credenciais) return;
    try {
      await baixarEvidenciaSolicitacao(credenciais, evidencia);
    } catch {
      // Sem internet agora , sem travar a tela.
    }
  }

  function mudarFiltroSolic(novo: FiltroPeriodo) {
    setFiltroSolic(novo);
    setQtdExibidaSolic(QTD_PADRAO);
  }

  function mudarFiltroEmpresa(novo: FiltroPeriodo) {
    setFiltroEmpresa(novo);
    setQtdExibidaEmpresa(QTD_PADRAO);
  }

  const solicitacoesFiltradas = useMemo(
    () =>
      minhasSolicitacoes.filter((s) =>
        dentroDoPeriodo(
          diaLocalIso(s.timestampEvento),
          filtroSolic,
          filtroSolicData,
          filtroSolicIntInicio,
          filtroSolicIntFim,
        ),
      ),
    [
      minhasSolicitacoes,
      filtroSolic,
      filtroSolicData,
      filtroSolicIntInicio,
      filtroSolicIntFim,
    ],
  );
  const solicitacoesExibidas = solicitacoesFiltradas.slice(0, qtdExibidaSolic);
  const restantesSolic =
    solicitacoesFiltradas.length - solicitacoesExibidas.length;

  const ajustesFiltrados = useMemo(
    () =>
      ajustes.filter((a) =>
        dentroDoPeriodo(
          diaLocalIso(a.timestampEvento),
          filtroEmpresa,
          filtroEmpresaData,
          filtroEmpresaIntInicio,
          filtroEmpresaIntFim,
        ),
      ),
    [
      ajustes,
      filtroEmpresa,
      filtroEmpresaData,
      filtroEmpresaIntInicio,
      filtroEmpresaIntFim,
    ],
  );
  const ajustesExibidos = ajustesFiltrados.slice(0, qtdExibidaEmpresa);
  const restantesAjustes = ajustesFiltrados.length - ajustesExibidos.length;

  function rotuloEvento(tipo: TipoEvento): string {
    return TIPOS_EVENTO.find((t) => t.tipo === tipo)?.rotulo ?? tipo;
  }

  function blocoFiltroPeriodo(opts: {
    filtro: FiltroPeriodo;
    aoMudarFiltro: (novo: FiltroPeriodo) => void;
    dataUnica: string;
    aoMudarDataUnica: (v: string) => void;
    intervaloInicio: string;
    aoMudarIntervaloInicio: (v: string) => void;
    intervaloFim: string;
    aoMudarIntervaloFim: (v: string) => void;
  }) {
    return (
      <View style={estilos.filtroBox}>
        <View style={estilos.presetsLinha}>
          {(
            [
              ["NENHUM", "Últimos " + QTD_PADRAO],
              ["DATA", "Data específica"],
              ["INTERVALO", "Intervalo"],
            ] as [FiltroPeriodo, string][]
          ).map(([valor, rotulo]) => (
            <TouchableOpacity
              key={valor}
              style={[
                estilos.presetChip,
                opts.filtro === valor && estilos.presetChipAtivo,
              ]}
              onPress={() => opts.aoMudarFiltro(valor)}
            >
              <Text
                style={[
                  estilos.presetChipTexto,
                  opts.filtro === valor && estilos.presetChipTextoAtivo,
                ]}
              >
                {rotulo}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {opts.filtro === "DATA" && (
          <DataInput
            valor={opts.dataUnica}
            onAlterar={opts.aoMudarDataUnica}
            placeholder="Data"
          />
        )}
        {opts.filtro === "INTERVALO" && (
          <View style={estilos.filtroPeriodo}>
            <View style={{ flex: 1 }}>
              <DataInput
                valor={opts.intervaloInicio}
                onAlterar={opts.aoMudarIntervaloInicio}
                placeholder="De"
              />
            </View>
            <View style={{ flex: 1 }}>
              <DataInput
                valor={opts.intervaloFim}
                onAlterar={opts.aoMudarIntervaloFim}
                placeholder="Até"
              />
            </View>
          </View>
        )}
      </View>
    );
  }

  const cabecalhoLista = (
    <>
      <Text style={estilos.titulo}>Ajustes</Text>

      <TouchableOpacity
        style={estilos.botaoPedir}
        onPress={() => (formAberto ? fecharForm() : abrirForm())}
      >
        <Text style={estilos.botaoPedirTexto}>
          {formAberto ? "Cancelar pedido" : "+ Pedir ajuste (esqueci de bater)"}
        </Text>
      </TouchableOpacity>

      {formAberto && (
        <View style={estilos.form}>
          {/* Resumo tocável das etapas já respondidas , permite voltar
              e corrigir sem reabrir tudo de novo. Só a etapa atual
              mostra os campos de verdade (Rodada 75). */}
          {etapaForm !== "EVENTO" && tipoEvento && (
            <TouchableOpacity
              style={estilos.resumoEtapa}
              onPress={() => setEtapaForm("EVENTO")}
            >
              <Text style={estilos.resumoEtapaTexto} numberOfLines={1}>
                Registro:{" "}
                <Text style={estilos.resumoEtapaValor}>
                  {rotuloEvento(tipoEvento)}
                </Text>
              </Text>
              <Text style={estilos.resumoEtapaAlterar}>alterar</Text>
            </TouchableOpacity>
          )}
          {etapaForm === "MOTIVO" && !!dataHora && (
            <TouchableOpacity
              style={estilos.resumoEtapa}
              onPress={() => setEtapaForm("DATA_HORA")}
            >
              <Text style={estilos.resumoEtapaTexto} numberOfLines={1}>
                Quando: <Text style={estilos.resumoEtapaValor}>{dataHora}</Text>
              </Text>
              <Text style={estilos.resumoEtapaAlterar}>alterar</Text>
            </TouchableOpacity>
          )}

          {etapaForm === "EVENTO" && (
            <>
              <Text style={estilos.formLabel}>
                Qual registro você esqueceu de bater?
              </Text>
              <View style={estilos.opcoesTipo}>
                {TIPOS_EVENTO.map((t) => (
                  <TouchableOpacity
                    key={t.tipo}
                    style={estilos.opcaoTipo}
                    onPress={() => onEscolherTipoEvento(t.tipo)}
                  >
                    <Text style={estilos.opcaoTipoTexto}>{t.rotulo}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {etapaForm === "DATA_HORA" && (
            <>
              <Text style={estilos.formLabel}>Data e hora</Text>
              <View style={estilos.linhaDataHora}>
                <TextInput
                  style={[estilos.input, estilos.inputDataHora]}
                  placeholder="DD/MM/AAAA HH:MM"
                  placeholderTextColor={cores.textoSecundario}
                  value={dataHora}
                  onChangeText={aoDigitarDataHora}
                  keyboardType="number-pad"
                  maxLength={16}
                />
                <TouchableOpacity
                  style={estilos.botaoCalendarioDataHora}
                  onPress={abrirSeletorDataHora}
                  accessibilityLabel="Abrir calendário pra escolher data e hora"
                >
                  <Text style={estilos.iconeCalendarioDataHora}>📅</Text>
                </TouchableOpacity>
              </View>

              {Platform.OS === "android" && etapaSeletor === "DATA" && (
                <DateTimePicker
                  value={dataEmEscolha ?? new Date()}
                  mode="date"
                  display="default"
                  onValueChange={aoEscolherDataAndroid}
                  onDismiss={aoCancelarSeletorAndroid}
                />
              )}
              {Platform.OS === "android" && etapaSeletor === "HORA" && (
                <DateTimePicker
                  value={dataEmEscolha ?? new Date()}
                  mode="time"
                  is24Hour
                  display="default"
                  onValueChange={aoEscolherHoraAndroid}
                  onDismiss={aoCancelarSeletorAndroid}
                />
              )}
              {Platform.OS === "ios" && (
                <Modal
                  visible={etapaSeletor !== "FECHADO"}
                  animationType="slide"
                  transparent
                  onRequestClose={() => setEtapaSeletor("FECHADO")}
                >
                  <Pressable
                    style={estilos.fundoModalDataHora}
                    onPress={() => setEtapaSeletor("FECHADO")}
                  >
                    <Pressable
                      style={estilos.caixaModalDataHora}
                      onPress={(e) => e.stopPropagation()}
                    >
                      <DateTimePicker
                        value={dataEmEscolha ?? new Date()}
                        mode="datetime"
                        display="spinner"
                        onValueChange={aoEscolherDataHoraIos}
                      />
                      <TouchableOpacity
                        style={estilos.botaoConcluidoDataHora}
                        onPress={confirmarSeletorIos}
                      >
                        <Text style={estilos.botaoConcluidoDataHoraTexto}>
                          Concluído
                        </Text>
                      </TouchableOpacity>
                    </Pressable>
                  </Pressable>
                </Modal>
              )}

              {erroForm && <Text style={estilos.erro}>{erroForm}</Text>}

              <View style={estilos.linhaBotoesEtapa}>
                <TouchableOpacity
                  style={estilos.botaoVoltar}
                  onPress={() => setEtapaForm("EVENTO")}
                >
                  <Text style={estilos.botaoVoltarTexto}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={estilos.botaoContinuar}
                  onPress={onConfirmarDataHora}
                >
                  <Text style={estilos.botaoContinuarTexto}>Continuar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {etapaForm === "MOTIVO" && (
            <>
              <Text style={estilos.formLabel}>O que aconteceu?</Text>
              <TextInput
                style={[estilos.input, estilos.inputMultilinha]}
                placeholder="ex.: esqueci de bater o fim da direção, cheguei no posto às 14h30"
                placeholderTextColor={cores.textoSecundario}
                value={justificativa}
                onChangeText={setJustificativa}
                multiline
                maxLength={400}
                numberOfLines={3}
              />

              {erroForm && <Text style={estilos.erro}>{erroForm}</Text>}

              <View style={estilos.linhaBotoesEtapa}>
                <TouchableOpacity
                  style={estilos.botaoVoltar}
                  onPress={() => setEtapaForm("DATA_HORA")}
                >
                  <Text style={estilos.botaoVoltarTexto}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={estilos.botaoEnviar}
                  disabled={enviando}
                  onPress={onEnviarSolicitacao}
                >
                  <Text style={estilos.botaoEnviarTexto}>
                    {enviando ? "Enviando..." : "Enviar pedido ao RH"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      <View style={estilos.linhaTituloSecao}>
        <Text style={estilos.secaoTitulo}>Minhas solicitações</Text>
        <BotaoMinimizar
          minimizado={minhasSolicitacoesMinimizado}
          onAlternar={() => setMinhasSolicitacoesMinimizado((v) => !v)}
          rotulo="solicitações"
        />
      </View>
      {!minhasSolicitacoesMinimizado && (
        <>
          {blocoFiltroPeriodo({
            filtro: filtroSolic,
            aoMudarFiltro: mudarFiltroSolic,
            dataUnica: filtroSolicData,
            aoMudarDataUnica: setFiltroSolicData,
            intervaloInicio: filtroSolicIntInicio,
            aoMudarIntervaloInicio: setFiltroSolicIntInicio,
            intervaloFim: filtroSolicIntFim,
            aoMudarIntervaloFim: setFiltroSolicIntFim,
          })}
          {solicitacoesExibidas.length === 0 && (
            <Text style={estilos.vazio}>
              {minhasSolicitacoes.length === 0
                ? "Nenhum pedido enviado ainda."
                : "Nenhum pedido no filtro selecionado."}
            </Text>
          )}
          {solicitacoesExibidas.map((s) => (
            <View key={s.id} style={estilos.item}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text style={estilos.itemTitulo}>{s.tipoEvento}</Text>
                <Text
                  style={[
                    estilos.statusTexto,
                    { color: CORES_STATUS[s.status] },
                  ]}
                >
                  {ROTULO_STATUS[s.status]}
                </Text>
              </View>
              <Text style={estilos.itemData}>
                Pedido para{" "}
                {new Date(s.timestampEvento).toLocaleString("pt-BR")}
              </Text>
              <Text style={estilos.itemMensagem}>{s.justificativa}</Text>
              {s.motivoDecisao && (
                <Text style={estilos.itemMeta}>
                  {s.status === "REJEITADA"
                    ? "Motivo da empresa: "
                    : "Observação da empresa: "}
                  {s.motivoDecisao}
                </Text>
              )}
              {(s.evidencias ?? []).length > 0 && (
                <View style={estilos.evidencias}>
                  {(s.evidencias ?? []).map((ev) => (
                    <TouchableOpacity
                      key={ev.id}
                      onPress={() => onBaixarEvidenciaSolicitacao(ev)}
                    >
                      <Text style={estilos.evidenciaLink}>
                        📎 {ev.nomeArquivo}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
          {restantesSolic > 0 && (
            <TouchableOpacity
              style={estilos.botaoCarregarMais}
              onPress={() => setQtdExibidaSolic((v) => v + QTD_INCREMENTO)}
            >
              <Text style={estilos.botaoCarregarMaisTexto}>
                Carregar mais ({restantesSolic} restantes)
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <View style={estilos.linhaTituloSecao}>
        <Text style={estilos.secaoTitulo}>Ajustes lançados pela empresa</Text>
        <BotaoMinimizar
          minimizado={ajustesEmpresaMinimizado}
          onAlternar={() => setAjustesEmpresaMinimizado((v) => !v)}
          rotulo="ajustes"
        />
      </View>
      {!ajustesEmpresaMinimizado &&
        blocoFiltroPeriodo({
          filtro: filtroEmpresa,
          aoMudarFiltro: mudarFiltroEmpresa,
          dataUnica: filtroEmpresaData,
          aoMudarDataUnica: setFiltroEmpresaData,
          intervaloInicio: filtroEmpresaIntInicio,
          aoMudarIntervaloInicio: setFiltroEmpresaIntInicio,
          intervaloFim: filtroEmpresaIntFim,
          aoMudarIntervaloFim: setFiltroEmpresaIntFim,
        })}
    </>
  );

  return (
    <FlatList
        showsVerticalScrollIndicator={false}
      style={estilos.container}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 40,
      }}
      refreshControl={
        <RefreshControl
          refreshing={carregando}
          onRefresh={() => void carregar()}
        />
      }
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={cabecalhoLista}
      data={ajustesEmpresaMinimizado ? [] : ajustesExibidos}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={estilos.item}>
          <View style={estilos.itemCabecalho}>
            <Text style={estilos.itemTitulo}>{item.tipoEvento}</Text>
            {/* Rodada 79: agora que o backend só devolve aqui os ajustes que o
                RH lançou direto (o que veio de solicitação aprovada do
                motorista já aparece em "Minhas solicitações"), deixa isso
                explícito com um selo , evita confusão sobre de onde veio. */}
            <View style={estilos.seloRh}>
              <Text style={estilos.seloRhTexto}>Lançado pelo RH</Text>
            </View>
          </View>
          <Text style={estilos.itemData}>
            Referente a {new Date(item.timestampEvento).toLocaleString("pt-BR")}
          </Text>
          <Text style={estilos.itemMensagem}>{item.motivo}</Text>
          <Text style={estilos.itemMeta}>
            Lançado por {item.usuario?.nome ?? "empresa"} em{" "}
            {new Date(item.createdAt).toLocaleString("pt-BR")}
          </Text>

          {(item.evidencias ?? []).length > 0 && (
            <View style={estilos.evidencias}>
              {(item.evidencias ?? []).map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  onPress={() => onBaixarEvidenciaAjuste(ev)}
                >
                  <Text style={estilos.evidenciaLink}>📎 {ev.nomeArquivo}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {item.motoristaCienciaEm ? (
            <Text style={estilos.itemCiencia}>
              Visto em{" "}
              {new Date(item.motoristaCienciaEm).toLocaleString("pt-BR")}
            </Text>
          ) : (
            <TouchableOpacity
              style={estilos.botaoCiencia}
              disabled={processandoId === item.id}
              onPress={() => onDarCiencia(item.id)}
            >
              <Text style={estilos.botaoCienciaTexto}>
                {processandoId === item.id ? "Marcando..." : "Marcar como lido"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      ListEmptyComponent={
        <Text style={estilos.vazio}>
          {ajustesEmpresaMinimizado
            ? "Ajustes minimizados."
            : ajustes.length === 0
              ? "Nenhum ajuste lançado pela empresa."
              : "Nenhum ajuste no filtro selecionado."}
        </Text>
      }
      ListFooterComponent={
        !ajustesEmpresaMinimizado && restantesAjustes > 0 ? (
          <TouchableOpacity
            style={estilos.botaoCarregarMais}
            onPress={() => setQtdExibidaEmpresa((v) => v + QTD_INCREMENTO)}
          >
            <Text style={estilos.botaoCarregarMaisTexto}>
              Carregar mais ({restantesAjustes} restantes)
            </Text>
          </TouchableOpacity>
        ) : null
      }
    />
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: cores.fundo },
    titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
    secaoTitulo: {
      fontSize: 15,
      fontWeight: "700",
      color: cores.texto,
      marginTop: 20,
      marginBottom: 8,
      flexShrink: 1,
    },
    // Rodada 78 , título da seção + botão de minimizar lado a lado.
    linhaTituloSecao: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      columnGap: 8,
      rowGap: 2,
    },
    vazio: { color: cores.textoSecundario, marginBottom: 8 },
    botaoPedir: {
      marginTop: 12,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: "center",
      backgroundColor: cores.fundoCartao,
      borderWidth: 1,
      borderColor: cores.borda,
    },
    botaoPedirTexto: { fontWeight: "700", color: cores.texto },
    form: {
      marginTop: 12,
      padding: 12,
      borderRadius: 10,
      backgroundColor: cores.fundoCartao,
      borderWidth: 1,
      borderColor: cores.borda,
      gap: 4,
    },
    // Rodada 75 , resumo tocável de uma etapa já respondida (fica no
    // topo do formulário enquanto as etapas seguintes acontecem).
    resumoEtapa: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: cores.fundo,
      borderWidth: 1,
      borderColor: cores.borda,
      marginBottom: 4,
    },
    resumoEtapaTexto: {
      fontSize: 13,
      color: cores.textoSecundario,
      flexShrink: 1,
      marginRight: 8,
    },
    resumoEtapaValor: { color: cores.texto, fontWeight: "700" },
    resumoEtapaAlterar: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
    formLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: cores.textoSecundario,
      marginTop: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: cores.borda,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: cores.texto,
      marginTop: 4,
    },
    inputMultilinha: { minHeight: 70, textAlignVertical: "top" },
    // Rodada 53 , campo de data/hora ganhou máscara automática + botão
    // de calendário nativo, mesmo espírito do `DataInput.tsx` genérico
    // (aqui não reaproveitado direto porque este campo tem HORA junto).
    linhaDataHora: { flexDirection: "row", gap: 8, alignItems: "center" },
    inputDataHora: { flex: 1, marginTop: 0 },
    botaoCalendarioDataHora: {
      borderWidth: 1,
      borderColor: cores.borda,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      justifyContent: "center",
      alignItems: "center",
    },
    iconeCalendarioDataHora: { fontSize: 16 },
    fundoModalDataHora: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    caixaModalDataHora: {
      backgroundColor: cores.fundoCartao,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 12,
      paddingBottom: 24,
      paddingHorizontal: 16,
    },
    botaoConcluidoDataHora: {
      backgroundColor: cores.primario,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 8,
    },
    botaoConcluidoDataHoraTexto: {
      color: cores.primarioTexto,
      fontWeight: "700",
      fontSize: 15,
    },
    // Rodada 64: lista vertical de linhas grandes, no lugar do "quadro"
    // de pílulas pequenas , cada evento ocupa a largura toda, com fonte
    // maior, pra ser fácil de ler e tocar. Rodada 75: tocar já
    // seleciona E avança pra próxima etapa (sem estado de "selecionado"
    // persistente , a escolha feita vira o resumo tocável acima).
    opcoesTipo: { flexDirection: "column", gap: 8, marginTop: 4 },
    opcaoTipo: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: cores.borda,
      width: "100%",
    },
    opcaoTipoTexto: { fontSize: 15, color: cores.texto },
    erro: { color: "#b91c1c", fontSize: 12, marginTop: 8 },
    // Rodada 75 , linha de navegação da etapa (Voltar / Continuar ou Enviar).
    linhaBotoesEtapa: { flexDirection: "row", gap: 8, marginTop: 12 },
    botaoVoltar: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: "center",
      borderWidth: 1,
      borderColor: cores.borda,
    },
    botaoVoltarTexto: { color: cores.texto, fontWeight: "600" },
    botaoContinuar: {
      flex: 2,
      backgroundColor: cores.texto,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    botaoContinuarTexto: { color: cores.fundo, fontWeight: "700" },
    botaoEnviar: {
      flex: 2,
      backgroundColor: cores.texto,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    botaoEnviarTexto: { color: cores.fundo, fontWeight: "700" },
    // Rodada 75 , mesmo padrão visual de filtro por período do
    // Histórico/comprovante (`HistoricoScreen.tsx`), reaproveitado aqui
    // pras duas listas desta tela.
    filtroBox: { marginBottom: 12, gap: 8 },
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
    filtroPeriodo: { flexDirection: "row", gap: 8 },
    item: {
      backgroundColor: cores.fundoCartao,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: cores.borda,
      padding: 12,
      gap: 4,
      marginBottom: 8,
    },
    itemTitulo: { fontSize: 14, fontWeight: "700", color: cores.texto },
    itemCabecalho: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    seloRh: {
      backgroundColor: cores.primario,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    seloRhTexto: {
      fontSize: 10,
      fontWeight: "700",
      color: cores.primarioTexto,
    },
    itemMensagem: { fontSize: 13, color: cores.texto, marginTop: 2 },
    itemMeta: { fontSize: 11, color: cores.textoSecundario, marginTop: 2 },
    itemData: { fontSize: 12, color: cores.textoSecundario },
    itemCiencia: {
      fontSize: 12,
      color: cores.textoSecundario,
      marginTop: 6,
      fontStyle: "italic",
    },
    statusTexto: { fontSize: 12, fontWeight: "700" },
    evidencias: { marginTop: 6, gap: 2 },
    evidenciaLink: {
      fontSize: 12,
      color: "#2563eb",
      textDecorationLine: "underline",
    },
    botaoCiencia: {
      marginTop: 8,
      alignSelf: "flex-start",
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: cores.fundo,
      borderWidth: 1,
      borderColor: cores.borda,
    },
    botaoCienciaTexto: { fontSize: 12, fontWeight: "600", color: cores.texto },
    botaoCarregarMais: { paddingVertical: 14, alignItems: "center" },
    botaoCarregarMaisTexto: {
      color: cores.texto,
      fontWeight: "600",
      textDecorationLine: "underline",
    },
  });
}
