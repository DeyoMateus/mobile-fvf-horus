import { enviarAmostrasLocalizacao, ErroApi } from "../api/client";
import {
  listarAmostrasLocalizacaoPendentes,
  marcarAmostrasLocalizacaoEnviadas,
} from "../storage/db";
import { obterCredenciais } from "../storage/secureCredentials";

/**
 * Sincroniza a fila de amostras de GPS periódicas ("luneta") , mesmo
 * princípio do syncService.ts principal (offline-first, nunca perde
 * amostra por falta de rede), só que num serviço separado porque o
 * payload e a tabela local são diferentes (ver db.ts).
 */
export async function sincronizarAmostrasLocalizacao(): Promise<{
  enviadas: number;
}> {
  const credenciais = await obterCredenciais();
  if (!credenciais) return { enviadas: 0 };

  const pendentes = listarAmostrasLocalizacaoPendentes();
  if (pendentes.length === 0) return { enviadas: 0 };

  try {
    await enviarAmostrasLocalizacao(
      credenciais,
      pendentes.map((a) => ({
        latitude: a.latitude,
        longitude: a.longitude,
        precisaoGpsM: a.precisaoGpsM,
        capturadoEm: a.capturadoEm,
      })),
    );
    marcarAmostrasLocalizacaoEnviadas(pendentes.map((a) => a.idLocal));
    return { enviadas: pendentes.length };
  } catch (erro) {
    // Sem internet ou erro do backend: as amostras continuam na fila
    // local e tentam de novo na próxima sincronização , nunca descarta.
    // Um 401 aqui (dispositivo revogado) também deixa pra próxima
    // rodada; diferente do syncService principal, não dispara o fluxo
    // de "possível revogação" sozinho (isso já é coberto pela
    // sincronização principal dos registros de ponto).
    if (!(erro instanceof ErroApi)) {
      // eslint-disable-next-line no-console
      console.warn("Falha ao sincronizar amostras de localização", erro);
    }
    return { enviadas: 0 };
  }
}
