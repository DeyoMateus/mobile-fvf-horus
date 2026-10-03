/**
 * Certificate/public-key pinning para o domínio de produção do backend
 * (Hostinger), via `react-native-ssl-public-key-pinning`.
 *
 * IMPORTANTE , assim como `jail-monkey` (ver `deviceIntegrity.ts`),
 * isto é um módulo nativo: só funciona numa build própria (dev
 * client/EAS), nunca no Expo Go genérico da loja. Antes de configurar
 * de verdade, confirme a API exata da versão instalada da lib (rode
 * `npx expo install --fix` e leia o README dela) , o nome/formato dos
 * parâmetros pode variar entre versões, e isto aqui não foi testado
 * contra um servidor real ainda (o domínio de produção não existe
 * até o deploy na Hostinger).
 *
 * Como gerar os pins (hash SHA-256 do SPKI do certificado) depois que
 * o backend estiver no ar com HTTPS de verdade:
 *
 *   openssl s_client -connect api.SEUDOMINIO.com.br:443 -servername api.SEUDOMINIO.com.br </dev/null 2>/dev/null \
 *     | openssl x509 -pubkey -noout \
 *     | openssl pkey -pubin -outform der \
 *     | openssl dgst -sha256 -binary | openssl enc -base64
 *
 * Gere PELO MENOS DOIS pins: o certificado atual + um "de backup"
 * (outra chave já gerada, guardada offline, que você vai usar na
 * próxima renovação). Com um pin só, renovar o certificado (ex.:
 * Let's Encrypt a cada ~90 dias) DERRUBA todo mundo até saír uma
 * atualização nova do app nas lojas , que pode levar dias pra ser
 * aprovada. Isso é o erro mais comum (e mais caro) de quem implementa
 * pinning.
 */
// NÃO usar "import { initSSLPinning } from 'react-native-ssl-public-key-pinning'"
// estático aqui , e nem só um try/catch em volta do require() basta:
// alguns módulos nativos derrubam o processo nativo direto ao serem
// carregados dentro do Expo Go (crash nativo, não erro JS , try/catch
// não pega). Por isso checamos antes se é Expo Go e nem chegamos a
// chamar require() nesse caso (ver mesmo padrão em deviceIntegrity.ts).
import { rodandoNoExpoGo } from "../utils/ambiente";

export function configurarPinningSsl(): void {
  const host = process.env.EXPO_PUBLIC_SSL_PIN_HOST;
  const pins = (process.env.EXPO_PUBLIC_SSL_PINS ?? "")
    .split(",")
    .map((p: string) => p.trim())
    .filter(Boolean);

  if (!host || pins.length === 0) {
    // Sem host/pins configurados (ex.: desenvolvimento local em HTTP,
    // ou antes do domínio de produção existir) , pinning fica
    // desativado de propósito. Nunca queremos que a ausência de
    // configuração vire um "todo mundo trava" silencioso.
    return;
  }

  if (rodandoNoExpoGo()) {
    // Expo Go: nem tenta carregar o módulo nativo , ver comentário acima.
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initSSLPinning } = require("react-native-ssl-public-key-pinning");
    initSSLPinning({
      checkPublicKeys: [{ domain: host, publicKeys: pins }],
    });
  } catch {
    // Módulo nativo indisponível (Expo Go) , segue sem pinning.
  }
}
