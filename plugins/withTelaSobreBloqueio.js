// Config plugin (Expo): alerta de tela cheia sobre a tela de bloqueio SÓ
// quando o app foi aberto por um alerta (full-screen intent da
// notificação). Rodada 179: antes, showWhenLocked/turnScreenOn ficavam
// fixos no manifesto e o app (inclusive a tela de PIN) abria por cima do
// bloqueio sempre. Agora:
//  - o manifesto NÃO tem showWhenLocked/turnScreenOn;
//  - a MainActivity liga os dois só se a intent veio de um alerta
//    (extra "notification" do notify-kit) E o aparelho está bloqueado;
//  - desliga ao apagar a tela ou ao desbloquear;
//  - módulo nativo BloqueioTela: estaBloqueado() e voltarParaBloqueio(),
//    usados pelo JS ao tocar em "Ciente" e como rede de segurança.
const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require("expo/config-plugins");

const PACOTE = "com.fvfhorus.motorista";

const MODULO_KT = `package ${PACOTE}

import android.app.KeyguardManager
import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class BloqueioTelaModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "BloqueioTela"

  @ReactMethod
  fun estaBloqueado(promise: Promise) {
    val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    promise.resolve(km.isKeyguardLocked)
  }

  @ReactMethod
  fun voltarParaBloqueio() {
    val act = ctx.currentActivity ?: return
    act.runOnUiThread {
      act.setShowWhenLocked(false)
      act.setTurnScreenOn(false)
      act.moveTaskToBack(true)
    }
  }
}

class BloqueioTelaPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext): List<NativeModule> =
      listOf(BloqueioTelaModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
`;

const METODOS_ACTIVITY = `
  private var receptorBloqueio: android.content.BroadcastReceiver? = null

  private fun ajustarSobreBloqueio(i: android.content.Intent?) {
    val km = getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
    val deAlerta = i?.hasExtra("notification") == true
    val permitir = deAlerta && km.isKeyguardLocked
    setShowWhenLocked(permitir)
    setTurnScreenOn(permitir)
  }

  private fun registrarReceptorBloqueio() {
    val r = object : android.content.BroadcastReceiver() {
      override fun onReceive(c: android.content.Context?, i: android.content.Intent?) {
        setShowWhenLocked(false)
        setTurnScreenOn(false)
      }
    }
    receptorBloqueio = r
    val f = android.content.IntentFilter()
    f.addAction(android.content.Intent.ACTION_SCREEN_OFF)
    f.addAction(android.content.Intent.ACTION_USER_PRESENT)
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      registerReceiver(r, f, android.content.Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(r, f)
    }
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    ajustarSobreBloqueio(intent)
  }

  override fun onDestroy() {
    try {
      receptorBloqueio?.let { unregisterReceiver(it) }
    } catch (e: Exception) {
    }
    super.onDestroy()
  }
`;

module.exports = function withTelaSobreBloqueio(config) {
  // 1) Manifesto sem showWhenLocked/turnScreenOn.
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const atividade = app?.activity?.find(
      (a) => a.$["android:name"] === ".MainActivity",
    );
    if (atividade) {
      delete atividade.$["android:showWhenLocked"];
      delete atividade.$["android:turnScreenOn"];
    }
    return cfg;
  });

  // 2) Arquivos Kotlin do módulo nativo.
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...PACOTE.split("."),
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "BloqueioTelaModule.kt"), MODULO_KT);
      return cfg;
    },
  ]);

  // 3) MainActivity: liga o "sobre o bloqueio" só para alerta.
  config = withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("ajustarSobreBloqueio")) {
      if (!/super\.onCreate\(/.test(src)) {
        throw new Error("withTelaSobreBloqueio: super.onCreate não encontrado na MainActivity.");
      }
      src = src.replace(
        /super\.onCreate\([^)]*\)/,
        (m) => `${m}\n    ajustarSobreBloqueio(intent)\n    registrarReceptorBloqueio()`,
      );
      const i = src.lastIndexOf("}");
      src = src.slice(0, i) + METODOS_ACTIVITY + src.slice(i);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  // 4) Registra o pacote nativo (não derruba o build se o padrão mudar).
  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("BloqueioTelaPackage")) {
      const novo = src.replace(
        /(PackageList\(this\)\.packages\.apply \{)/,
        "$1\n          add(BloqueioTelaPackage())",
      );
      if (novo === src) {
        console.warn(
          "withTelaSobreBloqueio: não achei PackageList(...).packages.apply na MainApplication; pacote BloqueioTela não registrado (o JS ignora a falta do módulo).",
        );
      }
      src = novo;
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};
