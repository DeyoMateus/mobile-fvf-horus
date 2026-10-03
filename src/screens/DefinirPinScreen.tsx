import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { definirPin } from '../storage/pin';
import { useTema } from '../theme/ThemeContext';
import type { CoresTema } from '../theme/ThemeContext';

const TAMANHO_PIN = 4;

/**
 * Tela obrigatória logo após o vínculo do aparelho (e pra quem já
 * estava vinculado antes desta versão existir, na próxima abertura do
 * app): cadastra o PIN local de 4 dígitos que vai travar o app a cada
 * abertura. Pede duas vezes pra evitar erro de digitação virando um
 * "esqueci o PIN" no primeiro dia de uso.
 */
export function DefinirPinScreen({ onDefinido }: { onDefinido: () => void }) {
  const { cores } = useTema();
  const estilos = criarEstilos(cores);
  const [pin, setPin] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    if (pin.length !== TAMANHO_PIN) {
      Alert.alert('PIN incompleto', `O PIN precisa ter ${TAMANHO_PIN} dígitos.`);
      return;
    }
    if (pin !== confirmacao) {
      Alert.alert('PIN não confere', 'Os dois PINs digitados são diferentes. Tente de novo.');
      setConfirmacao('');
      return;
    }
    setSalvando(true);
    try {
      await definirPin(pin);
      onDefinido();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View style={estilos.container}>
      <Text style={estilos.titulo}>Crie seu PIN</Text>
      <Text style={estilos.ajuda}>
        A partir de agora, sempre que abrir o app (ou voltar pra ele) você vai precisar digitar este PIN de {TAMANHO_PIN}{' '}
        dígitos. Isso garante que só você registra o seu ponto neste aparelho.
      </Text>

      <TextInput
        style={estilos.input}
        placeholder={`Digite um PIN de ${TAMANHO_PIN} dígitos`}
        placeholderTextColor={cores.inputPlaceholder}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, TAMANHO_PIN))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={TAMANHO_PIN}
        autoFocus
      />
      <TextInput
        style={estilos.input}
        placeholder="Confirme o PIN"
        placeholderTextColor={cores.inputPlaceholder}
        value={confirmacao}
        onChangeText={(t) => setConfirmacao(t.replace(/[^0-9]/g, '').slice(0, TAMANHO_PIN))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={TAMANHO_PIN}
      />

      <TouchableOpacity style={estilos.botao} onPress={confirmar} disabled={salvando}>
        <Text style={estilos.botaoTexto}>{salvando ? 'Salvando...' : 'Confirmar PIN'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function criarEstilos(cores: CoresTema) {
  return StyleSheet.create({
    container: { flex: 1, padding: 24, paddingTop: 80, gap: 16, backgroundColor: cores.fundo },
    titulo: { fontSize: 22, fontWeight: '700', color: cores.texto },
    ajuda: { fontSize: 13, color: cores.textoSecundario, lineHeight: 18 },
    input: {
      backgroundColor: cores.fundoCartao,
      borderRadius: 8,
      padding: 14,
      fontSize: 20,
      textAlign: 'center',
      letterSpacing: 8,
      borderWidth: 1,
      borderColor: cores.inputBorda,
      color: cores.texto,
    },
    botao: { backgroundColor: cores.primario, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
    botaoTexto: { color: cores.primarioTexto, fontWeight: '600' },
  });
}
