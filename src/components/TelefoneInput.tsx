import { useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  PAISES_TELEFONE,
  montarTelefone,
  separarTelefone,
} from "../data/paisesTelefone";
import type { PaisTelefone } from "../data/paisesTelefone";
import { useTema } from "../theme/ThemeContext";
import type { CoresTema } from "../theme/ThemeContext";

/**
 * Seletor de telefone (Rodada 41) , equivalente mobile do
 * TelefoneInput do painel web. React Native não tem <select>, então o
 * país é escolhido num Modal com lista (bandeira + código); o
 * motorista só digita o DDD + número no campo ao lado. O valor
 * exposto por onChange é sempre a string completa em E.164
 * ("+<código><número>"), igual ao que o backend espera.
 */
export function TelefoneInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (novoValorE164: string) => void;
  placeholder?: string;
}) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);

  const inicial = separarTelefone(value);
  const [pais, setPais] = useState<PaisTelefone>(inicial.pais);
  const [numeroLocal, setNumeroLocal] = useState(inicial.numeroLocal);
  const [modalAberto, setModalAberto] = useState(false);

  useEffect(() => {
    const separado = separarTelefone(value);
    setPais(separado.pais);
    setNumeroLocal(separado.numeroLocal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function escolherPais(novoPais: PaisTelefone) {
    setPais(novoPais);
    setModalAberto(false);
    onChange(montarTelefone(novoPais.codigo, numeroLocal));
  }

  function atualizarNumero(texto: string) {
    const somenteDigitos = texto.replace(/\D/g, "");
    setNumeroLocal(somenteDigitos);
    onChange(montarTelefone(pais.codigo, somenteDigitos));
  }

  return (
    <View style={estilos.linha}>
      <TouchableOpacity
        style={estilos.botaoPais}
        onPress={() => setModalAberto(true)}
      >
        <Text style={estilos.textoBotaoPais}>
          {pais.bandeira} {pais.codigo}
        </Text>
      </TouchableOpacity>
      <TextInput
        style={estilos.input}
        value={numeroLocal}
        onChangeText={atualizarNumero}
        placeholder={placeholder ?? "DDD + número"}
        placeholderTextColor={cores.inputPlaceholder}
        keyboardType="phone-pad"
        maxLength={13}
      />

      <Modal
        visible={modalAberto}
        animationType="slide"
        transparent
        onRequestClose={() => setModalAberto(false)}
      >
        <Pressable
          style={estilos.fundoModal}
          onPress={() => setModalAberto(false)}
        >
          <View style={estilos.caixaModal}>
            <Text style={estilos.tituloModal}>Selecione o país</Text>
            <FlatList
              data={PAISES_TELEFONE}
              keyExtractor={(item) => `${item.sigla}-${item.codigo}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={estilos.itemPais}
                  onPress={() => escolherPais(item)}
                >
                  <Text style={estilos.textoItemPais}>
                    {item.bandeira} {item.nome} ({item.codigo})
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    linha: { flexDirection: "row", gap: 8 },
    botaoPais: {
      borderWidth: 1,
      borderColor: cores.inputBorda,
      backgroundColor: cores.inputFundo,
      borderRadius: 8,
      paddingHorizontal: 10,
      justifyContent: "center",
      minWidth: 92,
    },
    textoBotaoPais: { color: cores.texto, fontSize: 15 },
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
    fundoModal: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    caixaModal: {
      backgroundColor: cores.fundoCartao,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      maxHeight: "70%",
      paddingTop: 12,
      paddingBottom: 24,
    },
    tituloModal: {
      fontSize: 16,
      fontWeight: "700",
      color: cores.texto,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    itemPais: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: cores.borda,
    },
    textoItemPais: { fontSize: 15, color: cores.texto },
  });
}
