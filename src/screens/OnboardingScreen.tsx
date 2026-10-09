import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  limparSolicitacaoPendente,
  obterOuCriarDeviceUuid,
  obterSolicitacaoPendente,
  salvarSolicitacaoPendente,
  salvarVinculo,
} from "../storage/secureCredentials";
import { solicitarTrocaDispositivo } from "../api/dispositivos";
import { aplicarMascaraCpf, somenteDigitos } from "../utils/mascaras";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

/**
 * Primeira tela do app. Fluxo do vínculo (sem nenhuma rota pública de
 * "self-service", de propósito , só a empresa autoriza um aparelho):
 *
 *  1. O app gera (ou recupera) o deviceUuid deste aparelho e mostra na
 *     tela.
 *  2. O motorista informa esse código pro RH/gestor da empresa.
 *  3. O gestor cola o código no painel web (tela do motorista > vincular
 *     dispositivo) e recebe de volta uma deviceApiKey , mostrada UMA
 *     única vez no painel.
 *  4. O gestor passa essa key + o ID do motorista pro motorista, que
 *     cola os dois campos abaixo para concluir o vínculo neste
 *     aparelho.
 *
 * TROCA DE APARELHO: se o motorista já tinha vínculo em outro celular
 * (perdido, quebrado, trocado) e está abrindo o app pela primeira vez
 * NESTE aparelho, ele ainda não tem uma deviceApiKey , em vez de ficar
 * esperando o gestor "adivinhar", ele mesmo dispara o pedido pela seção
 * 3 abaixo. Isso não vincula nada: só entra na fila do painel
 * (`solicitacoes-troca-dispositivo`) esperando ADMIN/GESTOR aprovar. Só
 * depois disso o gestor terá uma deviceApiKey nova pra passar pro
 * motorista completar o vínculo pela seção 2.
 */
export function OnboardingScreen({ onVinculado }: { onVinculado: () => void }) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [deviceUuid, setDeviceUuid] = useState<string | null>(null);
  const [motoristaId, setMotoristaId] = useState("");
  const [deviceApiKey, setDeviceApiKey] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [observacaoTroca, setObservacaoTroca] = useState("");
  const [solicitandoTroca, setSolicitandoTroca] = useState(false);
  const [solicitacaoEnviada, setSolicitacaoEnviada] = useState(false);
  const [motoristaIdTroca, setMotoristaIdTroca] = useState("");
  const [cpfTroca, setCpfTroca] = useState("");

  useEffect(() => {
    obterOuCriarDeviceUuid().then(setDeviceUuid);
    obterSolicitacaoPendente().then((motoristaIdPendente) => {
      if (motoristaIdPendente) {
        setMotoristaIdTroca(motoristaIdPendente);
        setSolicitacaoEnviada(true);
      }
    });
  }, []);

  async function copiarUuid() {
    if (!deviceUuid) return;
    await Clipboard.setStringAsync(deviceUuid);
    Alert.alert(
      "Copiado",
      "Código do aparelho copiado. Envie para o RH/gestor da sua empresa.",
    );
  }

  async function concluirVinculo() {
    if (!motoristaId.trim() || !deviceApiKey.trim()) {
      Alert.alert(
        "Preencha os dois campos",
        "ID do motorista e a chave do dispositivo são obrigatórios.",
      );
      return;
    }
    setSalvando(true);
    try {
      await salvarVinculo(motoristaId.trim(), deviceApiKey.trim());
      await limparSolicitacaoPendente(); // se havia uma troca pendente, já foi resolvida
      onVinculado();
    } finally {
      setSalvando(false);
    }
  }

  async function onSolicitarTroca() {
    if (!deviceUuid) return;
    if (!motoristaIdTroca.trim()) {
      Alert.alert(
        "Informe o ID do motorista",
        "Precisamos saber de quem é o vínculo pra avisar o gestor certo.",
      );
      return;
    }
    if (!/^\d{11}$/.test(cpfTroca.trim())) {
      Alert.alert(
        "Informe seu CPF",
        "Digite os 11 números do seu CPF (sem pontos ou traço) , é como confirmamos que o pedido é seu.",
      );
      return;
    }
    setSolicitandoTroca(true);
    try {
      await solicitarTrocaDispositivo(
        motoristaIdTroca.trim(),
        cpfTroca.trim(),
        deviceUuid,
        observacaoTroca.trim() || undefined,
      );
      await salvarSolicitacaoPendente(motoristaIdTroca.trim());
      setSolicitacaoEnviada(true);
    } catch (err) {
      Alert.alert(
        "Não foi possível enviar",
        err instanceof Error ? err.message : "Erro desconhecido",
      );
    } finally {
      setSolicitandoTroca(false);
    }
  }

  if (!deviceUuid) {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator color={cores.texto} />
      </View>
    );
  }

  return (
    <ScrollView
        showsVerticalScrollIndicator={false}
      style={{ backgroundColor: cores.fundo }}
      contentContainerStyle={estilos.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={estilos.titulo}>Vincular este aparelho</Text>

      <View style={estilos.card}>
        <Text style={estilos.rotulo}>1. Código deste aparelho</Text>
        <Text style={estilos.uuid} selectable>
          {deviceUuid}
        </Text>
        <Text style={estilos.ajuda}>
          Informe este código ao RH/gestor da sua empresa para liberar o
          vínculo.
        </Text>
        <TouchableOpacity style={estilos.botaoSecundario} onPress={copiarUuid}>
          <Text style={estilos.botaoSecundarioTexto}>Copiar código</Text>
        </TouchableOpacity>
      </View>

      <View style={estilos.card}>
        <Text style={estilos.rotulo}>
          2. Depois que a empresa vincular, informe:
        </Text>
        <TextInput
          style={estilos.input}
          placeholder="ID do motorista (fornecido pela empresa)"
          placeholderTextColor={cores.inputPlaceholder}
          value={motoristaId}
          onChangeText={setMotoristaId}
          maxLength={36}
          autoCapitalize="none"
        />
        <TextInput
          style={estilos.input}
          placeholder="Chave do dispositivo (fornecida pela empresa)"
          placeholderTextColor={cores.inputPlaceholder}
          value={deviceApiKey}
          onChangeText={setDeviceApiKey}
          maxLength={200}
          autoCapitalize="none"
          secureTextEntry
        />
        <TouchableOpacity
          style={estilos.botao}
          onPress={concluirVinculo}
          disabled={salvando}
        >
          <Text style={estilos.botaoTexto}>
            {salvando ? "Salvando..." : "Concluir vínculo"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={estilos.card}>
        <Text style={estilos.rotulo}>
          3. Trocou de aparelho? Peça a troca aqui
        </Text>
        <Text style={estilos.ajuda}>
          Se você já tinha vínculo em outro celular (perdido, quebrado ou
          trocado), avise o gestor por aqui , ele precisa aprovar antes de você
          conseguir bater ponto neste aparelho novo.
        </Text>
        {solicitacaoEnviada ? (
          <View style={{ gap: 8 }}>
            <Text style={estilos.confirmacao}>
              Pedido enviado. Aguarde o gestor aprovar , ele vai te passar uma
              nova chave pra você colar na seção 2 acima.
            </Text>
            <TouchableOpacity onPress={() => setSolicitacaoEnviada(false)}>
              <Text style={estilos.botaoSecundarioTexto}>
                Enviar de novo / corrigir dados
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              style={estilos.input}
              placeholder="ID do motorista"
              placeholderTextColor={cores.inputPlaceholder}
              value={motoristaIdTroca}
              onChangeText={setMotoristaIdTroca}
              maxLength={36}
              autoCapitalize="none"
            />
            <TextInput
              style={estilos.input}
              placeholder="Seu CPF , confirma que o pedido é seu"
              placeholderTextColor={cores.inputPlaceholder}
              value={aplicarMascaraCpf(cpfTroca)}
              onChangeText={(texto) => setCpfTroca(somenteDigitos(texto))}
              keyboardType="number-pad"
              maxLength={14}
            />
            <TextInput
              style={estilos.input}
              placeholder="Observação (opcional) , ex.: celular anterior quebrou"
              placeholderTextColor={cores.inputPlaceholder}
              value={observacaoTroca}
              onChangeText={setObservacaoTroca}
            />
            <TouchableOpacity
              style={estilos.botaoSecundarioCheio}
              onPress={onSolicitarTroca}
              disabled={solicitandoTroca}
            >
              <Text style={estilos.botaoSecundarioCheioTexto}>
                {solicitandoTroca
                  ? "Enviando..."
                  : "Solicitar troca de aparelho"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    centro: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: cores.fundo,
    },
    container: { padding: 20, paddingTop: 60, gap: 16 },
    titulo: {
      fontSize: 22,
      fontWeight: "700",
      marginBottom: 8,
      color: cores.texto,
    },
    card: {
      backgroundColor: cores.fundoCartao,
      borderRadius: 12,
      padding: 16,
      gap: 8,
    },
    rotulo: { fontWeight: "600", fontSize: 14, color: cores.texto },
    uuid: {
      fontFamily: "monospace",
      fontSize: 15,
      backgroundColor: cores.inputFundo,
      padding: 10,
      borderRadius: 8,
      color: cores.texto,
    },
    ajuda: { fontSize: 12, color: cores.textoSecundario },
    input: {
      backgroundColor: cores.inputFundo,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      borderWidth: 1,
      borderColor: cores.inputBorda,
      color: cores.texto,
    },
    botao: {
      backgroundColor: cores.primario,
      borderRadius: 8,
      padding: 14,
      alignItems: "center",
      marginTop: 4,
    },
    botaoTexto: { color: cores.primarioTexto, fontWeight: "600" },
    botaoSecundario: { alignItems: "center", padding: 8 },
    botaoSecundarioTexto: { color: "#2563eb", fontWeight: "600" },
    botaoSecundarioCheio: {
      backgroundColor: cores.inputFundo,
      borderWidth: 1,
      borderColor: "#2563eb",
      borderRadius: 8,
      padding: 12,
      alignItems: "center",
    },
    botaoSecundarioCheioTexto: { color: "#2563eb", fontWeight: "600" },
    confirmacao: { fontSize: 13, color: "#15803d", fontWeight: "600" },
  });
}
