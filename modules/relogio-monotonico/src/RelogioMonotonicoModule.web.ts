import { registerWebModule, NativeModule } from 'expo';

class RelogioMonotonicoModule extends NativeModule<{}> {
  getElapsedRealtimeMs(): number | null {
    return null;
  }
}

export default registerWebModule(RelogioMonotonicoModule, 'RelogioMonotonicoModule');
