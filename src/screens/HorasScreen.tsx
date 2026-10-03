import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  autorrelatarFolga,
  listarAutorrelatosFolga,
} from "../api/autorrelatoFolga";
import type { AutorrelatoFolga } from "../api/autorrelatoFolga";
import { listarFolgasConcedidas } from "../api/folgaConcedida";
import type { FolgaConcedida } from "../api/folgaConcedida";
import { obterMinhasHoras } from "../api/motorista";
import type { MinhasHoras } from "../api/motorista";
import { dataIsoParaBr } from "../utils/mascaras";
import { adicionarDataFolgaAvisadaLocal } from "../storage/folgaAvisadaLocal";
import { obterCredenciais } from "../storage/secureCredentials";
import { DataInput } from "../components/DataInput";
import { BotaoMinimizar } from "../components/BotaoMinimizar";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

/** "0" -> "Outubro de 2026" (mês atual), "1" -> "Setembro de 2026" (mês anterior), etc. */
function nomeDoMes(mesesAtras: number): string {
  const agora = new Date();
  const data = new Date(agora.getFullYear(), agora.getMonth() - mesesAtras, 1);
  const texto = data.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** minutos → "Xh Ymin" (mesmo formato do painel do gestor). */
function minParaHoras(min: number): string {
  const sinal = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sinal}${h}h ${String(m).padStart(2, "0")}min`;
}

/**
 * "Minhas horas" (Rodada 39) , o motorista acompanha, no próprio
 * celular, quanto já trabalhou no mês (direção, espera, noturno) e,
 * se a empresa usar banco de horas (configurado nas Regras sindicais
 * do painel), o saldo do mês e o saldo total desde que ele foi
 * cadastrado.
 *
 * Rodada 134 , pedido do usuário: "retire esse campo [horas extras] e
 * deixe apenas as horas totais do motorista do mês vigente, tendo a
 * possibilidade de buscar os resultados de meses anteriores" , o
 * campo "Horas extras" saiu da tela (continua existindo no backend,
 * só não aparece mais aqui), e agora dá pra navegar pros meses
 * anteriores com as flechas ao lado do nome do mês (nunca avança além
 * do mês atual).
 */
export function HorasScreen() {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [dados, setDados] = useState<MinhasHoras | null>(null);
  const [folgas, setFolgas] = useState<AutorrelatoFolga[]>([]);
  const [folgasConcedidas, setFolgasConcedidas] = useState<FolgaConcedida[]>(
    [],
  );
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Rodada 134 , pedido do usuário: "possibilidade de buscar os
  // resultados de meses anteriores". 0 = mês atual, 1 = mês anterior,
  // 2 = dois meses atrás, etc , nunca deixa passar de 0 (não existe
  // "mês seguinte" ao atual, não teria dados).
  const [mesesAtras, setMesesAtras] = useState(0);

  // Rodada 64 , "Avisar folga" veio do RegistrarPontoScreen: lá ficava
  // fixo embaixo dos botões de status em toda etapa do registro de
  // ponto (pedido do usuário pra mover, já que competia com os botões
  // de bater ponto). Junta com o resto do que já é sobre folga nesta
  // aba (cards "Minhas folgas avisadas"/"Folgas concedidas", Rodada 57/58).
  const [mostrarFolga, setMostrarFolga] = useState(false);
  const [dataFolga, setDataFolga] = useState("");
  const [observacaoFolga, setObservacaoFolga] = useState("");
  const [avisandoFolga, setAvisandoFolga] = useState(false);
  // Rodada 78 , pedido do usuário: minimizar os históricos de folga
  // desta tela (só esconde da tela, não apaga nada).
  const [folgasAvisadasMinimizado, setFolgasAvisadasMinimizado] =
    useState(false);
  const [folgasConcedidasMinimizado, setFolgasConcedidasMinimizado] =
    useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      const agora = new Date();
      const base = new Date(
        agora.getFullYear(),
        agora.getMonth() - mesesAtras,
        1,
      );
      const resultado = await obterMinhasHoras(credenciais, {
        ano: base.getFullYear(),
        mes: base.getMonth() + 1,
      });
      setDados(resultado);

      // Rodada 57 , pedido do usuário: os avisos de folga aparecem
      // aqui, junto com as horas, num card separado , assim o
      // motorista consegue conferir os próprios "pedidos" de folga já
      // enviados, sem precisar perguntar pro gestor se chegou. Busca
      // separada (não derruba a tela de horas se só isto falhar).
      try {
        const autorrelatos = await listarAutorrelatosFolga(credenciais);
        setFolgas(autorrelatos);
      } catch {
        // Sem rede agora , mantém a última lista de folgas carregada.
      }

      // Rodada 58 , pedido do usuário: folga concedida pela empresa
      // recebe o mesmo tratamento da avisada pelo motorista , também
      // aparece aqui, num card à parte (é uma origem diferente: quem
      // decidiu foi o gestor, não o motorista).
      try {
        const concedidas = await listarFolgasConcedidas(credenciais);
        setFolgasConcedidas(concedidas);
      } catch {
        // Sem rede agora , mantém a última lista carregada.
      }

      setErro(null);
    } catch {
      setErro(
        "Não foi possível atualizar agora , mostrando os últimos dados carregados (se houver).",
      );
    } finally {
      setCarregando(false);
    }
  }, [mesesAtras]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function validarDataFolga(texto: string): string | undefined {
    if (!texto.trim()) return undefined;
    // Aceita AAAA-MM-DD (o mais fácil de digitar sem um date picker nativo).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto.trim())) {
      throw new Error(`Data inválida: "${texto}". Use o formato AAAA-MM-DD.`);
    }
    return texto.trim();
  }

  async function onAvisarFolga() {
    setAvisandoFolga(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      const dia = validarDataFolga(dataFolga);
      if (!dia) {
        Alert.alert(
          "Data obrigatória",
          "Informe o dia da folga no formato AAAA-MM-DD.",
        );
        return;
      }
      await autorrelatarFolga(
        credenciais,
        dia,
        observacaoFolga.trim() || undefined,
      );
      // Mesmo cuidado do RegistrarPontoScreen original (Rodada 57):
      // precisa ser `await` (não fire-and-forget) , é esse cache local
      // que permite avisar o motorista (mesmo offline) se ele tentar
      // bater ponto nesse mesmo dia mais tarde, na outra aba.
      await adicionarDataFolgaAvisadaLocal(dia);
      setDataFolga("");
      setObservacaoFolga("");
      setMostrarFolga(false);
      Alert.alert(
        "Folga avisada",
        "A empresa vai ver que este dia foi de folga, não falta de registro.",
      );
      void carregar();
    } catch (err) {
      Alert.alert(
        "Não foi possível avisar",
        err instanceof Error ? err.message : "Erro desconhecido",
      );
    } finally {
      setAvisandoFolga(false);
    }
  }

  return (
    <ScrollView
      style={estilos.container}
      contentContainerStyle={estilos.conteudo}
      refreshControl={
        <RefreshControl
          refreshing={carregando}
          onRefresh={() => void carregar()}
        />
      }
    >
      <Text style={estilos.titulo}>Minhas horas</Text>

      {/* Rodada 134 , pedido do usuário: "tendo a possibilidade de
          buscar os resultados de meses anteriores". Flecha "anterior"
          sempre disponível, "seguinte" desabilitada no mês atual (não
          existe mês futuro com dados). */}
      <View style={estilos.seletorMes}>
        <TouchableOpacity
          onPress={() => setMesesAtras((v) => v + 1)}
          style={estilos.botaoSetaMes}
        >
          <Text style={estilos.botaoSetaMesTexto}>‹ Mês anterior</Text>
        </TouchableOpacity>
        <Text style={estilos.subtitulo}>
          {nomeDoMes(mesesAtras)}
          {mesesAtras === 0 ? ", até hoje" : ""}
        </Text>
        <TouchableOpacity
          onPress={() => setMesesAtras((v) => Math.max(0, v - 1))}
          disabled={mesesAtras === 0}
          style={[
            estilos.botaoSetaMes,
            mesesAtras === 0 && estilos.botaoSetaMesDesabilitado,
          ]}
        >
          <Text
            style={[
              estilos.botaoSetaMesTexto,
              mesesAtras === 0 && estilos.botaoSetaMesTextoDesabilitado,
            ]}
          >
            Mês seguinte ›
          </Text>
        </TouchableOpacity>
      </View>

      {erro && <Text style={estilos.erro}>{erro}</Text>}

      {dados && (
        <>
          <View style={estilos.cartao}>
            <Text style={estilos.cartaoTitulo}>
              {mesesAtras === 0 ? "Este mês" : nomeDoMes(mesesAtras)}
            </Text>
            <LinhaHora
              rotulo="Direção"
              valorMin={dados.horasMes.direcaoMin}
              cores={cores}
            />
            <LinhaHora
              rotulo="Espera"
              valorMin={dados.horasMes.esperaMin}
              cores={cores}
            />
            <LinhaHora
              rotulo="Noturno"
              valorMin={dados.horasMes.noturnoMin}
              cores={cores}
            />
          </View>

          {dados.bancoHoras?.ativo ? (
            <View style={estilos.cartao}>
              <Text style={estilos.cartaoTitulo}>Banco de horas</Text>
              <Text style={estilos.textoAjuda}>
                Sua empresa usa banco de horas: a hora extra apurada entra como
                crédito, a ser compensado em folga ou pago, de acordo com a
                convenção coletiva. Fale com o RH pra compensar ou receber.
              </Text>
              <LinhaHora
                rotulo="Saldo deste mês"
                valorMin={dados.bancoHoras.saldoMesMin}
                cores={cores}
                destaque
              />
              <LinhaHora
                rotulo="Saldo total (desde que comecei)"
                valorMin={dados.bancoHoras.saldoTotalMin}
                cores={cores}
                destaque
              />
            </View>
          ) : (
            <Text style={estilos.textoAjuda}>
              Sua empresa não usa banco de horas , hora extra é apurada
              normalmente pelo RH, fora deste saldo.
            </Text>
          )}
        </>
      )}

      {!dados && !carregando && !erro && (
        <Text style={estilos.textoAjuda}>
          Sem dados ainda , puxe pra atualizar.
        </Text>
      )}

      {/* Rodada 64 , "Avisar folga" (veio do RegistrarPontoScreen, ver
          comentário no state acima) , mesmo destaque visual de antes:
          retângulo grande, fonte maior, fácil de enxergar e usar. */}
      <TouchableOpacity
        style={estilos.botaoFolgaDestaque}
        onPress={() => setMostrarFolga((v) => !v)}
      >
        <Text style={estilos.botaoFolgaDestaqueTexto}>
          {mostrarFolga
            ? "Ocultar aviso de folga ▲"
            : "📅 Avisar dia de folga (não é ponto) ▼"}
        </Text>
      </TouchableOpacity>
      {mostrarFolga && (
        <View style={estilos.folgaBox}>
          <DataInput
            valor={dataFolga}
            onAlterar={setDataFolga}
            placeholder="Dia da folga"
          />
          <TextInput
            style={estilos.inputFolga}
            placeholder="Observação (opcional)"
            placeholderTextColor={cores.inputPlaceholder}
            value={observacaoFolga}
            onChangeText={setObservacaoFolga}
          />
          <TouchableOpacity
            style={estilos.botaoConfirmarFolga}
            onPress={() => void onAvisarFolga()}
            disabled={avisandoFolga}
          >
            <Text style={estilos.botaoConfirmarFolgaTexto}>
              {avisandoFolga ? "Avisando..." : "Avisar folga"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Rodada 57 , pedido do usuário: card separado, junto com as
          horas, pra conferir os avisos de folga já enviados ("meus
          pedidos"). Mesma fonte de dados que alimenta o Histórico. */}
      <View style={estilos.cartao}>
        <View style={estilos.linhaCartaoTitulo}>
          <Text style={estilos.cartaoTitulo}>Minhas folgas avisadas</Text>
          <BotaoMinimizar
            minimizado={folgasAvisadasMinimizado}
            onAlternar={() => setFolgasAvisadasMinimizado((v) => !v)}
            rotulo="folgas avisadas"
          />
        </View>
        {!folgasAvisadasMinimizado &&
          (folgas.length === 0 ? (
            <Text style={estilos.textoAjuda}>Nenhuma folga avisada ainda.</Text>
          ) : (
            folgas.map((folga) => (
              <View key={folga.id} style={estilos.linhaFolga}>
                <Text style={estilos.linhaFolgaData}>
                  {dataIsoParaBr(folga.data.slice(0, 10))}
                </Text>
                {folga.observacao && (
                  <Text style={estilos.linhaFolgaObservacao}>
                    {folga.observacao}
                  </Text>
                )}
              </View>
            ))
          ))}
      </View>

      {/* Rodada 58 , pedido do usuário: mesmo tratamento pra folga
          concedida pela empresa, card separado (a origem é diferente ,
          decisão do gestor, não do motorista). */}
      <View style={estilos.cartao}>
        <View style={estilos.linhaCartaoTitulo}>
          <Text style={estilos.cartaoTitulo}>
            Folgas concedidas pela empresa
          </Text>
          <BotaoMinimizar
            minimizado={folgasConcedidasMinimizado}
            onAlternar={() => setFolgasConcedidasMinimizado((v) => !v)}
            rotulo="folgas concedidas"
          />
        </View>
        {!folgasConcedidasMinimizado &&
          (folgasConcedidas.length === 0 ? (
            <Text style={estilos.textoAjuda}>
              Nenhuma folga concedida ainda.
            </Text>
          ) : (
            folgasConcedidas.map((folga) => (
              <View key={folga.id} style={estilos.linhaFolga}>
                <Text style={estilos.linhaFolgaData}>
                  {dataIsoParaBr(folga.data.slice(0, 10))}
                </Text>
                {folga.motivo && (
                  <Text style={estilos.linhaFolgaObservacao}>
                    {folga.motivo}
                  </Text>
                )}
              </View>
            ))
          ))}
      </View>
    </ScrollView>
  );
}

function LinhaHora({
  rotulo,
  valorMin,
  cores,
  destaque,
}: {
  rotulo: string;
  valorMin: number;
  cores: CoresTema;
  destaque?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
      }}
    >
      <Text style={{ fontSize: 14, color: cores.textoSecundario }}>
        {rotulo}
      </Text>
      <Text
        style={{
          fontSize: destaque ? 16 : 14,
          fontWeight: destaque ? "700" : "600",
          color: cores.texto,
        }}
      >
        {minParaHoras(valorMin)}
      </Text>
    </View>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: cores.fundo },
    conteudo: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 },
    titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
    subtitulo: {
      fontSize: 13,
      color: cores.textoSecundario,
      marginTop: 2,
      marginBottom: 12,
      textAlign: "center",
      flexShrink: 1,
    },
    // Rodada 134 , seletor de mês (flechas anterior/seguinte).
    seletorMes: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 4,
    },
    botaoSetaMes: { paddingVertical: 6, paddingHorizontal: 4 },
    botaoSetaMesTexto: {
      fontSize: 13,
      color: cores.primario,
      fontWeight: "600",
    },
    botaoSetaMesDesabilitado: { opacity: 0.35 },
    botaoSetaMesTextoDesabilitado: { color: cores.textoSecundario },
    erro: { color: cores.perigo, marginBottom: 12 },
    cartao: {
      backgroundColor: cores.fundoCartao,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: cores.borda,
      padding: 14,
      marginBottom: 16,
    },
    cartaoTitulo: {
      fontSize: 15,
      fontWeight: "700",
      color: cores.texto,
      marginBottom: 8,
      flexShrink: 1,
    },
    // Rodada 78 , título do cartão + botão de minimizar lado a lado.
    linhaCartaoTitulo: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      columnGap: 8,
      rowGap: 2,
    },
    textoAjuda: { fontSize: 12, color: cores.textoSecundario, marginBottom: 8 },
    linhaFolga: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: cores.borda,
    },
    linhaFolgaData: { fontSize: 14, fontWeight: "600", color: cores.texto },
    linhaFolgaObservacao: {
      fontSize: 12,
      color: cores.textoSecundario,
      marginTop: 2,
    },
    botaoFolgaDestaque: {
      marginBottom: 16,
      backgroundColor: "#b45309",
      borderRadius: 12,
      paddingVertical: 22,
      alignItems: "center",
    },
    botaoFolgaDestaqueTexto: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 19,
      textAlign: "center",
    },
    folgaBox: {
      marginTop: -8,
      marginBottom: 16,
      gap: 8,
      backgroundColor: cores.fundoCartao,
      borderRadius: 10,
      padding: 12,
    },
    inputFolga: {
      backgroundColor: cores.inputFundo,
      color: cores.texto,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      borderWidth: 1,
      borderColor: cores.inputBorda,
    },
    botaoConfirmarFolga: {
      backgroundColor: "#2563eb",
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    botaoConfirmarFolgaTexto: {
      color: "#fff",
      fontWeight: "600",
      fontSize: 15,
    },
  });
}
