/**
 * Rodada 88 , pedido do usuário, depois de conseguir a build EAS:
 * "podemos seguir com o relógio monotônico". Wrapper do módulo nativo
 * local `modules/relogio-monotonico` (Android `SystemClock.
 * elapsedRealtime()` / iOS `ProcessInfo.systemUptime`).
 *
 * `require(...)` (não `import` no topo do arquivo) é DE PROPÓSITO: o
 * módulo nativo só existe numa build própria (EAS dev-client/produção)
 * , no Expo Go genérico, `requireNativeModule` do módulo lança um erro
 * na hora de CARREGAR o arquivo (não só ao chamar a função). Um
 * `import` estático quebraria o app inteiro no Expo Go; o `require`
 * dentro do `try/catch` abaixo deixa o app funcionar normalmente nos
 * dois casos , só sem o dado extra de relógio monotônico quando não
 * tem o módulo nativo disponível (mesmo padrão de degradação graciosa
 * já usado pra GPS/localização no resto do app).
 */
let modulo: { getElapsedRealtimeMs(): number } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  modulo =
    require("../../modules/relogio-monotonico/src/RelogioMonotonicoModule").default;
} catch {
  modulo = null;
}

/**
 * Milissegundos desde o último boot do aparelho, ou `null` se o módulo
 * nativo não estiver disponível (Expo Go, ou instalação anterior a
 * esta rodada) , nesse caso o backend simplesmente pula a checagem de
 * relógio monotônico pra este registro (ver comentário em
 * `RegistrosJornadaService.create`), caindo de volta nas defesas de
 * sempre (bloqueio de relógio retrocedido/adiantado, alerta de
 * sincronização tardia).
 */
export function obterElapsedRealtimeMs(): number | null {
  if (!modulo) return null;
  try {
    return modulo.getElapsedRealtimeMs();
  } catch {
    return null;
  }
}
