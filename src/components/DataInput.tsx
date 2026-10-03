import DateTimePicker from "@react-native-community/datetimepicker";
import type { DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";
import {
  aplicarMascaraDataBr,
  dataBrParaIso,
  dataIsoParaBr,
  dataIsoParaDate,
  dateParaDataIso,
} from "../utils/mascaras";

/**
 * Campo de data (Rodada 53, pedido do usuário) , dois jeitos de
 * preencher, levando ao mesmo lugar:
 * 1) Digitando: insere "/" automaticamente conforme os dígitos
 *    (DD/MM/AAAA), igual à máscara que já existia pro telefone
 *    (`TelefoneInput.tsx`, Rodada 41).
 * 2) Tocando no 📅: abre o calendário nativo do aparelho
 *    (`@react-native-community/datetimepicker` , grátis, open source,
 *    já incluso no Expo Go, sem build nativa própria).
 *
 * O valor que entra/sai deste componente é sempre "AAAA-MM-DD" , o
 * mesmo formato que o resto do app já usa em filtros/API (ver
 * `HistoricoScreen.tsx`, `RegistrarPontoScreen.tsx`). A máscara
 * DD/MM/AAAA é só de exibição, convertida nas duas pontas.
 */
export function DataInput({
  valor,
  onAlterar,
  placeholder,
  dataMaxima,
  dataMinima,
}: {
  /** "AAAA-MM-DD", ou '' se vazio. */
  valor: string;
  onAlterar: (novoValorIso: string) => void;
  placeholder?: string;
  dataMaxima?: Date;
  dataMinima?: Date;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [texto, setTexto] = useState(() => dataIsoParaBr(valor));
  const [pickerAberto, setPickerAberto] = useState(false);

  useEffect(() => {
    setTexto(dataIsoParaBr(valor));
  }, [valor]);

  function aoDigitar(novoTexto: string) {
    const mascarado = aplicarMascaraDataBr(novoTexto);
    setTexto(mascarado);
    // Só propaga pro chamador quando a data digitada estiver completa
    // e for uma data real (31/02 não vira nada, por exemplo) , evita
    // filtrar/enviar uma data pela metade enquanto a pessoa ainda está
    // digitando.
    const iso = dataBrParaIso(mascarado);
    if (iso) onAlterar(iso);
  }

  // Rodada 75 , `onChange` foi descontinuado pelo
  // @react-native-community/datetimepicker (avisa no console a cada
  // abertura); o substituto oficial é `onValueChange` (só dispara
  // quando uma data de fato foi escolhida, sempre com `Date`
  // preenchido) + `onDismiss` (cancelamento, sem argumento).
  function aoEscolherNoCalendarioAndroid(
    _evento: DateTimePickerChangeEvent,
    dataEscolhida: Date,
  ) {
    setPickerAberto(false);
    const iso = dateParaDataIso(dataEscolhida);
    setTexto(dataIsoParaBr(iso));
    onAlterar(iso);
  }

  function aoCancelarCalendarioAndroid() {
    setPickerAberto(false);
  }

  // iOS usa `display="inline"` dentro do próprio Modal , o valor muda
  // direto conforme a pessoa mexe no calendário, sem ação de
  // confirmar/cancelar nativa (quem fecha é o botão "Concluído" ou
  // tocar fora, ambos já tratados fora do datepicker).
  function aoEscolherNoCalendarioIos(
    _evento: DateTimePickerChangeEvent,
    dataEscolhida: Date,
  ) {
    const iso = dateParaDataIso(dataEscolhida);
    setTexto(dataIsoParaBr(iso));
    onAlterar(iso);
  }

  return (
    <View style={estilos.linha}>
      <TextInput
        style={estilos.input}
        value={texto}
        onChangeText={aoDigitar}
        placeholder={placeholder ?? "DD/MM/AAAA"}
        placeholderTextColor={cores.inputPlaceholder}
        keyboardType="number-pad"
        maxLength={10}
      />
      <TouchableOpacity
        style={estilos.botaoCalendario}
        onPress={() => setPickerAberto(true)}
        accessibilityLabel="Abrir calendário pra escolher a data"
      >
        <Text style={estilos.iconeCalendario}>📅</Text>
      </TouchableOpacity>

      {/* Android: o próprio diálogo nativo do calendário já é modal e
          fecha sozinho ao escolher/cancelar , não precisa de Modal
          envolvendo. */}
      {pickerAberto && Platform.OS === "android" && (
        <DateTimePicker
          value={dataIsoParaDate(valor) ?? new Date()}
          mode="date"
          display="default"
          onValueChange={aoEscolherNoCalendarioAndroid}
          onDismiss={aoCancelarCalendarioAndroid}
          maximumDate={dataMaxima}
          minimumDate={dataMinima}
        />
      )}

      {/* iOS: o componente "inline" não é modal por conta própria ,
          embrulha num Modal + botão "Concluído", mesmo padrão visual
          do seletor de país do TelefoneInput (Rodada 41). */}
      {Platform.OS === "ios" && (
        <Modal
          visible={pickerAberto}
          animationType="slide"
          transparent
          onRequestClose={() => setPickerAberto(false)}
        >
          <Pressable
            style={estilos.fundoModal}
            onPress={() => setPickerAberto(false)}
          >
            <Pressable
              style={estilos.caixaModal}
              onPress={(e) => e.stopPropagation()}
            >
              <DateTimePicker
                value={dataIsoParaDate(valor) ?? new Date()}
                mode="date"
                display="inline"
                onValueChange={aoEscolherNoCalendarioIos}
                maximumDate={dataMaxima}
                minimumDate={dataMinima}
              />
              <TouchableOpacity
                style={estilos.botaoConcluido}
                onPress={() => setPickerAberto(false)}
              >
                <Text style={estilos.botaoConcluidoTexto}>Concluído</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    linha: { flexDirection: "row", gap: 8, alignItems: "center" },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: cores.inputBorda,
      backgroundColor: cores.inputFundo,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: cores.texto,
    },
    botaoCalendario: {
      borderWidth: 1,
      borderColor: cores.inputBorda,
      backgroundColor: cores.inputFundo,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      justifyContent: "center",
      alignItems: "center",
    },
    iconeCalendario: { fontSize: 16 },
    fundoModal: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    caixaModal: {
      backgroundColor: cores.fundoCartao,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 12,
      paddingBottom: 24,
      paddingHorizontal: 16,
    },
    botaoConcluido: {
      backgroundColor: cores.primario,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 8,
    },
    botaoConcluidoTexto: {
      color: cores.primarioTexto,
      fontWeight: "700",
      fontSize: 15,
    },
  });
}
