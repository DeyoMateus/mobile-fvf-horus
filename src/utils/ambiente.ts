import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * true quando o app está rodando dentro do Expo Go genérico da loja
 * (em vez de uma build própria , dev client ou produção).
 *
 * Várias features daqui (jail-monkey, SSL pinning, push notification
 * remota do expo-notifications desde o SDK 53) exigem código nativo
 * que o Expo Go não tem , usar essas APIs lá dentro não dá só um erro
 * "pegável" em JavaScript, às vezes derruba o processo nativo direto.
 * Por isso a checagem é feita ANTES de chamar a API, não só um
 * try/catch em volta dela.
 */
export function rodandoNoExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}
