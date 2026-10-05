import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { enviarLoteRegistros, ErroApi } from "../api/client";
import {
  listarPendentes,
  marcarEnviado,
  marcarErro,
  listarCienciasPendentes,
  marcarCienciaEnviada,
  listarAlertasVisualizadosPendentes,
  marcarAlertaVisualizadoEnviado,
} from "../storage/db";
import { obterCredenciais } from "../storage/secureCredentials";
import { darCienciaAjuste } from "../api/tratamentos";
import { marcarAlertaVisualizado } from "../api/alertas";
import { sincronizarRelogioConfiavelSeNecessario } from "./relogioConfiavelSync";

/**
 * Sincronização offline-first: roda quando a conectividade volta e
 * periodicamente enquanto o app está aberto. Nunca bloqueia o
 * "Registrar Ponto" , o motorista bate o ponto local instantaneamente
 * (ver db.ts) e este serviço só tenta esvaziar a fila depois.
 *
 * Rodada 66: em vez de um POST por registro pendente, envia tudo de
 * uma vez em lote (POST /registros-jornada/lote) , é exatamente o
 * cenário que motivou o endpoint ("motorista acumula vários eventos
 * offline e manda tudo de uma vez ao reconectar"). O backend processa
 * cada item NA ORDEM enviada e devolve sucesso/erro item a item, então
 * um evento inválido no meio da fila nunca impede os outros de
 * sincronizar. Em lotes de mais de 200 itens (limite do endpoint),
 * envia em pedaços , sempre respeitando a ordem original, nunca em
 * paralelo (a cadeia de hash exige que cada motorista seja processado
 * sequencialmente).
 *
 * Erros de rede (sem internet, timeout, ou qualquer falha ao alcançar
 * o backend) deixam TODO o pedaço como PENDENTE para tentar de novo
 * depois. Um erro do backend recusando UM registro específico (ex.:
 * evento malformado) marca só aquele item como ERRO, mas NUNCA
 * descarta o registro local , ele fica visível no Histórico até
 * alguém (RH) resolver, e o motorista pode continuar batendo ponto
 * normalmente enquanto isso.
 */

const TAMANHO_MAX_LOTE = 200;

let sincronizando = false;
let listenersIniciados = false;

// Callback opcional que a UI (App.tsx) registra pra saber quando o
// backend rejeitou 401 de forma consistente , sinal forte de que o
// vínculo deste aparelho foi revogado (ex.: a empresa aprovou a troca
// pra OUTRO aparelho, ou revogou direto pelo painel). Um 401 isolado
// não dispara isto (pode ser um bug passageiro); só dispara quando TODA
// a fila pendente bate 401 na mesma rodada de sync.
let aoDetectarPossivelRevogacao: (() => void) | null = null;

export function registrarCallbackRevogacao(
  callback: (() => void) | null,
): void {
  aoDetectarPossivelRevogacao = callback;
}

function emPedacos<T>(itens: T[], tamanho: number): T[][] {
  const pedacos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    pedacos.push(itens.slice(i, i + tamanho));
  }
  return pedacos;
}

export async function sincronizarFila(): Promise<{
  enviados: number;
  erros: number;
}> {
  if (sincronizando) return { enviados: 0, erros: 0 };
  sincronizando = true;

  let enviados = 0;
  let erros = 0;
  let total401 = 0;
  let totalProcessado = 0;

  try {
    const credenciais = await obterCredenciais();
    if (!credenciais) return { enviados, erros };

    const pendentes = await listarPendentes();
    for (const pedaco of emPedacos(pendentes, TAMANHO_MAX_LOTE)) {
      try {
        const resultados = await enviarLoteRegistros(credenciais, pedaco);
        for (const resultado of resultados) {
          const registro = pedaco[resultado.index];
          if (!registro) continue;
          if (resultado.sucesso) {
            marcarEnviado(registro.idLocal);
            enviados++;
          } else {
            marcarErro(
              registro.idLocal,
              resultado.erro ?? "Falha ao processar no backend",
            );
            erros++;
          }
          totalProcessado++;
        }
      } catch (err) {
        // Falha ao enviar o LOTE inteiro (rede fora do ar, timeout, ou
        // o próprio POST /registros-jornada/lote rejeitado , ex.: 401
        // por dispositivo revogado, que aqui vale para o pedaço todo).
        // Cada item do pedaço fica PENDENTE/ERRO individualmente, igual
        // ao comportamento anterior de envio um a um.
        const mensagem =
          err instanceof ErroApi ? err.message : "Falha de conexão";
        const status401 = err instanceof ErroApi && err.status === 401;
        // Rodada 137 , falha de REDE/servidor fora do ar/timeout NÃO é
        // rejeição do ponto: o registro continua exatamente como estava
        // (PENDENTE segue PENDENTE; ERRO segue ERRO com a explicação
        // original do backend, não é sobrescrita por "Falha de
        // conexão"). Só vira ERRO o que o backend rejeitou de verdade
        // (por item, acima) ou o lote inteiro recusado (4xx).
        const falhaTransitoria =
          !(err instanceof ErroApi) ||
          err.status === undefined ||
          err.status === 0 ||
          err.status === 408 ||
          err.status === 429 ||
          err.status >= 500;
        for (const registro of pedaco) {
          if (!falhaTransitoria) marcarErro(registro.idLocal, mensagem);
          erros++;
          totalProcessado++;
          if (status401) total401++;
        }
      }
    }

    if (totalProcessado > 0 && total401 === totalProcessado) {
      aoDetectarPossivelRevogacao?.();
    }
  } finally {
    sincronizando = false;
  }

  return { enviados, erros };
}

/**
 * Esvazia a fila local de "ciência" em ajustes (Rodada 79). Mesmo
 * espírito do `sincronizarFila()`: nunca bloqueia a UI (quem chama já
 * atualizou a tela otimisticamente), erro de rede simplesmente deixa o
 * item na fila pra tentar de novo na próxima rodada.
 */
export async function sincronizarCiencias(): Promise<void> {
  const credenciais = await obterCredenciais();
  if (!credenciais) return;

  const pendentes = listarCienciasPendentes();
  for (const pendente of pendentes) {
    try {
      await darCienciaAjuste(credenciais, pendente.tratamentoId);
      marcarCienciaEnviada(pendente.tratamentoId);
    } catch {
      // Sem internet (ou backend fora) agora , fica na fila, tenta de novo depois.
    }
  }
}

/**
 * Esvazia a fila local de "ciência" em alertas de jornada (Rodada
 * 126). Mesmo espírito das duas de cima , o alerta em si nunca é
 * apagado nem alterado no backend por isto, só ganha o carimbo de
 * leitura quando a sincronização consegue avisar.
 */
export async function sincronizarAlertasVisualizados(): Promise<void> {
  const credenciais = await obterCredenciais();
  if (!credenciais) return;

  const pendentes = listarAlertasVisualizadosPendentes();
  for (const pendente of pendentes) {
    try {
      await marcarAlertaVisualizado(credenciais, pendente.alertaId);
      marcarAlertaVisualizadoEnviado(pendente.alertaId);
    } catch {
      // Sem internet (ou backend fora) agora , fica na fila, tenta de novo depois.
    }
  }
}

/** Chame uma vez, ao abrir o app: reage a voltar de sinal e faz um pull periódico de segurança. */
export function iniciarSincronizacaoAutomatica(): () => void {
  if (listenersIniciados) return () => {};
  listenersIniciados = true;

  const unsubscribeNetInfo = NetInfo.addEventListener((estado) => {
    if (estado.isConnected && estado.isInternetReachable !== false) {
      // Rodada 92 , antes de tudo (mesmo chamado em paralelo, sem
      // bloquear): aproveita toda volta de conectividade pra confirmar
      // a hora com o servidor, não só pra esvaziar a fila de pontos.
      void sincronizarRelogioConfiavelSeNecessario();
      void sincronizarFila();
      void sincronizarCiencias();
      void sincronizarAlertasVisualizados();
    }
  });

  const intervalo = setInterval(() => {
    // Rodada 151 , bateria: em segundo plano não faz polling; a volta
    // da rede (NetInfo) e a volta ao primeiro plano já sincronizam.
    if (AppState.currentState !== "active") return;
    void sincronizarFila();
    void sincronizarCiencias();
    void sincronizarAlertasVisualizados();
  }, 60_000);

  return () => {
    unsubscribeNetInfo();
    clearInterval(intervalo);
    listenersIniciados = false;
  };
}
