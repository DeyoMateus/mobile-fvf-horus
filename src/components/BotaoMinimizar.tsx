import { Text, TouchableOpacity } from "react-native";
import { useTema } from "../theme/ThemeContext";

/**
 * Botão de "minimizar/mostrar" (Rodada 78, pedido do usuário: "adicione
 * uma opção para minimizar os históricos listados no app nas telas que
 * ficam salvo um histórico") , usado em toda tela que guarda algum tipo
 * de histórico (Histórico de pontos, Alertas, Ajustes, Minhas horas)
 * pra poder recolher a lista sem perder nada: só esconde da tela, nunca
 * apaga dado nenhum , bem diferente do "Limpar histórico" de Alertas,
 * que de fato descarta os alertas antigos. O estado fica só na
 * memória do componente que usa este botão: reabrir a tela sempre
 * volta a mostrar tudo expandido, de propósito (evita confundir quem
 * esqueceu que minimizou da última vez e acha que sumiu alguma coisa).
 */
export function BotaoMinimizar({
  minimizado,
  onAlternar,
  rotulo = "histórico",
}: {
  minimizado: boolean;
  onAlternar: () => void;
  /** Nome do que está sendo minimizado , não aparece mais no texto do
   * botão (Rodada 80: repetir o nome ao lado do título da própria
   * seção estourava a largura do card e o texto saía cortado, por
   * fora da borda). Fica só como contexto pra leitor de tela. */
  rotulo?: string;
}) {
  const { cores } = useTema();
  return (
    <TouchableOpacity
      onPress={onAlternar}
      accessibilityRole="button"
      accessibilityLabel={
        minimizado ? `Mostrar ${rotulo}` : `Minimizar ${rotulo}`
      }
      style={{ flexShrink: 0 }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: cores.textoSecundario,
          textDecorationLine: "underline",
        }}
      >
        {minimizado ? "Mostrar ▼" : "Minimizar ▲"}
      </Text>
    </TouchableOpacity>
  );
}
