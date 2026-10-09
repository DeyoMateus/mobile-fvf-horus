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
import { atualizarMeuPerfil, obterMeuPerfil } from "../api/motorista";
import { TelefoneInput } from "../components/TelefoneInput";
import type { PerfilMotorista } from "../api/motorista";
import { obterCredenciais } from "../storage/secureCredentials";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

/**
 * "Meu perfil" (Rodada 39, e-mail retirado na Rodada 40 , sem
 * necessidade pro motorista) , o motorista vê e edita seu nome e
 * telefone. CPF é só leitura (documento de identidade, nunca editável
 * por ninguém pelo sistema). Nenhum dos dois campos editáveis pode
 * ficar vazio , pedido explícito do usuário; validado aqui ANTES de
 * chamar a API (o backend também valida, mas o app avisa na hora, sem
 * round-trip).
 */
export function PerfilMotoristaScreen({
  alertaJornadaSilenciado,
  onReativarAlertaJornada,
}: {
  /** Rodada 126 , ver App.tsx: estado vem de lá porque a tela cheia de
   *  alerta de jornada (AlertaJornadaOverlay) também mora lá , aqui só
   *  mostramos o status e avisamos de volta quando o motorista reativa. */
  alertaJornadaSilenciado: boolean;
  onReativarAlertaJornada: () => void;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [perfil, setPerfil] = useState<PerfilMotorista | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      const dados = await obterMeuPerfil(credenciais);
      setPerfil(dados);
      setNome(dados.nome);
      setTelefone(dados.telefone ?? "");
      setErro(null);
    } catch {
      setErro("Não foi possível carregar seu perfil agora.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    const nomeAparado = nome.trim();
    const telefoneAparado = telefone.trim();

    if (!nomeAparado || !telefoneAparado) {
      Alert.alert("Preencha tudo", "Nome e telefone não podem ficar vazios.");
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const credenciais = await obterCredenciais();
      if (!credenciais) return;
      const atualizado = await atualizarMeuPerfil(credenciais, {
        nome: nomeAparado,
        telefone: telefoneAparado,
      });
      setPerfil(atualizado);
      Alert.alert("Pronto", "Seus dados foram atualizados.");
    } catch (e) {
      setErro(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar , confira os dados e tente de novo.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <ScrollView
        showsVerticalScrollIndicator={false}
      style={estilos.container}
      contentContainerStyle={estilos.conteudo}
      refreshControl={
        <RefreshControl
          refreshing={carregando}
          onRefresh={() => void carregar()}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <Text style={estilos.titulo}>Meu perfil</Text>
      <Text style={estilos.subtitulo}>
        Nome e telefone , nenhum pode ficar vazio.
      </Text>

      {erro && <Text style={estilos.erro}>{erro}</Text>}

      <Text style={estilos.rotulo}>Nome</Text>
      <TextInput
        style={estilos.input}
        value={nome}
        onChangeText={setNome}
        placeholder="Seu nome completo"
        placeholderTextColor={cores.inputPlaceholder}
        maxLength={60}
      />

      <Text style={estilos.rotulo}>Telefone</Text>
      <TelefoneInput value={telefone} onChange={setTelefone} />

      <Text style={estilos.rotulo}>CPF</Text>
      <View style={[estilos.input, estilos.inputDesabilitado]}>
        <Text style={{ color: cores.textoSecundario }}>
          {perfil?.cpf ?? ","}
        </Text>
      </View>
      <Text style={estilos.textoAjuda}>
        O CPF não pode ser alterado pelo app.
      </Text>

      <TouchableOpacity
        style={estilos.botao}
        onPress={() => void salvar()}
        disabled={salvando}
      >
        <Text style={estilos.botaoTexto}>
          {salvando ? "Salvando…" : "Salvar alterações"}
        </Text>
      </TouchableOpacity>

      {/* Rodada 126 , pedido do usuário: dava pra silenciar o toque/vibração
          do alerta de jornada (tela cheia tipo ligação), mas não existia
          jeito nenhum de reativar depois , ficava silenciado para sempre
          neste aparelho. Só aparece quando está silenciado; reativado,
          a seção desaparece (nada pra fazer). */}
      {alertaJornadaSilenciado && (
        <View style={estilos.cartaoAlerta}>
          <Text style={estilos.rotulo}>Alertas de jornada</Text>
          <Text style={estilos.textoAjuda}>
            O toque e a vibração da tela de alerta de jornada estão
            silenciados neste aparelho. Os alertas continuam sendo
            registrados e visíveis para o gestor , só o aviso sonoro deste
            celular que está desligado.
          </Text>
          <TouchableOpacity
            style={estilos.botaoReativar}
            onPress={onReativarAlertaJornada}
          >
            <Text style={estilos.botaoReativarTexto}>
              Reativar toque e vibração
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
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
      marginBottom: 16,
    },
    erro: { color: cores.perigo, marginBottom: 12 },
    rotulo: {
      fontSize: 13,
      fontWeight: "600",
      color: cores.textoSecundario,
      marginTop: 12,
      marginBottom: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: cores.inputBorda,
      backgroundColor: cores.inputFundo,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: cores.texto,
      justifyContent: "center",
    },
    inputDesabilitado: { opacity: 0.6 },
    textoAjuda: { fontSize: 11, color: cores.textoSecundario, marginTop: 4 },
    botao: {
      backgroundColor: cores.primario,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 24,
    },
    botaoTexto: { color: cores.primarioTexto, fontWeight: "700", fontSize: 15 },
    cartaoAlerta: {
      marginTop: 24,
      borderWidth: 1,
      borderColor: cores.borda,
      backgroundColor: cores.fundoCartao,
      borderRadius: 10,
      padding: 14,
    },
    botaoReativar: {
      marginTop: 10,
      borderWidth: 1,
      borderColor: cores.primario,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
    },
    botaoReativarTexto: { color: cores.primario, fontWeight: "700", fontSize: 13 },
  });
}
