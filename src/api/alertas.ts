import { API_URL } from './client';
import type { CredenciaisDispositivo } from '../types';

export interface AlertaJornada {
  id: string;
  tipo: string;
  severidade: 'INFO' | 'ATENCAO' | 'CRITICO';
  mensagem: string;
  createdAt: string;
  /** Rodada 126 , carimbo de quando o próprio motorista deu ciência deste alerta no app (nunca remove o alerta, só registra a leitura). */
  motoristaVisualizadoEm: string | null;
}

/** Alertas do próprio motorista (além da notificação push nos críticos). */
export async function listarMeusAlertas(credenciais: CredenciaisDispositivo): Promise<AlertaJornada[]> {
  const resposta = await fetch(`${API_URL}/dispositivo/meus-alertas`, {
    headers: {
      'X-Motorista-Id': credenciais.motoristaId,
      'X-Device-Uuid': credenciais.deviceUuid,
      'X-Device-Key': credenciais.deviceApiKey,
    },
  });
  if (!resposta.ok) throw new Error(`Falha ao buscar alertas (HTTP ${resposta.status})`);
  return resposta.json();
}

/** Dá ciência, do lado do motorista, de que ele viu este alerta no app , nunca apaga nem esconde o alerta. */
export async function marcarAlertaVisualizado(
  credenciais: CredenciaisDispositivo,
  alertaId: string,
): Promise<void> {
  const resposta = await fetch(
    `${API_URL}/dispositivo/meus-alertas/${alertaId}/visualizar`,
    {
      method: 'PATCH',
      headers: {
        'X-Motorista-Id': credenciais.motoristaId,
        'X-Device-Uuid': credenciais.deviceUuid,
        'X-Device-Key': credenciais.deviceApiKey,
      },
    },
  );
  if (!resposta.ok)
    throw new Error(`Falha ao marcar alerta como visto (HTTP ${resposta.status})`);
}
