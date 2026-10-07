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
  permitirTelaCheia,
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

  const conferir = useCallback(async () => {
    const e = await verificarPermissoesAlertas();
    setEstado(e);
    if (e.tudoOk) onConcluido();
  }, [onConcluido]);

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
      chave: "bateria",
      titulo: "Bateria sem restrição (recomendado)",
      explicacao:
        "Evita que o Android segure os alertas quando o app está fechado.",
      ok: estado.bateriaLivre,
      obrigatorio: false,
      acao: permitirBateriaLivre,
      textoBotao: "Liberar bateria",
    },
  ];

  return (
    <ScrollView
      style={estilos.raiz}
      contentContainerStyle={estilos.conteudo}
    >
      <Text style={estilos.titulo}>Permissões necessárias</Text>
      <Text style={estilos.subtitulo}>
        Para o app te avisar na hora certa durante a viagem, precisamos destas
        permissões. Sem elas o app não pode ser usado.
      </Text>
      {itens.map((i) => (
        <View key={i.chave} style={estilos.cartao}>
          <Text style={estilos.cartaoTitulo}>
            {i.ok ? "✅ " : i.obrigatorio ? "⛔ " : "⚠️ "}
            {i.titulo}
          </Text>
          <Text style={estilos.cartaoTexto}>{i.explicacao}</Text>
          {!i.ok && (
            <TouchableOpacity
              style={estilos.botao}
              onPress={() => void i.acao().then(conferir)}
            >
              <Text style={estilos.botaoTexto}>{i.textoBotao}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {!estado.tudoOk ? null : (
        <TouchableOpacity style={estilos.botao} onPress={onConcluido}>
          <Text style={estilos.botaoTexto}>Continuar</Text>
        </TouchableOpacity>
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
  });
}
