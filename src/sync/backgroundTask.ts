import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { sincronizarFila } from "./syncService";

/**
 * Sincronização em segundo plano (app minimizado/fechado). O SO decide
 * quando rodar de fato (normalmente a cada 15min-1h, nunca garantido ,
 * é uma limitação do próprio Android/iOS, não do nosso código), então
 * isto é um COMPLEMENTO à sincronização em foreground
 * (`iniciarSincronizacaoAutomatica`), não substituto: enquanto o app
 * está aberto, a sincronização continua sendo por NetInfo + intervalo
 * de 60s, que é muito mais confiável.
 *
 * `TaskManager.defineTask` precisa rodar no escopo do módulo (fora de
 * qualquer componente) , é assim que o SO consegue chamar a task mesmo
 * com o app não está com nenhuma tela montada.
 */
const NOME_TASK_SYNC = "fvf-horus-sincronizacao-background";

TaskManager.defineTask(NOME_TASK_SYNC, async () => {
  try {
    const { enviados } = await sincronizarFila();
    return enviados > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registrarSincronizacaoEmBackground(): Promise<void> {
  try {
    const jaRegistrada =
      await TaskManager.isTaskRegisteredAsync(NOME_TASK_SYNC);
    if (jaRegistrada) return;

    await BackgroundFetch.registerTaskAsync(NOME_TASK_SYNC, {
      minimumInterval: 15 * 60, // segundos , piso real depende do SO, isto é só um pedido
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Não foi possível registrar sincronização em background", err);
  }
}
