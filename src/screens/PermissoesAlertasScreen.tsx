import { useCallback, useEffect, useState } from "react";
import {
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  EXIGIR_TELA_CHEIA,
  permitirAlarmes,
  permitirBateriaLivre,
  permitirNotificacoes,
  permitirSobreporApps,
  permitirTelaCheia,
  pularPermissoesRecomendadas,
  recomendadasForamPuladas,
  verificarPermissoesAlertas,
} from "../notifications/permissoesAlertas";
import type { EstadoPermissoesAlertas } from "../notifications/permissoesAlertas";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

interface Item {
  chave: string;
  titulo: string;
  explicacao: string;
  ok: boolean;
  obrigatorio: boolean;
  acao: () => Promise<void>;
  textoBotao: string;
}

/**
 * Tela obrigatória (como a da localização): o app só é liberado quando
 * notificações, alarmes e tela cheia estão permitidos , sem eles os
 * avisos de direção contínua não chegam com o app fechado/bloqueado.
 */
export function PermissoesAlertasScreen({
  onConcluido,
}: {
  onConcluido: () => void;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [estado, setEstado] = useState<EstadoPermissoesAlertas | null>(null);
  // O passo da bateria é recomendado (não bloqueia): o motorista pode
  // pular com "Agora não".
  const pulouBateria = recomendadasForamPuladas();

  // Um passo por vez: só conclui quando as obrigatórias estão ok E a
  // bateria foi liberada ou pulada (antes, a tela fechava assim que a
  // última obrigatória era concedida e a bateria nunca era pedida).
  const conferir = useCallback(async () => {
    const e = await verificarPermissoesAlertas();
    setEstado(e);
    if (e.tudoOk && ((e.bateriaLivre && e.sobrepor) || pulouBateria)) {
      onConcluido();
    }
  }, [onConcluido, pulouBateria]);

  useEffect(() => {
    void conferir();
    // Ao voltar das configurações do sistema, confere de novo.
    const assinatura = AppState.addEventListener("change", (s) => {
      if (s === "active") void conferir();
    });
    return () => assinatura.remove();
  }, [conferir]);

  if (!estado) return <View style={estilos.raiz} />;

  const itens: Item[] = [
    {
      chave: "notificacoes",
      titulo: "Notificações",
      explicacao:
        "Para o app te avisar sobre direção contínua e limites de jornada, mesmo com o app fechado.",
      ok: estado.notificacoes,
      obrigatorio: true,
      acao: permitirNotificacoes,
      textoBotao: "Permitir notificações",
    },
    {
      chave: "alarmes",
      titulo: "Alarmes e lembretes",
      explicacao:
        "Para o aviso tocar na hora certa, sem depender de internet.",
      ok: estado.alarmes,
      obrigatorio: true,
      acao: permitirAlarmes,
      textoBotao: "Permitir alarmes",
    },
    {
      chave: "telaCheia",
      titulo: "Alerta em tela cheia",
      explicacao:
        "Para o alerta abrir na tela, com som e vibração, mesmo com o celular bloqueado. Nas configurações do app, abra Notificações e ative \"Notificações em tela cheia\" (ou Acesso especial > Intents de tela cheia).",
      ok: estado.telaCheia,
      obrigatorio: EXIGIR_TELA_CHEIA,
      acao: permitirTelaCheia,
      textoBotao: "Abrir configurações do app",
    },
    {
      chave: "sobrepor",
      titulo: "Exibir sobre outros apps (recomendado)",
      explicacao:
        "Para o alerta aparecer na tela como uma chamada ou despertador, mesmo se você estiver usando outro aplicativo (como o GPS). Na tela que abrir, ative a opção para este app.",
      ok: estado.sobrepor,
      obrigatorio: false,
      acao: permitirSobreporApps,
      textoBotao: "Permitir exibir sobre outros apps",
    },
    {
      chave: "bateria",
      titulo: "Bateria sem restrição (recomendado)",
      explicacao:
        "Evita que o Android segure os alertas quando o app está fechado. Na lista que abrir, procure este app e escolha \"Não otimizar\" / \"Sem restrições\".",
      ok: estado.bateriaLivre,
      obrigatorio: false,
      acao: permitirBateriaLivre,
      textoBotao: "Liberar bateria",
    },
  ];

  // Primeiro passo ainda pendente (ordem da lista); a bateria vem por último.
  const passoAtual = itens.find((i) => !i.ok);

  return (
    <ScrollView
        showsVerticalScrollIndicator={false}
      style={estilos.raiz}
      contentContainerStyle={estilos.conteudo}
    >
      <Text style={estilos.titulo}>Permissões necessárias</Text>
      <Text style={estilos.subtitulo}>
        Para o app te avisar na hora certa durante a viagem, precisamos destas
        permissões. Sem elas o app não pode ser usado.
      </Text>
      {passoAtual && (
        <View key={passoAtual.chave} style={estilos.cartao}>
          <Text style={estilos.passo}>
            Passo {itens.indexOf(passoAtual) + 1} de {itens.length}
          </Text>
          <Text style={estilos.cartaoTitulo}>
            {passoAtual.obrigatorio ? "⛔ " : "⚠️ "}
            {passoAtual.titulo}
          </Text>
          <Text style={estilos.cartaoTexto}>{passoAtual.explicacao}</Text>
          <TouchableOpacity
            style={estilos.botao}
            onPress={() => void passoAtual.acao().then(conferir)}
          >
            <Text style={estilos.botaoTexto}>{passoAtual.textoBotao}</Text>
          </TouchableOpacity>
          {!passoAtual.obrigatorio && (
            <TouchableOpacity
              onPress={() => {
                pularPermissoesRecomendadas();
                onConcluido();
              }}
            >
              <Text style={estilos.pular}>Agora não</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    raiz: { flex: 1, backgroundColor: cores.fundo },
    conteudo: { padding: 24, paddingTop: 48, gap: 14 },
    titulo: { fontSize: 26, fontWeight: "800", color: cores.texto },
    subtitulo: { fontSize: 15, color: cores.textoSecundario, marginBottom: 6 },
    cartao: {
      backgroundColor: cores.fundoCartao,
      borderColor: cores.borda,
      borderWidth: 1,
      borderRadius: 14,
      padding: 16,
      gap: 8,
    },
    cartaoTitulo: { fontSize: 17, fontWeight: "700", color: cores.texto },
    cartaoTexto: { fontSize: 14, color: cores.textoSecundario },
    botao: {
      backgroundColor: cores.primario,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    botaoTexto: { color: cores.primarioTexto, fontWeight: "700" },
    passo: { fontSize: 12, fontWeight: "700", color: cores.textoSecundario },
    pular: {
      color: cores.textoSecundario,
      textAlign: "center",
      paddingVertical: 10,
      fontSize: 14,
    },
  });
}
