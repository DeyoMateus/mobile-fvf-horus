import * as SQLite from "expo-sqlite";
import { cifrarParaColuna, decifrarDaColuna } from "./localEncryption";
import type { RegistroLocal, StatusSincronizacao, TipoEvento } from "../types";

/**
 * Fila local (SQLite) de eventos de jornada. É o coração do "funciona
 * sem internet": todo toque do motorista grava aqui IMEDIATAMENTE, com o
 * timestamp real do momento do toque , o envio ao backend (SyncService)
 * é assíncrono e pode acontecer minutos ou horas depois, sem que o
 * motorista precise esperar ou repetir nada.
 *
 * O payload sensível (GPS, odômetro, observação) fica na coluna
 * `dadosCifrados`, cifrado com AES-256-GCM (ver `localEncryption.ts`) ,
 * por isso todas as funções que leem/gravam esse payload são
 * assíncronas (a chave vive no Keychain/Keystore, que é async).
 */

interface PayloadCifrado {
  latitude?: number | null;
  longitude?: number | null;
  precisaoGpsM?: number | null;
  observacao?: string | null;
  flagsIntegridadeDispositivo?: string[] | null;
  /** Rodada 88 , ver RegistroLocal.elapsedRealtimeMs em ../types.ts. */
  elapsedRealtimeMs?: number | null;
}

interface LinhaBruta {
  idLocal: string;
  tipoEvento: TipoEvento;
  timestampEvento: string;
  dadosCifrados: string;
  status: StatusSincronizacao;
  tentativas: number;
  ultimoErro: string | null;
  criadoEm: string;
  enviadoEm: string | null;
}

const db = SQLite.openDatabaseSync("fvf_horus_registros.db");

export function iniciarBanco(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS registros_pendentes (
      idLocal TEXT PRIMARY KEY NOT NULL,
      tipoEvento TEXT NOT NULL,
      timestampEvento TEXT NOT NULL,
      dadosCifrados TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      tentativas INTEGER NOT NULL DEFAULT 0,
      ultimoErro TEXT,
      criadoEm TEXT NOT NULL,
      enviadoEm TEXT
    );
  `);
  migrarColunasAntigasSePreciso();
  limparRegistrosAntigosSeNecessario();
}

/**
 * Pedido do usuário: o histórico local (SQLite) cresce pra sempre, já
 * que nenhum registro era apagado. Isso aqui apaga os registros com
 * mais de 30 dias que já bateram (`ENVIADO`, confirmado pelo servidor)
 * ou que deram erro (`ERRO`, já tentou e não conseguiu , depois de 30
 * dias não faz mais sentido guardar) , nunca toca em `PENDENTE`, não
 * importa a idade, pra não perder nada que ainda não foi sincronizado.
 *
 * Roda no máximo 1x por dia (não a cada abertura do app, que seria
 * muito mais frequente que o necessário) , controla isso guardando a
 * data da última execução na tabela `limpeza_historico_controle`.
 *
 * Não é perda de dado pro motorista: o comprovante em PDF
 * ("Baixar/compartilhar comprovante" no Histórico) busca direto no
 * servidor por período, então ele continua conseguindo o comprovante
 * de qualquer data mesmo depois do registro ter sido apagado daqui.
 */
const DIAS_RETENCAO_HISTORICO_LOCAL = 30;
const INTERVALO_MINIMO_LIMPEZA_MS = 24 * 60 * 60 * 1000;

function limparRegistrosAntigosSeNecessario(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS limpeza_historico_controle (
      chave TEXT PRIMARY KEY NOT NULL,
      ultimaExecucaoEm TEXT NOT NULL
    );
  `);

  const linha = db.getFirstSync<{ ultimaExecucaoEm: string }>(
    `SELECT ultimaExecucaoEm FROM limpeza_historico_controle WHERE chave = 'registros_pendentes'`,
  );
  const agora = new Date();
  if (
    linha &&
    agora.getTime() - new Date(linha.ultimaExecucaoEm).getTime() <
      INTERVALO_MINIMO_LIMPEZA_MS
  ) {
    return;
  }

  const limite = new Date(agora);
  limite.setDate(limite.getDate() - DIAS_RETENCAO_HISTORICO_LOCAL);
  db.runSync(
    `DELETE FROM registros_pendentes
     WHERE status IN ('ENVIADO', 'ERRO')
       AND criadoEm < ?`,
    [limite.toISOString()],
  );

  db.runSync(
    `INSERT INTO limpeza_historico_controle (chave, ultimaExecucaoEm)
     VALUES ('registros_pendentes', ?)
     ON CONFLICT(chave) DO UPDATE SET ultimaExecucaoEm = excluded.ultimaExecucaoEm`,
    [agora.toISOString()],
  );
}

/**
 * Compatibilidade com instalações anteriores a esta versão (que
 * gravavam latitude/longitude/etc em colunas separadas, em texto
 * claro). Se essas colunas ainda existirem, migra o conteúdo pra
 * `dadosCifrados` uma única vez. Instalação nova (banco criado já com o
 * schema atual) não tem essas colunas e este bloco não faz nada.
 */
function migrarColunasAntigasSePreciso(): void {
  const colunas = db.getAllSync<{ name: string }>(
    `PRAGMA table_info(registros_pendentes);`,
  );
  const temColunaAntiga = colunas.some((c) => c.name === "latitude");
  if (!temColunaAntiga) return;

  const linhas = db.getAllSync<{
    idLocal: string;
    latitude: number | null;
    longitude: number | null;
    precisaoGpsM: number | null;
    observacao: string | null;
  }>(
    `SELECT idLocal, latitude, longitude, precisaoGpsM, observacao FROM registros_pendentes`,
  );

  void (async () => {
    for (const linha of linhas) {
      const cifrado = await cifrarParaColuna({
        latitude: linha.latitude,
        longitude: linha.longitude,
        precisaoGpsM: linha.precisaoGpsM,
        observacao: linha.observacao,
      });
      db.runSync(
        `UPDATE registros_pendentes SET dadosCifrados = ? WHERE idLocal = ?`,
        [cifrado, linha.idLocal],
      );
    }
  })();
}

async function paraRegistroLocal(linha: LinhaBruta): Promise<RegistroLocal> {
  const payload = await decifrarDaColuna<PayloadCifrado>(linha.dadosCifrados);
  return {
    idLocal: linha.idLocal,
    tipoEvento: linha.tipoEvento,
    timestampEvento: linha.timestampEvento,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    precisaoGpsM: payload.precisaoGpsM ?? null,
    observacao: payload.observacao ?? null,
    flagsIntegridadeDispositivo: payload.flagsIntegridadeDispositivo ?? null,
    elapsedRealtimeMs: payload.elapsedRealtimeMs ?? null,
    status: linha.status,
    tentativas: linha.tentativas,
    ultimoErro: linha.ultimoErro,
    criadoEm: linha.criadoEm,
    enviadoEm: linha.enviadoEm,
  };
}

export async function inserirRegistro(registro: RegistroLocal): Promise<void> {
  const dadosCifrados = await cifrarParaColuna({
    latitude: registro.latitude ?? null,
    longitude: registro.longitude ?? null,
    precisaoGpsM: registro.precisaoGpsM ?? null,
    observacao: registro.observacao ?? null,
    flagsIntegridadeDispositivo: registro.flagsIntegridadeDispositivo ?? null,
    elapsedRealtimeMs: registro.elapsedRealtimeMs ?? null,
  });

  db.runSync(
    `INSERT INTO registros_pendentes
      (idLocal, tipoEvento, timestampEvento, dadosCifrados, status, tentativas, ultimoErro, criadoEm, enviadoEm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      registro.idLocal,
      registro.tipoEvento,
      registro.timestampEvento,
      dadosCifrados,
      registro.status,
      registro.tentativas,
      registro.ultimoErro ?? null,
      registro.criadoEm,
      registro.enviadoEm ?? null,
    ],
  );
}

export async function listarRegistros(): Promise<RegistroLocal[]> {
  const linhas = db.getAllSync<LinhaBruta>(
    `SELECT * FROM registros_pendentes ORDER BY timestampEvento DESC`,
  );
  return Promise.all(linhas.map(paraRegistroLocal));
}

export async function listarPendentes(): Promise<RegistroLocal[]> {
  const linhas = db.getAllSync<LinhaBruta>(
    `SELECT * FROM registros_pendentes WHERE status IN ('PENDENTE', 'ERRO') ORDER BY timestampEvento ASC`,
  );
  return Promise.all(linhas.map(paraRegistroLocal));
}

export function marcarEnviado(idLocal: string): void {
  db.runSync(
    `UPDATE registros_pendentes SET status = 'ENVIADO', enviadoEm = ?, ultimoErro = NULL WHERE idLocal = ?`,
    [new Date().toISOString(), idLocal],
  );
}

export function marcarErro(idLocal: string, erro: string): void {
  db.runSync(
    `UPDATE registros_pendentes SET status = 'ERRO', tentativas = tentativas + 1, ultimoErro = ? WHERE idLocal = ?`,
    [erro, idLocal],
  );
}

/**
 * Igual à anterior, mas ignorando eventos "OUTRO" , usado pela máquina
 * de estados dos botões (ver `domain/regrasJornada.ts`), já que "Outro"
 * é uma anotação livre e não representa estar "dentro" de nenhuma etapa
 * da jornada (direção/descanso/espera), não deve mudar o que aparece
 * como próximo passo disponível.
 */
export function ultimoTipoEventoRelevanteRegistrado(): TipoEvento | null {
  // Rodada 63 , "OUTRO" ("Aguardando documentação") deixou de ser
  // ignorado aqui: agora é um status de verdade na máquina de estados
  // (ver domain/regrasJornada.ts), então conta como o último evento
  // relevante igual a qualquer outro.
  //
  // Rodada 88 , reconcilia com o último ajuste do gestor conhecido (ver
  // `ajuste_gestor_mais_recente` mais abaixo): sem isso, um "Fim de
  // jornada" lançado pela empresa nunca aparecia aqui, porque só existe
  // como `TratamentoPonto` no backend, nunca como um toque local deste
  // aparelho. `criadoEm` entra na consulta só pra decidir a precedência
  // contra o ajuste (ver `maisRecenteEntreLocalEAjuste`) , nunca é
  // devolvido pra fora desta função.
  //
  // Rodada 90.1 , bug real encontrado pelo usuário: "ORDER BY
  // timestampEvento DESC" pega o registro com o VALOR de data/hora mais
  // alto, não o que foi tocado por último de verdade. Este app tem
  // registros locais de rodadas de teste de fraude anteriores com
  // `timestampEvento` FABRICADO (relógio adiantado de propósito pra
  // testar o bloqueio) , um desses (`FIM_DESCANSO` às 21:39:08) tem um
  // horário "mais tarde no dia" que qualquer toque real de agora, então
  // vencia pra sempre até a hora real do dia realmente passar das
  // 21:39. Trocado pra `ORDER BY rowid DESC`: `rowid` é a ordem real de
  // INSERÇÃO no SQLite (a tabela não é `WITHOUT ROWID`), imune a
  // qualquer valor de `timestampEvento` guardado na linha , reflete
  // sempre o toque mais recente DE VERDADE neste aparelho.
  const linha = db.getFirstSync<{
    tipoEvento: TipoEvento;
    timestampEvento: string;
    criadoEm: string;
  }>(
    `SELECT tipoEvento, timestampEvento, criadoEm FROM registros_pendentes ORDER BY rowid DESC LIMIT 1`,
  );
  return maisRecenteEntreLocalEAjuste(linha ?? null)?.tipoEvento ?? null;
}

/**
 * Igual à anterior, mas devolvendo também o `timestampEvento` , usado
 * pelo cronômetro da tela de registrar ponto (ver `RegistrarPontoScreen`)
 * pra contar o tempo decorrido desde a última etapa batida.
 */
export function ultimoRegistroRelevante(): {
  tipoEvento: TipoEvento;
  timestampEvento: string;
} | null {
  // Rodada 90.1 , mesma correção de `ultimoTipoEventoRelevanteRegistrado`
  // acima: ordena por `rowid` (ordem real de inserção), não por
  // `timestampEvento` (pode estar fabricado num registro antigo de teste).
  const linha = db.getFirstSync<{
    tipoEvento: TipoEvento;
    timestampEvento: string;
    criadoEm: string;
  }>(
    `SELECT tipoEvento, timestampEvento, criadoEm FROM registros_pendentes ORDER BY rowid DESC LIMIT 1`,
  );
  // Rodada 88 , mesma reconciliação de `ultimoTipoEventoRelevanteRegistrado`
  // acima: um ajuste do gestor mais recente (por `criadoEmServidor`,
  // nunca por `timestampEvento`) vence (ver `maisRecenteEntreLocalEAjuste`).
  return maisRecenteEntreLocalEAjuste(linha ?? null);
}

/**
 * Pedido do usuário: "por acidente ele pode finalizar a jornada antes
 * do fim do dia e iniciar outra não tem problema... o aviso deve
 * aparecer se ele já cumpriu as horas determinadas por lei". Antes de
 * mostrar o aviso de descanso interjornada insuficiente (ver
 * `RegistrarPontoScreen.confirmarERegistrar`), o app precisa saber se
 * a ÚLTIMA jornada fechada deste aparelho já somou 8h de direção
 * (mesmo limiar usado no backend , ver
 * JornadaLegalService.avaliarDescansoInterjornada) , se não somou, a
 * nova jornada é um complemento da anterior, não uma jornada nova de
 * verdade, e o aviso não deve aparecer.
 *
 * Devolve `null` quando não dá pra saber com certeza (ex.: o
 * `INICIO_JORNADA` que abriu essa jornada já foi apagado do histórico
 * local pela limpeza de 30 dias , ver `limparRegistrosAntigosSeNecessario`)
 * , nesse caso o chamador decide o lado mais seguro (mostrar o aviso
 * mesmo sem ter certeza, já que quem decide de verdade é o backend).
 */
export function obterMinutosDirecaoDaUltimaJornadaFechada(): number | null {
  const linhas = db.getAllSync<{
    tipoEvento: TipoEvento;
    timestampEvento: string;
  }>(
    `SELECT tipoEvento, timestampEvento FROM registros_pendentes ORDER BY rowid ASC`,
  );
  if (linhas.length === 0) return null;

  const idxFimJornada = linhas
    .map((l) => l.tipoEvento)
    .lastIndexOf("FIM_JORNADA");
  if (idxFimJornada === -1) return null;

  const idxInicioJornada = linhas
    .slice(0, idxFimJornada)
    .map((l) => l.tipoEvento)
    .lastIndexOf("INICIO_JORNADA");
  if (idxInicioJornada === -1) return null; // não dá pra ter certeza , caiu fora do histórico local

  const jornada = linhas.slice(idxInicioJornada, idxFimJornada + 1);
  let totalMin = 0;
  let abertoEm: number | null = null;
  for (const l of jornada) {
    if (l.tipoEvento === "INICIO_DIRECAO") {
      abertoEm = new Date(l.timestampEvento).getTime();
    } else if (l.tipoEvento === "FIM_DIRECAO" && abertoEm !== null) {
      totalMin += (new Date(l.timestampEvento).getTime() - abertoEm) / 60000;
      abertoEm = null;
    }
  }
  return Math.round(totalMin);
}

export type { StatusSincronizacao };

/**
 * Fila local das amostras de GPS periódicas em segundo plano
 * ("luneta"). Tabela separada da de registros de ponto , payload mais
 * simples (só coordenada + precisão), não passa pelo mesmo envelope de
 * cifragem porque não carrega dados de identificação nem observação
 * livre, só posição e horário, que somem da fila assim que sincronizam.
 */
interface LinhaAmostraLocalizacao {
  idLocal: string;
  latitude: number;
  longitude: number;
  precisaoGpsM: number | null;
  capturadoEm: string;
  status: StatusSincronizacao;
  criadoEm: string;
}

export function iniciarBancoAmostrasLocalizacao(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS amostras_localizacao_pendentes (
      idLocal TEXT PRIMARY KEY NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      precisaoGpsM REAL,
      capturadoEm TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      criadoEm TEXT NOT NULL
    );
  `);
}

export function inserirAmostraLocalizacao(amostra: {
  idLocal: string;
  latitude: number;
  longitude: number;
  precisaoGpsM: number | null;
  capturadoEm: string;
}): void {
  db.runSync(
    `INSERT OR IGNORE INTO amostras_localizacao_pendentes
      (idLocal, latitude, longitude, precisaoGpsM, capturadoEm, status, criadoEm)
     VALUES (?, ?, ?, ?, ?, 'PENDENTE', ?)`,
    [
      amostra.idLocal,
      amostra.latitude,
      amostra.longitude,
      amostra.precisaoGpsM,
      amostra.capturadoEm,
      new Date().toISOString(),
    ],
  );
}

export function listarAmostrasLocalizacaoPendentes(): LinhaAmostraLocalizacao[] {
  return db.getAllSync<LinhaAmostraLocalizacao>(
    `SELECT * FROM amostras_localizacao_pendentes WHERE status = 'PENDENTE' ORDER BY capturadoEm ASC LIMIT 500`,
  );
}

export function marcarAmostrasLocalizacaoEnviadas(idsLocais: string[]): void {
  if (idsLocais.length === 0) return;
  const placeholders = idsLocais.map(() => "?").join(",");
  db.runSync(
    `DELETE FROM amostras_localizacao_pendentes WHERE idLocal IN (${placeholders})`,
    idsLocais,
  );
}

/**
 * Fila local de "dar ciência" num ajuste lançado pela empresa (Rodada
 * 79 , pedido do usuário: essa ação NÃO pode depender de internet,
 * igual a bater ponto). O motorista toca "Marcar como lido", a tela
 * atualiza na hora e este registro fica aqui até o SyncService
 * conseguir avisar o backend , sem alertar nem travar o motorista
 * enquanto isso.
 */
interface LinhaCienciaPendente {
  tratamentoId: string;
  criadoEm: string;
}

export function iniciarBancoCienciasPendentes(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ciencias_pendentes (
      tratamentoId TEXT PRIMARY KEY NOT NULL,
      criadoEm TEXT NOT NULL
    );
  `);
}

export function registrarCienciaPendente(tratamentoId: string): void {
  db.runSync(
    `INSERT OR IGNORE INTO ciencias_pendentes (tratamentoId, criadoEm) VALUES (?, ?)`,
    [tratamentoId, new Date().toISOString()],
  );
}

export function listarCienciasPendentes(): LinhaCienciaPendente[] {
  return db.getAllSync<LinhaCienciaPendente>(
    `SELECT * FROM ciencias_pendentes ORDER BY criadoEm ASC`,
  );
}

export function marcarCienciaEnviada(tratamentoId: string): void {
  db.runSync(`DELETE FROM ciencias_pendentes WHERE tratamentoId = ?`, [
    tratamentoId,
  ]);
}

/**
 * Rodada 127 , achado real do usuário: "Marcar como lido" num ajuste
 * lançado pela empresa atualizava a tela na hora, mas ao sair e voltar
 * pra aba (o componente desmonta e remonta, perdendo o estado em
 * memória) a lista vinha de novo do backend e, se a sincronização
 * ainda não tinha ido (sem internet no momento, por exemplo), o item
 * voltava a aparecer como "não lido" , parecia que o clique não tinha
 * feito nada.
 *
 * Esta tabela é permanente (nunca é limpa depois de sincronizar,
 * diferente de `ciencias_pendentes` acima, que é só a fila de envio) ,
 * é o que garante que o estado "já abri isso" sobrevive a trocar de
 * aba e a reabrir o app, não importa internet nem o gestor. Pedido
 * explícito do usuário: "o gestor não precisa saber quando o
 * motorista leu, é apenas para o motorista ter o controle do que já
 * abriu" , por isso isto é só um bookmark local, nunca depende do que
 * o backend devolve pra decidir o que mostrar no botão.
 */
interface LinhaAjusteVistoLocalmente {
  tratamentoId: string;
  vistoEm: string;
}

export function iniciarBancoAjustesVistosLocalmente(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ajustes_vistos_localmente (
      tratamentoId TEXT PRIMARY KEY NOT NULL,
      vistoEm TEXT NOT NULL
    );
  `);
}

export function registrarAjusteVistoLocalmente(tratamentoId: string): void {
  db.runSync(
    `INSERT OR IGNORE INTO ajustes_vistos_localmente (tratamentoId, vistoEm) VALUES (?, ?)`,
    [tratamentoId, new Date().toISOString()],
  );
}

export function obterAjustesVistosLocalmente(): Record<string, string> {
  const linhas = db.getAllSync<LinhaAjusteVistoLocalmente>(
    `SELECT * FROM ajustes_vistos_localmente`,
  );
  const mapa: Record<string, string> = {};
  for (const linha of linhas) mapa[linha.tratamentoId] = linha.vistoEm;
  return mapa;
}

/**
 * Rodada 126 , pedido do usuário: o motorista dar ciência de um alerta
 * de jornada (no app) também não pode depender de internet no
 * momento , mesmo padrão da fila de ciência de ajuste acima. O alerta
 * em si nunca é apagado nem escondido por isto, "ele sempre deve
 * permanecer" , é só um carimbo de leitura enviado ao backend quando
 * der.
 */
interface LinhaAlertaVisualizadoPendente {
  alertaId: string;
  criadoEm: string;
}

export function iniciarBancoAlertasVisualizadosPendentes(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS alertas_visualizados_pendentes (
      alertaId TEXT PRIMARY KEY NOT NULL,
      criadoEm TEXT NOT NULL
    );
  `);
}

export function registrarAlertaVisualizadoPendente(alertaId: string): void {
  db.runSync(
    `INSERT OR IGNORE INTO alertas_visualizados_pendentes (alertaId, criadoEm) VALUES (?, ?)`,
    [alertaId, new Date().toISOString()],
  );
}

export function listarAlertasVisualizadosPendentes(): LinhaAlertaVisualizadoPendente[] {
  return db.getAllSync<LinhaAlertaVisualizadoPendente>(
    `SELECT * FROM alertas_visualizados_pendentes ORDER BY criadoEm ASC`,
  );
}

export function marcarAlertaVisualizadoEnviado(alertaId: string): void {
  db.runSync(
    `DELETE FROM alertas_visualizados_pendentes WHERE alertaId = ?`,
    [alertaId],
  );
}

/**
 * Rodada 88 , achado real do usuário: "o ponto ainda não está sendo
 * possível bater no app quando o gestor adiciona esse ponto pela
 * plataforma, o sistema não entende como fim de jornada".
 *
 * Causa raiz: `ultimoTipoEventoRelevanteRegistrado`/`ultimoRegistroRelevante`
 * (usadas pela máquina de estados dos botões, ver `domain/regrasJornada.ts`)
 * só olhavam `registros_pendentes` , a fila LOCAL de toques deste
 * aparelho. Um "Fim de jornada" que o gestor lança pela plataforma vira
 * um `TratamentoPonto` (tabela paralela no backend, nunca um
 * `RegistroJornada` , ver `TratamentosPontoService`), e o app nunca
 * puxava isso de volta: o motorista continuava vendo a tela travada no
 * estado de antes do ajuste, sem conseguir iniciar uma jornada nova.
 *
 * Esta tabela guarda só o ÚLTIMO ajuste do gestor conhecido por este
 * aparelho (buscado via `GET /dispositivo/meus-ajustes`, já usado pela
 * tela "Meus ajustes" , não é uma chamada nova ao backend, só um uso
 * novo do mesmo dado). Funciona OFFLINE depois da primeira sincronização
 * porque fica salvo aqui , não depende de rede toda vez que a tela abre.
 */
interface LinhaAjusteGestor {
  tratamentoId: string;
  tipoEvento: TipoEvento;
  timestampEvento: string;
  /**
   * Rodada 88.1 , correção de um bug real: a versão original desta
   * tabela comparava por `timestampEvento` (a data que o GESTOR ESCOLHE
   * ao lançar o ajuste , pode ser qualquer data, inclusive antiga/errada
   * de um teste). Um único ajuste antigo com data estranha no banco
   * (este projeto tem vários, de rodadas de teste de fraude anteriores)
   * nunca perdia pra um toque novo do motorista, porque "agora" nunca é
   * maior que uma data já fabricada , travando a tela PRA SEMPRE no
   * estado do ajuste (exatamente o bug relatado: "aperta iniciar
   * viagem, confirma, e volta pro início , o registro nem aparece no
   * histórico" porque o estado dos botões nunca saía do ajuste velho).
   *
   * A correção: decidir precedência por `createdAt` do TratamentoPonto
   * , quando ele foi de fato CRIADO no servidor, campo que ninguém
   * escolhe manualmente (é o `@default(now())` do Prisma) , em vez de
   * `timestampEvento`. `timestampEvento` continua guardado só pra uso
   * de EXIBIÇÃO (ex.: "desde quando" do cronômetro), nunca mais pra
   * decidir quem vence.
   */
  criadoEmServidor: string;
}

export function iniciarBancoAjusteGestor(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ajuste_gestor_mais_recente (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tratamentoId TEXT NOT NULL,
      tipoEvento TEXT NOT NULL,
      timestampEvento TEXT NOT NULL,
      criadoEmServidor TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
    );
  `);
  // Rodada 88.1 , instalações que já criaram a tabela na versão anterior
  // (sem `criadoEmServidor`) precisam da coluna nova antes de qualquer
  // leitura/escrita abaixo, mesmo padrão de `migrarColunasAntigasSePreciso`.
  const colunas = db.getAllSync<{ name: string }>(
    `PRAGMA table_info(ajuste_gestor_mais_recente);`,
  );
  if (!colunas.some((c) => c.name === "criadoEmServidor")) {
    db.execSync(
      `ALTER TABLE ajuste_gestor_mais_recente ADD COLUMN criadoEmServidor TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';`,
    );
  }
}

/**
 * Só substitui o que já está salvo se o ajuste novo tiver sido criado
 * DEPOIS no servidor (`criadoEmServidor`) , nunca compara por
 * `timestampEvento` (ver comentário em `LinhaAjusteGestor` acima).
 */
export function salvarAjusteGestorMaisRecenteSeMaisNovo(
  ajuste: LinhaAjusteGestor,
): void {
  const atual = db.getFirstSync<LinhaAjusteGestor>(
    `SELECT * FROM ajuste_gestor_mais_recente WHERE id = 1`,
  );
  if (
    atual &&
    new Date(atual.criadoEmServidor).getTime() >=
      new Date(ajuste.criadoEmServidor).getTime()
  )
    return;
  db.runSync(
    `INSERT INTO ajuste_gestor_mais_recente (id, tratamentoId, tipoEvento, timestampEvento, criadoEmServidor)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET tratamentoId = excluded.tratamentoId, tipoEvento = excluded.tipoEvento, timestampEvento = excluded.timestampEvento, criadoEmServidor = excluded.criadoEmServidor`,
    [
      ajuste.tratamentoId,
      ajuste.tipoEvento,
      ajuste.timestampEvento,
      ajuste.criadoEmServidor,
    ],
  );
}

function obterAjusteGestorMaisRecente(): LinhaAjusteGestor | null {
  return (
    db.getFirstSync<LinhaAjusteGestor>(
      `SELECT * FROM ajuste_gestor_mais_recente WHERE id = 1`,
    ) ?? null
  );
}

/**
 * Reconciliação: entre o último toque batido neste aparelho e o último
 * ajuste do gestor conhecido, vale quem aconteceu DEPOIS de verdade ,
 * o toque local usa `criadoEm` (quando foi salvo neste aparelho, nunca
 * editável), o ajuste usa `criadoEmServidor` (nunca `timestampEvento`,
 * ver `LinhaAjusteGestor`). Uma vez que um toque local mais novo
 * exista, ele sempre vence um ajuste antigo, não importa que data o
 * ajuste tenha registrado.
 */
function maisRecenteEntreLocalEAjuste(
  local: {
    tipoEvento: TipoEvento;
    timestampEvento: string;
    criadoEm: string;
  } | null,
): { tipoEvento: TipoEvento; timestampEvento: string } | null {
  const ajuste = obterAjusteGestorMaisRecente();
  if (!ajuste) return local;
  if (!local)
    return {
      tipoEvento: ajuste.tipoEvento,
      timestampEvento: ajuste.timestampEvento,
    };
  const ajusteVence =
    new Date(ajuste.criadoEmServidor).getTime() >
    new Date(local.criadoEm).getTime();
  return ajusteVence
    ? { tipoEvento: ajuste.tipoEvento, timestampEvento: ajuste.timestampEvento }
    : local;
}
