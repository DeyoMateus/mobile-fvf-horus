import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { suprimirProximoBloqueio } from "../security/appLockSuppression";
import { API_URL } from "./client";
import type { CredenciaisDispositivo } from "../types";

/**
 * Usa a API "legacy" do expo-file-system de propósito: a partir do SDK
 * 54 o `downloadAsync`/`cacheDirectory` que este módulo usa foram
 * substituídos pelas classes `File`/`Directory`, mas a API antiga
 * continua funcionando via este subcaminho , trocar exigiria reescrever
 * todo o fluxo de download+compartilhamento, sem ganho nenhum pro caso
 * de uso aqui (é só um PDF baixado e compartilhado na hora).
 */

async function baixarPdf(
  caminho: string,
  credenciais: CredenciaisDispositivo,
  nomeArquivo: string,
): Promise<{ uri: string; compartilhado: boolean }> {
  const destino = `${FileSystem.cacheDirectory}${nomeArquivo}`;

  const resultado = await FileSystem.downloadAsync(
    `${API_URL}${caminho}`,
    destino,
    {
      headers: {
        "X-Motorista-Id": credenciais.motoristaId,
        "X-Device-Uuid": credenciais.deviceUuid,
        "X-Device-Key": credenciais.deviceApiKey,
      },
    },
  );

  if (resultado.status !== 200) {
    throw new Error(`Falha ao baixar comprovante (HTTP ${resultado.status})`);
  }

  const disponivel = await Sharing.isAvailableAsync();
  if (disponivel) {
    // A folha de compartilhamento do sistema tira o app de primeiro
    // plano por um instante , sem isso, o app trava pedindo o PIN de
    // novo mesmo que o motorista só cancele o compartilhamento (ver
    // appLockSuppression.ts).
    suprimirProximoBloqueio();
    await Sharing.shareAsync(resultado.uri, {
      mimeType: "application/pdf",
      dialogTitle: "Comprovante de jornada",
    });
  }

  return { uri: resultado.uri, compartilhado: disponivel };
}

/**
 * Baixa o comprovante PDF do próprio motorista (rota
 * `GET /registros-jornada/meu-comprovante`, autenticada por device
 * binding) e abre a folha de compartilhamento do sistema , o motorista
 * decide se salva, manda por WhatsApp, imprime etc. Não guardamos o PDF
 * permanentemente no app: é gerado sob demanda a partir do ledger real
 * no backend, sempre atualizado.
 */
export async function baixarEcompartilharComprovante(
  credenciais: CredenciaisDispositivo,
  periodo?: { inicio?: string; fim?: string },
): Promise<{ uri: string; compartilhado: boolean }> {
  const params = new URLSearchParams();
  if (periodo?.inicio) params.set("inicio", periodo.inicio);
  if (periodo?.fim) params.set("fim", periodo.fim);
  const query = params.toString() ? `?${params.toString()}` : "";

  return baixarPdf(
    `/registros-jornada/meu-comprovante${query}`,
    credenciais,
    `comprovante-${Date.now()}.pdf`,
  );
}

/**
 * Comprovante de UM único evento (o motorista seleciona um registro na
 * tela de Histórico). `idLocal` é o mesmo idempotencyKey já guardado no
 * SQLite deste aparelho , não precisa saber o id interno do backend.
 * Só funciona pra registros que já sincronizaram (status ENVIADO); os
 * ainda PENDENTES não existem no backend pra gerar comprovante.
 */
export async function baixarEcompartilharComprovanteRegistro(
  credenciais: CredenciaisDispositivo,
  idLocal: string,
): Promise<{ uri: string; compartilhado: boolean }> {
  return baixarPdf(
    `/registros-jornada/${encodeURIComponent(idLocal)}/meu-comprovante`,
    credenciais,
    `comprovante-${idLocal}.pdf`,
  );
}

/**
 * Espelho de Ponto Eletrônico (REP-P) do próprio motorista (Rodada 27)
 * , layout com GPS/NSR/categoria legal por evento e resumo diário
 * categorizado (direção/espera/intervalos/horas extras/adicional
 * noturno), pensado pra ter valor de defesa/cobrança trabalhista. Ver
 * `RepPService` no backend sobre o que este relatório não afirma
 * (não é assinatura ICP-Brasil A1, não é validação NTP formal).
 */
export async function baixarEcompartilharEspelhoRepP(
  credenciais: CredenciaisDispositivo,
  periodo?: { inicio?: string; fim?: string },
): Promise<{ uri: string; compartilhado: boolean }> {
  const params = new URLSearchParams();
  if (periodo?.inicio) params.set("inicio", periodo.inicio);
  if (periodo?.fim) params.set("fim", periodo.fim);
  const query = params.toString() ? `?${params.toString()}` : "";

  return baixarPdf(
    `/registros-jornada/meu-espelho-rep-p${query}`,
    credenciais,
    `espelho-rep-p-${Date.now()}.pdf`,
  );
}
