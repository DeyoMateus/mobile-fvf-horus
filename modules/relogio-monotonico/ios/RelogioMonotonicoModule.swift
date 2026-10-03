import ExpoModulesCore
import Foundation

/**
 * Rodada 88 , equivalente iOS do `SystemClock.elapsedRealtime()`
 * (Android): `ProcessInfo.processInfo.systemUptime` devolve segundos
 * decorridos desde o último boot do aparelho, baseado no relógio
 * monotônico do sistema (mach absolute time) , NÃO é afetado se o
 * usuário mudar a data/hora manualmente nos Ajustes, só reinicia
 * contando do zero se o aparelho reiniciar de verdade. Convertido pra
 * milissegundos aqui pra bater com o valor usado no backend e no lado
 * Android.
 */
public class RelogioMonotonicoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RelogioMonotonico")

    Function("getElapsedRealtimeMs") { () -> Double in
      return ProcessInfo.processInfo.systemUptime * 1000
    }
  }
}
