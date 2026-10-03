import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AlertaJornada } from "../api/alertas";
import { orientacaoAlerta, rotuloAlerta } from "../domain/alertasInfo";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

const CORES_SEVERIDADE: Record<AlertaJornada["severidade"], string> = {
  INFO: "#374151",
  ATENCAO: "#b45309",
  CRITICO: "#b91c1c",
};

const ROTULO_SEVERIDADE: Record<AlertaJornada["severidade"], string> = {
  INFO: "Informativo",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
};

/**
 * Detalhe de UM alerta , aberto ao tocar numa linha da aba "Alertas".
 * Mostra a mensagem que o motor gerou e a orientação de "o que fazer"
 * (ver domain/alertasInfo.ts). Só de leitura , não precisa "resolver"
 * nem "desfazer" nada aqui, porque a aba inteira não persiste estado
 * local nenhum (sempre busca a lista atual do backend).
 */
export function AlertaDetalheModal({
  alerta,
  onFechar,
}: {
  alerta: AlertaJornada | null;
  onFechar: () => void;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  if (!alerta) return null;

  const cor = CORES_SEVERIDADE[alerta.severidade];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onFechar}>
      <View style={estilos.fundo}>
        <View style={estilos.caixa}>
          <View style={[estilos.severidadeBadge, { backgroundColor: cor }]}>
            <Text style={estilos.severidadeBadgeTexto}>
              {ROTULO_SEVERIDADE[alerta.severidade]}
            </Text>
          </View>
          <Text style={estilos.titulo}>{rotuloAlerta(alerta)}</Text>
          <Text style={estilos.data}>
            {new Date(alerta.createdAt).toLocaleString("pt-BR")}
          </Text>

          <Text style={estilos.secaoTitulo}>O que aconteceu</Text>
          <Text style={estilos.texto}>{alerta.mensagem}</Text>

          <Text style={estilos.secaoTitulo}>O que fazer</Text>
          <Text style={estilos.texto}>{orientacaoAlerta(alerta)}</Text>

          <TouchableOpacity style={estilos.botaoFechar} onPress={onFechar}>
            <Text style={estilos.botaoFecharTexto}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    fundo: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      padding: 24,
    },
    caixa: {
      backgroundColor: cores.fundo,
      borderRadius: 14,
      padding: 20,
      gap: 6,
    },
    severidadeBadge: {
      alignSelf: "flex-start",
      borderRadius: 999,
      paddingVertical: 3,
      paddingHorizontal: 10,
    },
    severidadeBadgeTexto: { color: "#ffffff", fontWeight: "700", fontSize: 12 },
    titulo: {
      fontSize: 18,
      fontWeight: "700",
      color: cores.texto,
      marginTop: 6,
    },
    data: { fontSize: 12, color: cores.textoSecundario, marginBottom: 4 },
    secaoTitulo: {
      fontSize: 12,
      fontWeight: "700",
      color: cores.textoSecundario,
      textTransform: "uppercase",
      marginTop: 10,
    },
    texto: { fontSize: 14, color: cores.texto, lineHeight: 20 },
    botaoFechar: {
      marginTop: 18,
      backgroundColor: cores.primario,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    botaoFecharTexto: { color: cores.primarioTexto, fontWeight: "600" },
  });
}
