import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

export interface PerfilMotorista {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
}

export interface AtualizarPerfilMotoristaInput {
  nome: string;
  telefone: string;
}

export interface TotaisHoras {
  direcaoMin: number;
  esperaMin: number;
  normalMin: number;
  extraMin: number;
  noturnoMin: number;
}

export interface BancoHorasMotorista {
  ativo: boolean;
  saldoMesMin: number;
  saldoTotalMin: number;
}

export interface MinhasHoras {
  periodoInicio: string;
  periodoFim: string;
  /** Rodada 134 , diz se o período devolvido é o mês atual (ainda "até hoje") ou um mês anterior já encerrado. */
  ehMesAtual: boolean;
  horasMes: TotaisHoras;
  bancoHoras: BancoHorasMotorista | null;
}

function headersDispositivo(credenciais: CredenciaisDispositivo) {
  return {
    "X-Motorista-Id": credenciais.motoristaId,
    "X-Device-Uuid": credenciais.deviceUuid,
    "X-Device-Key": credenciais.deviceApiKey,
  };
}

/** "Meu perfil" (Rodada 39) , nome e telefone do próprio motorista. Sem e-mail de propósito (Rodada 40) e nunca inclui/edita CPF. */
export async function obterMeuPerfil(
  credenciais: CredenciaisDispositivo,
): Promise<PerfilMotorista> {
  const resposta = await fetch(`${API_URL}/dispositivo/meu-perfil`, {
    headers: headersDispositivo(credenciais),
  });
  if (!resposta.ok)
    throw new Error(`Falha ao buscar perfil (HTTP ${resposta.status})`);
  return resposta.json();
}

export async function atualizarMeuPerfil(
  credenciais: CredenciaisDispositivo,
  dados: AtualizarPerfilMotoristaInput,
): Promise<PerfilMotorista> {
  const resposta = await fetch(`${API_URL}/dispositivo/meu-perfil`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...headersDispositivo(credenciais),
    },
    body: JSON.stringify(dados),
  });
  if (!resposta.ok) {
    const texto = await resposta.text();
    throw new Error(
      texto || `Falha ao salvar perfil (HTTP ${resposta.status})`,
    );
  }
  return resposta.json();
}

/**
 * Rodada 44 , checagem leve de que o vínculo deste aparelho ainda é
 * válido no servidor. Chamada uma vez ao abrir o app, ALÉM da
 * detecção que já existia via fila de sincronização (syncService.ts):
 * aquela só dispara quando há um registro de ponto pendente pra
 * enviar, então um motorista que nunca bate ponto de novo depois do
 * vínculo ser revogado (ex.: banco de dados recriado do zero em dev,
 * ou a empresa desativou o motorista) nunca teria isso detectado , o
 * app continuaria mostrando as telas normalmente, "logado", sem
 * conseguir mandar nada de verdade pro servidor (o backend já recusa
 * qualquer requisição de um dispositivo não vinculado , ver
 * MotoristaDeviceGuard , só que ninguém tentava mandar nada pra essa
 * recusa acontecer e ser notada).
 *
 * Retorna `true` com vínculo ativo, `false` quando o servidor
 * confirmou por DUAS vezes seguidas que recusou por autenticação
 * (401 , vínculo revogado ou motorista/dispositivo não existe mais),
 * e `null` pra qualquer outro caso , nesses, não dá pra saber se o
 * vínculo é válido ou não, então o chamador não deve fazer nada.
 *
 * Rodada 44 (ajuste , falso positivo): o app é offline-first de
 * propósito, então esta função NUNCA pode barrar ou avisar nada só
 * por falta de internet:
 *   - Sem conexão, o `fetch` rejeita (erro de rede) e cai direto no
 *     `catch` → retorna `null`. É indistinguível de qualquer outro
 *     problema de rede/timeout, e o chamador trata `null` como "não
 *     mexe em nada" , nunca desloga o motorista por estar sem sinal.
 *   - Um único 401 isolado (ex.: backend reiniciando bem na hora,
 *     proxy engasgado) também não é suficiente: só age quando a
 *     MESMA checagem confirma 401 de novo numa segunda tentativa,
 *     alguns segundos depois , a mesma filosofia de "só reage quando
 *     TODA a fila bate 401" já usada na detecção via sincronização,
 *     nunca por uma ocorrência isolada.
 *   - Cada tentativa tem um timeout curto (8s, via AbortController):
 *     uma conexão que trava sem responder também cai como erro de
 *     rede (`null`), nunca fica pendurada nem é tratada como recusa.
 */
async function chamarMeuPerfil(
  credenciais: CredenciaisDispositivo,
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_URL}/dispositivo/meu-perfil`, {
      headers: headersDispositivo(credenciais),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function verificarVinculoAtivo(
  credenciais: CredenciaisDispositivo,
): Promise<boolean | null> {
  try {
    const primeira = await chamarMeuPerfil(credenciais);
    if (primeira.status !== 401) return true;

    // 401 na primeira tentativa: confirma antes de agir. Qualquer
    // problema aqui (rede caiu entre as duas tentativas, timeout) cai
    // no catch de fora e vira `null` , não confirmado, não age.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const segunda = await chamarMeuPerfil(credenciais);
    return segunda.status === 401 ? false : true;
  } catch {
    return null;
  }
}

/**
 * "Minhas horas" (Rodada 39) , horas do mês corrente (ou de um mês
 * anterior, se `ano`/`mes` forem passados , Rodada 134, pedido do
 * usuário: "tendo a possibilidade de buscar os resultados de meses
 * anteriores") e, se a empresa usar banco de horas, saldo do mês e
 * saldo total desde a admissão.
 */
export async function obterMinhasHoras(
  credenciais: CredenciaisDispositivo,
  periodo?: { ano: number; mes: number },
): Promise<MinhasHoras> {
  const query = periodo
    ? `?ano=${periodo.ano}&mes=${periodo.mes}`
    : "";
  const resposta = await fetch(
    `${API_URL}/dispositivo/minhas-horas${query}`,
    { headers: headersDispositivo(credenciais) },
  );
  if (!resposta.ok)
    throw new Error(`Falha ao buscar horas (HTTP ${resposta.status})`);
  return resposta.json();
}
