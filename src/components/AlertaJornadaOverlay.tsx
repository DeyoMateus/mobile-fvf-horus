import { useEffect } from "react";
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import type { AlertaJornada } from "../api/alertas";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

// Padrão de vibração tipo "ligação chegando": vibra, pausa, vibra de
// novo, em loop , bem diferente da vibração curta de uma notificação
// comum, de propósito (é um alerta de segurança da jornada, não um
// "você recebeu uma mensagem").
const PADRAO_VIBRACAO = [0, 800, 400, 800, 400];

interface Props {
  alerta: AlertaJornada;
  silenciado: boolean;
  onFechar: () => void;
  onPedirSilenciar: () => void;
}

/**
 * Tela cheia "tipo ligação" pro alerta de estouro de jornada (direção
 * contínua excedida, jornada de direção excedida, espera no limite
 * legal). Fica por cima de tudo até o motorista fechar , não é um
 * toast que passa sozinho, porque o ponto do alerta é justamente
 * chamar atenção pra parar/descansar AGORA.
 *
 * Rodada 64 , pedido do usuário: "não vibra, nem faz som". Duas coisas
 * distintas aqui:
 * 1) Vibração: `Vibration.vibrate` abaixo já roda sempre que este
 *    componente é montado. Faltava a permissão `VIBRATE` declarada no
 *    `app.json` (adicionada nesta rodada) , sem ela, builds nativas
 *    (dev client/produção) podem simplesmente ignorar a chamada em
 *    alguns aparelhos Android. No Expo Go a permissão do app.json não
 *    se aplica (é um binário fixo da Expo), então testar vibração de
 *    verdade só é confiável numa build própria.
 * 2) Som: NÃO existe som tocando aqui de propósito , adicionar um
 *    tocador de áudio exigiria uma dependência nova (expo-av/expo-audio
 *    + um arquivo de som), e este projeto evita deliberadamente
 *    dependências novas neste ambiente específico, onde `npm install`
 *    já deu problema reincidente (OneDrive/antivírus segurando
 *    arquivo , ver Rodada 4/6). Som real, e a notificação push chegando
 *    com o app FECHADO (que traria som/vibração do próprio sistema
 *    operacional), dependem de uma build EAS/dev-client , no Expo Go,
 *    carregar o módulo de notificações derruba o app (ver
 *    `pushRegistration.ts`), então nenhum dos dois pode ser testado
 *    aqui. Ver `claude/bloqueios-dependentes-do-usuario.md`.
 */
export function AlertaJornadaOverlay({
  alerta,
  silenciado,
  onFechar,
  onPedirSilenciar,
}: Props) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);

  useEffect(() => {
    if (silenciado) return;
    Vibration.vibrate(PADRAO_VIBRACAO, true);
    return () => Vibration.cancel();
  }, [alerta.id, silenciado]);

  function confirmarSilenciar() {
    Alert.alert(
      "Silenciar alertas de jornada?",
      "Não recomendado: este alerta existe pra avisar quando a direção contínua, a jornada de direção ou o tempo de espera passam do limite legal. Silenciar só tira o toque/vibração , os alertas continuam sendo registrados e visíveis para o gestor.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Silenciar mesmo assim",
          style: "destructive",
          onPress: onPedirSilenciar,
        },
      ],
    );
  }

  return (
    <Modal
      visible
      transparent={false}
      animationType="slide"
      onRequestClose={onFechar}
    >
      <View style={estilos.raiz}>
        <View style={estilos.conteudo}>
          <Text style={estilos.icone}>⚠️</Text>
          <Text style={estilos.titulo}>Alerta de jornada</Text>
          <Text style={estilos.mensagem}>{alerta.mensagem}</Text>
          <Text style={estilos.dica}>
            Pare com segurança assim que possível e faça a pausa exigida.
          </Text>

          <TouchableOpacity style={estilos.botaoFechar} onPress={onFechar}>
            <Text style={estilos.botaoFecharTexto}>Ciente, fechar alerta</Text>
          </TouchableOpacity>

          {!silenciado ? (
            <TouchableOpacity
              style={estilos.botaoSilenciar}
              onPress={confirmarSilenciar}
            >
              <Text style={estilos.botaoSilenciarTexto}>
                Silenciar toque (não recomendado)
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={estilos.avisoSilenciado}>
              Toque de alerta está silenciado neste aparelho.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    raiz: {
      flex: 1,
      backgroundColor: cores.perigo,
      alignItems: "center",
      justifyContent: "center",
      padding: 28,
    },
    conteudo: { alignItems: "center", gap: 10, maxWidth: 420 },
    icone: { fontSize: 56 },
    titulo: {
      fontSize: 24,
      fontWeight: "700",
      color: "#ffffff",
      textAlign: "center",
    },
    mensagem: {
      fontSize: 16,
      color: "#ffffff",
      textAlign: "center",
      marginTop: 4,
    },
    dica: {
      fontSize: 13,
      color: "#ffffffcc",
      textAlign: "center",
      marginTop: 4,
    },
    botaoFechar: {
      marginTop: 24,
      backgroundColor: "#ffffff",
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 28,
      width: "100%",
      alignItems: "center",
    },
    botaoFecharTexto: { color: cores.perigo, fontWeight: "700", fontSize: 16 },
    botaoSilenciar: {
      marginTop: 14,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    botaoSilenciarTexto: {
      color: "#ffffffcc",
      fontSize: 13,
      textDecorationLine: "underline",
      textAlign: "center",
    },
    avisoSilenciado: {
      marginTop: 14,
      color: "#ffffffcc",
      fontSize: 12,
      textAlign: "center",
    },
  });
}
