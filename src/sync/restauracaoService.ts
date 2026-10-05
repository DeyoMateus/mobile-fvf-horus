import { buscarMeusRegistros } from "../api/registros";
import {
  contarRegistrosEnviados,
  restaurarRegistrosDoServidor,
} from "../storage/db";
import { obterCredenciais } from "../storage/secureCredentials";

let tentadoNestaSessao = false;

/**
 * Rodada 141 , aparelho novo: o SQLite local começa vazio, mas o
 * servidor já tem a jornada do motorista. Traz os últimos 30 dias pro
 * aparelho (jornada aberta, cronômetro, histórico) , só quando este
 * aparelho ainda não tem NENHUM registro já enviado, nunca sobrescreve
 * nada. Devolve quantos registros foram trazidos.
 */
export async function restaurarSeAparelhoNovo(): Promise<number> {
  if (tentadoNestaSessao) return 0;
  try {
    if (contarRegistrosEnviados() > 0) {
      tentadoNestaSessao = true;
      return 0;
    }
    const credenciais = await obterCredenciais();
    if (!credenciais) return 0;
    const doServidor = await buscarMeusRegistros(credenciais);
    tentadoNestaSessao = true; // só depois de conseguir falar com o servidor
    if (doServidor.length === 0) return 0;
    return await restaurarRegistrosDoServidor(doServidor);
  } catch {
    return 0; // sem rede agora , tenta de novo na próxima chamada
  }
}
