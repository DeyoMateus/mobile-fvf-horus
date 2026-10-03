/**
 * Detecção de root/jailbreak, hooking (Frida/Xposed) e "mock location"
 * habilitado, via `jail-monkey`.
 *
 * IMPORTANTE , isto exige uma build nativa própria (dev client via
 * `eas build --profile development`, ou `npx expo prebuild` local):
 * `jail-monkey` é um módulo nativo e NÃO existe dentro do app Expo Go
 * genérico (o Expo Go da loja só tem os módulos que o próprio Expo
 * publica). Testando pelo Expo Go, as funções abaixo sempre retornam
 * "nada suspeito" (fail-open, nunca fail-closed , nunca queremos
 * travar todo mundo por engano de detecção). Ver `mobile/README.md`
 * seção de segurança para o passo a passo de gerar um dev client.
 *
 * Decisão de produto: "mock location HABILITADO no aparelho" bloqueia
 * o registro de ponto (é justamente o vetor de fraude que a Lei do
 * Motorista/fiscalização mais se importa: motorista "provando" que
 * estava em outro lugar). Já "root/jailbreak" sozinho só GERA UM ALERTA
 * (ver RegistrosJornadaService.create → AuditLog) em vez de bloquear ,
 * telefone rooteado é comum e legítimo no Brasil (custom ROM, operadora
 * antiga etc.), bloquear por isso geraria falso positivo demais para o
 * ganho de segurança real.
 */
// NÃO usar "import JailMonkey from 'jail-monkey'" estático aqui , e nem
// só um try/catch em volta do require() é garantia suficiente: alguns
// módulos nativos, ao serem carregados dentro do Expo Go, derrubam o
// processo nativo direto (uma invariant violation do lado nativo, que
// um try/catch em JavaScript NÃO consegue interceptar , só protege
// erro JS, não crash nativo). Por isso primeiro checamos se estamos
// rodando dentro do Expo Go (Constants.executionEnvironment) e nem
// tentamos require() nesse caso , é o único jeito confiável de não
// derrubar o app testando por aqui.
import { rodandoNoExpoGo } from "../utils/ambiente";

export interface IntegridadeDispositivo {
  bloqueado: boolean;
  motivoBloqueio?: string;
  flagsParaAuditoria: string[];
}

export function avaliarIntegridadeDispositivo(): IntegridadeDispositivo {
  const flagsParaAuditoria: string[] = [];
  let bloqueado = false;
  let motivoBloqueio: string | undefined;

  if (rodandoNoExpoGo()) {
    // Expo Go: nem tenta carregar o módulo nativo , ver comentário acima.
    return { bloqueado, motivoBloqueio, flagsParaAuditoria };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jailMonkeyModulo = require("jail-monkey");
    const JailMonkey = jailMonkeyModulo.default ?? jailMonkeyModulo;
    if (JailMonkey.canMockLocation()) {
      bloqueado = true;
      motivoBloqueio =
        'A opção "permitir localização falsa" (mock location) está habilitada neste aparelho. ' +
        "Desative-a nas opções de desenvolvedor do Android para poder bater ponto.";
      flagsParaAuditoria.push("MOCK_LOCATION_HABILITADO");
    }
    if (JailMonkey.isJailBroken()) {
      flagsParaAuditoria.push("ROOT_OU_JAILBREAK_DETECTADO");
    }
    if (JailMonkey.trustFall()) {
      flagsParaAuditoria.push("HOOKING_OU_INSTRUMENTACAO_DETECTADO");
    }
  } catch {
    // jail-monkey indisponível (Expo Go, ou plataforma sem suporte) ,
    // fail-open de propósito: nunca travar o motorista por não
    // conseguir detectar, só quando DETECTA algo concreto.
  }

  return { bloqueado, motivoBloqueio, flagsParaAuditoria };
}
