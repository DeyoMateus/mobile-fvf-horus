package expo.modules.relogiomonotonico

import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Rodada 88 , pedido do usuário: relógio monotônico pra detectar
 * manipulação manual do relógio de PAREDE entre dois toques do mesmo
 * aparelho, mesmo offline (ver `RegistrosJornadaService.create` no
 * backend, checagem "REGISTRO_REJEITADO_RELOGIO_MONOTONICO_DIVERGENTE").
 *
 * `SystemClock.elapsedRealtime()` conta milissegundos desde o último
 * boot do aparelho, INCLUINDO tempo em sleep/standby , e não pode ser
 * alterado pelo usuário de jeito nenhum (ao contrário de
 * `System.currentTimeMillis()`, que muda se a pessoa mexer na data/hora
 * do aparelho). Só "reseta" (volta a um valor menor) quando o aparelho
 * reinicia de verdade , o backend usa exatamente essa propriedade pra
 * saber quando NÃO dá pra comparar (ver checagem
 * `dto.elapsedRealtimeMs >= ultimo.elapsedRealtimeMs` lá).
 */
class RelogioMonotonicoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RelogioMonotonico")

    Function("getElapsedRealtimeMs") {
      SystemClock.elapsedRealtime().toDouble()
    }
  }
}
