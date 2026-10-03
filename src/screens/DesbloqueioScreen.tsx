import { useEffect, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { verificarPin } from "../storage/pin";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

const TAMANHO_PIN = 4;
// Backoff simples pra dificultar tentar as 10.000 combinações na mão:
// a cada 3 erros seguidos, um tempo de espera crescente antes de poder
// tentar de novo. Não é proteção forte (é só um PIN local), mas
// desestimula um "chute" casual de quem pegou o celular emprestado.
const LIMIAR_BLOQUEIO = 3;
const ESPERAS_SEGUNDOS = [5, 15, 30, 60, 120];

/**
 * Tela de bloqueio , aparece toda vez que o app abre ou volta do
 * segundo plano. Sem digitar o PIN certo, não dá pra ver nem registrar
 * nada. "Esqueci o PIN" desfaz o vínculo deste aparelho de propósito:
 * não existe reset self-service (o app não tem como confirmar que quem
 * está pedindo o reset é o motorista de verdade) , precisa passar pela
 * empresa de novo, do mesmo jeito que uma troca de aparelho.
 */
export function DesbloqueioScreen({
  onDesbloqueado,
  onEsqueciOPin,
}: {
  onDesbloqueado: () => void;
  onEsqueciOPin: () => void;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [pin, setPin] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [erros, setErros] = useState(0);
  const [bloqueadoAte, setBloqueadoAte] = useState<number | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  useEffect(() => {
    if (!bloqueadoAte) return;
    const intervalo = setInterval(() => {
      const restante = Math.ceil((bloqueadoAte - Date.now()) / 1000);
      if (restante <= 0) {
        setBloqueadoAte(null);
        setSegundosRestantes(0);
        clearInterval(intervalo);
      } else {
        setSegundosRestantes(restante);
      }
    }, 250);
    return () => clearInterval(intervalo);
  }, [bloqueadoAte]);

  async function tentar() {
    if (bloqueadoAte) return;
    if (pin.length !== TAMANHO_PIN) return;

    setVerificando(true);
    try {
      const ok = await verificarPin(pin);
      if (ok) {
        onDesbloqueado();
        return;
      }
      const novosErros = erros + 1;
      setErros(novosErros);
      setPin("");
      if (novosErros >= LIMIAR_BLOQUEIO) {
        const indice = Math.min(
          novosErros - LIMIAR_BLOQUEIO,
          ESPERAS_SEGUNDOS.length - 1,
        );
        const espera = ESPERAS_SEGUNDOS[indice];
        setBloqueadoAte(Date.now() + espera * 1000);
      } else {
        Alert.alert("PIN incorreto", "Tente novamente.");
      }
    } finally {
      setVerificando(false);
    }
  }

  function confirmarEsqueciOPin() {
    Alert.alert(
      "Esqueceu o PIN?",
      "Isso vai desfazer o vínculo deste aparelho. Você vai precisar pedir pra empresa liberar de novo, como numa troca de celular.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desfazer vínculo",
          style: "destructive",
          onPress: onEsqueciOPin,
        },
      ],
    );
  }

  return (
    <View style={estilos.container}>
      <Text style={estilos.titulo}>Digite seu PIN</Text>
      <Text style={estilos.ajuda}>
        Confirme que é você antes de ver ou registrar o ponto.
      </Text>

      <TextInput
        style={estilos.input}
        value={pin}
        onChangeText={(t) =>
          setPin(t.replace(/[^0-9]/g, "").slice(0, TAMANHO_PIN))
        }
        keyboardType="number-pad"
        secureTextEntry
        maxLength={TAMANHO_PIN}
        autoFocus
        editable={!bloqueadoAte}
        onSubmitEditing={tentar}
      />

      {bloqueadoAte ? (
        <Text style={estilos.bloqueado}>
          Muitas tentativas erradas. Aguarde {segundosRestantes}s.
        </Text>
      ) : (
        <TouchableOpacity
          style={[
            estilos.botao,
            pin.length !== TAMANHO_PIN && estilos.botaoDesabilitado,
          ]}
          onPress={tentar}
          disabled={verificando || pin.length !== TAMANHO_PIN}
        >
          <Text style={estilos.botaoTexto}>
            {verificando ? "Verificando..." : "Entrar"}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={confirmarEsqueciOPin}
        style={estilos.linkEsqueci}
      >
        <Text style={estilos.linkEsqueciTexto}>Esqueci o PIN</Text>
      </TouchableOpacity>
    </View>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: 24,
      paddingTop: 100,
      gap: 16,
      backgroundColor: cores.fundo,
      alignItems: "center",
    },
    titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
    ajuda: { fontSize: 13, color: cores.textoSecundario, textAlign: "center" },
    input: {
      backgroundColor: cores.fundoCartao,
      borderRadius: 8,
      padding: 14,
      fontSize: 24,
      textAlign: "center",
      letterSpacing: 12,
      borderWidth: 1,
      borderColor: cores.inputBorda,
      width: "100%",
      color: cores.texto,
    },
    botao: {
      backgroundColor: cores.primario,
      borderRadius: 8,
      padding: 14,
      alignItems: "center",
      width: "100%",
    },
    botaoDesabilitado: { opacity: 0.4 },
    botaoTexto: { color: cores.primarioTexto, fontWeight: "600" },
    bloqueado: { color: cores.perigo, fontWeight: "600", textAlign: "center" },
    linkEsqueci: { marginTop: 12, padding: 8 },
    linkEsqueciTexto: { color: "#2563eb", fontWeight: "600" },
  });
}
