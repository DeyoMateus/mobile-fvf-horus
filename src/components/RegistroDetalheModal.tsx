import { useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { baixarEcompartilharComprovanteRegistro } from "../api/comprovante";
import {
  TIPOS_EVENTO,
  type RegistroLocal,
  type CredenciaisDispositivo,
} from "../types";

const CORES_STATUS: Record<RegistroLocal["status"], string> = {
  PENDENTE: "#b45309",
  ENVIADO: "#15803d",
  ERRO: "#b91c1c",
};

const ROTULO_STATUS: Record<RegistroLocal["status"], string> = {
  PENDENTE: "Pendente de sincronização",
  ENVIADO: "Sincronizado com o servidor",
  ERRO: "Erro ao sincronizar",
};

function rotuloEvento(tipo: RegistroLocal["tipoEvento"]): string {
  return TIPOS_EVENTO.find((t) => t.tipo === tipo)?.rotulo ?? tipo;
}

/**
 * Detalhe de UM registro batido neste aparelho , onde, hora e status ,
 * aberto ao tocar numa linha do Histórico. O comprovante individual só
 * pode ser gerado se o registro já sincronizou (status ENVIADO): é o
 * backend que assina e monta o PDF a partir do ledger real, então um
 * registro ainda PENDENTE simplesmente não existe lá pra gerar nada.
 */
export function RegistroDetalheModal({
  registro,
  credenciais,
  onFechar,
}: {
  registro: RegistroLocal | null;
  credenciais: CredenciaisDispositivo | null;
  onFechar: () => void;
}) {
  const [baixando, setBaixando] = useState(false);

  async function baixarComprovanteDoRegistro() {
    if (!registro || !credenciais) return;
    setBaixando(true);
    try {
      const resultado = await baixarEcompartilharComprovanteRegistro(
        credenciais,
        registro.idLocal,
      );
      Alert.alert(
        "Comprovante gerado",
        resultado.compartilhado
          ? "O PDF deste registro foi baixado e a tela de compartilhamento foi aberta."
          : "O PDF deste registro foi baixado, mas este aparelho não tem app de compartilhamento disponível.",
      );
    } catch (err) {
      Alert.alert(
        "Não foi possível baixar",
        err instanceof Error ? err.message : "Erro desconhecido",
      );
    } finally {
      setBaixando(false);
    }
  }

  function abrirNoMapa() {
    if (!registro?.latitude || !registro?.longitude) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${registro.latitude},${registro.longitude}`;
    void Linking.openURL(url);
  }

  const temLocalizacao =
    registro?.latitude != null && registro?.longitude != null;

  return (
    <Modal
      visible={registro !== null}
      animationType="slide"
      transparent
      onRequestClose={onFechar}
    >
      <View style={estilos.fundo}>
        <View style={estilos.folha}>
          {registro && (
            <>
              <Text style={estilos.titulo}>
                {rotuloEvento(registro.tipoEvento)}
              </Text>

              <View style={estilos.linha}>
                <Text style={estilos.rotulo}>Hora</Text>
                <Text style={estilos.valor}>
                  {new Date(registro.timestampEvento).toLocaleString("pt-BR")}
                </Text>
              </View>

              <View style={estilos.linha}>
                <Text style={estilos.rotulo}>Status</Text>
                <Text
                  style={[
                    estilos.valor,
                    { color: CORES_STATUS[registro.status], fontWeight: "700" },
                  ]}
                >
                  {ROTULO_STATUS[registro.status]}
                </Text>
              </View>

              {registro.status === "ERRO" && registro.ultimoErro && (
                <View style={estilos.linha}>
                  <Text style={estilos.rotulo}>Erro</Text>
                  <Text style={[estilos.valor, { color: "#b91c1c" }]}>
                    {registro.ultimoErro}
                  </Text>
                </View>
              )}

              <View style={estilos.linha}>
                <Text style={estilos.rotulo}>Onde</Text>
                {temLocalizacao ? (
                  <TouchableOpacity onPress={abrirNoMapa}>
                    <Text style={[estilos.valor, estilos.link]}>
                      {registro.latitude!.toFixed(5)},{" "}
                      {registro.longitude!.toFixed(5)}
                      {registro.precisaoGpsM != null
                        ? `  (±${Math.round(registro.precisaoGpsM)}m)`
                        : ""}{" "}
                      , abrir no mapa
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={estilos.valor}>
                    Sem GPS no momento do registro
                  </Text>
                )}
              </View>

              {registro.observacao && (
                <View style={estilos.linha}>
                  <Text style={estilos.rotulo}>Observação</Text>
                  <Text style={estilos.valor}>{registro.observacao}</Text>
                </View>
              )}

              {registro.status === "ENVIADO" ? (
                <TouchableOpacity
                  style={estilos.botao}
                  onPress={baixarComprovanteDoRegistro}
                  disabled={baixando}
                >
                  <Text style={estilos.botaoTexto}>
                    {baixando
                      ? "Gerando comprovante..."
                      : "Baixar comprovante deste registro"}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={estilos.avisoPendente}>
                  Este registro ainda não sincronizou , o comprovante individual
                  só fica disponível depois de sincronizado.
                </Text>
              )}

              <TouchableOpacity style={estilos.botaoFechar} onPress={onFechar}>
                <Text style={estilos.botaoFecharTexto}>Fechar</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  folha: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    gap: 14,
  },
  titulo: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
  linha: { gap: 2 },
  rotulo: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "600",
    textTransform: "uppercase",
  },
  valor: { fontSize: 15, color: "#111827" },
  link: { color: "#2563eb" },
  botao: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  botaoTexto: { color: "#fff", fontWeight: "600" },
  avisoPendente: {
    fontSize: 12,
    color: "#b45309",
    textAlign: "center",
    marginTop: 4,
  },
  botaoFechar: { alignItems: "center", padding: 10 },
  botaoFecharTexto: { color: "#6b7280", fontWeight: "600" },
});
