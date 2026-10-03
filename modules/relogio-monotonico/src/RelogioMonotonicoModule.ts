import { NativeModule, requireNativeModule } from "expo";

declare class RelogioMonotonicoModule extends NativeModule<{}> {
  /**
   * Milissegundos desde o último boot do aparelho (Android
   * `SystemClock.elapsedRealtime()` / iOS `ProcessInfo.systemUptime`) ,
   * ver comentário completo nos módulos nativos de cada plataforma.
   */
  getElapsedRealtimeMs(): number;
}

export default requireNativeModule<RelogioMonotonicoModule>(
  "RelogioMonotonico",
);
