import { API_URL, ErroApi } from "../api/client";
import { obterCredenciais } from "../storage/secureCredentials";
import { registrarAncoraServidor } from "../utils/relogioConfiavel";
import { obterElapsedRealtimeMs } from "../utils/relogioMonotonico";

/**
 * Rodada 92 , manda o relógio monotônico do aparelho (NUNCA o relógio
 * de parede) pro servidor confirmar a hora com uma fonte que o
 * motorista não controla. Ver RelogioConfiavelService no backend e o
 * doc da Rodada 91 (por que uma âncora só com dados do próprio
 * aparelho não bastava).
 *
 * Chamado (a) uma vez ao abrir o app, e (b) sempre que a conectividade
 * volta (ver syncService.ts) , não só ao bater ponto: quanto mais cedo
 * depois de reiniciar o aparelho isto rodar, menor a janela em que um
 * toque fica sem nenhuma hora confiável pra comparar na hora.
 *
 * Best-effort, igual a pushRegistration.ts: sem módulo nativo (Expo
 * Go), sem internet, sem vínculo, ou qualquer erro , nunca propaga.
 * Isto nunca pode atrapalhar o uso do app.
 */
export async function sincronizarRelogioConfiavelSeNecessario(): Promise<void> {
  try {
    const elapsedRealtimeMs = obterElapsedRealtimeMs();
    if (elapsedRealtimeMs == null) return; // Expo Go / módulo nativo indisponível

    const credenciais = await obterCredenciais();
    if (!credenciais) return; // ainda não vinculado

    const resp = await fetch(`${API_URL}/dispositivo/relogio/sincronizar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
      body: JSON.stringify({ elapsedRealtimeMs }),
    });
    if (resp.ok) {
      const dados = (await resp.json()) as { horaServidor?: string };
      const ms = dados.horaServidor ? Date.parse(dados.horaServidor) : NaN;
      if (Number.isFinite(ms)) registrarAncoraServidor(ms, elapsedRealtimeMs);
    }
  } catch (err) {
    if (!(err instanceof ErroApi)) {
      // eslint-disable-next-line no-console
      console.warn("Falha ao sincronizar relógio confiável", err);
    }
  }
}
