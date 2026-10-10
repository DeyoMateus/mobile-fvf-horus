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

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ViewManager

class BloqueioTelaModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "BloqueioTela"

  @ReactMethod
  fun estaBloqueado(promise: Promise) {
    val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    promise.resolve(km.isKeyguardLocked)
  }

  // Rodada 195/196: alarme de verdade. Vibração e voz com USAGE_ALARM (não
  // silenciados no modo silencioso), em loop até o motorista dar ciente.
  @ReactMethod
  fun iniciarAlarme(recurso: String, padrao: ReadableArray, atrasoVozMs: Double) {
    val tempos = LongArray(padrao.size()) { padrao.getDouble(it).toLong() }
    AlarmeFvf.iniciar(ctx, recurso, tempos, atrasoVozMs.toLong())
  }

  @ReactMethod
  fun pararAlarme() {
    AlarmeFvf.parar()
    AlarmeFvf.limparAlertaAtivo(ctx)
    try {
      ctx.stopService(Intent(ctx, AlertaAlarmService::class.java))
    } catch (e: Exception) {
    }
  }

  // Agenda um alerta com AlarmManager.setAlarmClock: dispara no horário, com o
  // app fechado, e abre o alarme (serviço em primeiro plano + tela vermelha).
  // Fica gravado no aparelho e é reagendado ao reiniciar o celular.
  @ReactMethod
  fun agendarAlarme(
      id: String,
      quandoMs: Double,
      titulo: String,
      corpo: String,
      som: String,
      promise: Promise,
  ) {
    try {
      promise.resolve(AlarmeFvf.agendar(ctx, id, quandoMs.toLong(), titulo, corpo, som, true))
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun cancelarAlarme(id: String) {
    try {
      AlarmeFvf.cancelar(ctx, id)
    } catch (e: Exception) {
    }
    if (AlarmeFvf.lerAlertaAtivo(ctx)?.getString("id") == id) {
      pararAlarme()
    }
  }

  // Alerta que já disparou e ainda não teve "Ciente" (a tela vermelha lê isto).
  @ReactMethod
  fun alertaAtivo(promise: Promise) {
    promise.resolve(AlarmeFvf.lerAlertaAtivo(ctx))
  }

  @ReactMethod
  fun podeSobreporApps(promise: Promise) {
    promise.resolve(Settings.canDrawOverlays(ctx))
  }

  @ReactMethod
  fun abrirSobreporApps() {
    try {
      val i = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:" + ctx.packageName),
      )
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(i)
    } catch (e: Exception) {
    }
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

  @ReactMethod
  fun addListener(nome: String) {}

  @ReactMethod
  fun removeListeners(n: Double) {}

}

class BloqueioTelaPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext): List<NativeModule> =
      listOf(BloqueioTelaModule(c))

  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
`;

const ALARME_KT = `package ${PACOTE}

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject

// Vibração e voz do alerta como ALARME (USAGE_ALARM): tocam mesmo com o
// celular no modo silencioso, em loop até alguém chamar parar().
@Suppress("DEPRECATION")
object AlarmeFvf {
  private val handler = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var tocando = false

  private val atributosAlarme: AudioAttributes =
      AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()

  private fun vibrador(ctx: Context): Vibrator? =
      if (Build.VERSION.SDK_INT >= 31) {
        (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)
            ?.defaultVibrator
      } else {
        ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      }

  private fun tocarVoz(ctx: Context, resId: Int) {
    if (!tocando) return
    try {
      val afd = ctx.resources.openRawResourceFd(resId)
      val p = MediaPlayer()
      p.setAudioAttributes(atributosAlarme)
      p.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      afd.close()
      p.setOnPreparedListener { it.start() }
      p.setOnCompletionListener {
        it.release()
        if (player === it) player = null
        handler.postDelayed({ tocarVoz(ctx, resId) }, 2500)
      }
      p.setOnErrorListener { mp, _, _ ->
        mp.release()
        if (player === mp) player = null
        true
      }
      player = p
      p.prepareAsync()
    } catch (e: Exception) {
    }
  }

  @Synchronized
  fun iniciar(ctx: Context, recurso: String, padrao: LongArray, atrasoVozMs: Long) {
    parar()
    val app = ctx.applicationContext
    tocando = true
    try {
      val v = vibrador(app)
      vibradorAtual = v
      if (v != null && padrao.isNotEmpty()) {
        if (Build.VERSION.SDK_INT >= 26) {
          v.vibrate(VibrationEffect.createWaveform(padrao, 0), atributosAlarme)
        } else {
          v.vibrate(padrao, 0, atributosAlarme)
        }
      }
    } catch (e: Exception) {
    }
    val resId = app.resources.getIdentifier(recurso, "raw", app.packageName)
    if (resId != 0) {
      handler.postDelayed({ tocarVoz(app, resId) }, atrasoVozMs)
    }
  }

  @Synchronized
  fun parar() {
    tocando = false
    handler.removeCallbacksAndMessages(null)
    try {
      player?.release()
    } catch (e: Exception) {
    }
    player = null
    try {
      vibradorAtual?.cancel()
    } catch (e: Exception) {
    }
  }

  // Guardado só para poder cancelar a vibração em parar().
  private var vibradorAtual: Vibrator? = null

  // ---- Agenda persistente (sobrevive a reinício do celular) ----
  private fun prefsAgenda(ctx: Context) =
      ctx.applicationContext.getSharedPreferences("fvf_agenda", Context.MODE_PRIVATE)

  private fun pendingDoAlarme(ctx: Context, id: String, extras: Intent?): PendingIntent {
    val i = Intent(ctx, AlertaAlarmReceiver::class.java)
    i.action = "${PACOTE}.ALARME_FVF"
    i.data = Uri.parse("fvf://alarme/" + id)
    if (extras != null) i.putExtras(extras)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(ctx, id.hashCode(), i, flags)
  }

  fun agendar(
      ctx: Context, id: String, quandoMs: Long, titulo: String, corpo: String,
      som: String, persistir: Boolean,
  ): Boolean {
    val app = ctx.applicationContext
    val extras = Intent()
    extras.putExtra("id", id)
    extras.putExtra("titulo", titulo)
    extras.putExtra("corpo", corpo)
    extras.putExtra("som", som)
    extras.putExtra("quando", quandoMs)
    val pi = pendingDoAlarme(app, id, extras)
    val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val abrir = PendingIntent.getActivity(
        app, 0,
        app.packageManager.getLaunchIntentForPackage(app.packageName) ?: Intent(),
        PendingIntent.FLAG_IMMUTABLE)
    try {
      am.setAlarmClock(AlarmManager.AlarmClockInfo(quandoMs, abrir), pi)
    } catch (e: SecurityException) {
      // Sem a permissão de alarme exato: melhor esforço (pode atrasar).
      am.set(AlarmManager.RTC_WAKEUP, quandoMs, pi)
    }
    if (persistir) {
      limparVencidos(app)
      val j = JSONObject()
      j.put("q", quandoMs)
      j.put("t", titulo)
      j.put("c", corpo)
      j.put("s", som)
      prefsAgenda(app).edit().putString(id, j.toString()).apply()
    }
    return true
  }

  // Faxina: tira da agenda o que venceu há mais de 10 min (ex.: alarme perdido
  // porque o app foi forçado a parar). Roda a cada novo agendamento.
  private fun limparVencidos(app: Context) {
    val limite = System.currentTimeMillis() - 10 * 60_000L
    val p = prefsAgenda(app)
    for ((id, valor) in p.all) {
      try {
        if (JSONObject(valor as String).getLong("q") < limite) {
          p.edit().remove(id).apply()
        }
      } catch (e: Exception) {
        p.edit().remove(id).apply()
      }
    }
  }

  fun cancelar(ctx: Context, id: String) {
    val app = ctx.applicationContext
    val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(pendingDoAlarme(app, id, null))
    prefsAgenda(app).edit().remove(id).apply()
  }

  // Chamado quando o alarme dispara: já não precisa ser reagendado.
  fun removerAgendado(ctx: Context, id: String) {
    prefsAgenda(ctx).edit().remove(id).apply()
  }

  // Depois de reiniciar o celular (ou atualizar o app / mudar a hora): refaz
  // os alarmes gravados. Os que venceram há até 10 min tocam em 3 s.
  fun reagendarTodos(ctx: Context) {
    val app = ctx.applicationContext
    val agora = System.currentTimeMillis()
    val p = prefsAgenda(app)
    for ((id, valor) in p.all) {
      try {
        val j = JSONObject(valor as String)
        val q = j.getLong("q")
        val t = j.getString("t")
        val c = j.getString("c")
        val s = j.getString("s")
        if (q > agora) {
          agendar(app, id, q, t, c, s, false)
        } else if (agora - q < 10 * 60_000L) {
          agendar(app, id, agora + 3000, t, c, s, false)
        } else {
          p.edit().remove(id).apply()
        }
      } catch (e: Exception) {
        p.edit().remove(id).apply()
      }
    }
  }

  private fun prefs(ctx: Context) =
      ctx.applicationContext.getSharedPreferences("fvf_alarme", Context.MODE_PRIVATE)

  fun salvarAlertaAtivo(ctx: Context, id: String, titulo: String, corpo: String, som: String, quando: Long) {
    prefs(ctx).edit()
        .putString("id", id).putString("titulo", titulo).putString("corpo", corpo)
        .putString("som", som).putLong("quando", quando).apply()
  }

  fun limparAlertaAtivo(ctx: Context) {
    prefs(ctx).edit().clear().apply()
  }

  fun lerAlertaAtivo(ctx: Context): WritableMap? {
    val p = prefs(ctx)
    val id = p.getString("id", null) ?: return null
    val m = Arguments.createMap()
    m.putString("id", id)
    m.putString("titulo", p.getString("titulo", "") ?: "")
    m.putString("corpo", p.getString("corpo", "") ?: "")
    m.putString("som", p.getString("som", "generico") ?: "generico")
    m.putDouble("quando", p.getLong("quando", 0L).toDouble())
    return m
  }
}
`;

const RECEPTOR_KT = `package ${PACOTE}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

// Dispara no horário do alerta (AlarmManager.setAlarmClock), com o app
// fechado: guarda o alerta e liga o serviço de alarme em primeiro plano.
class AlertaAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    intent.getStringExtra("id")?.let { AlarmeFvf.removerAgendado(context, it) }
    val servico = Intent(context, AlertaAlarmService::class.java)
    servico.putExtras(intent)
    try {
      ContextCompat.startForegroundService(context, servico)
    } catch (e: Exception) {
    }
  }
}
`;

const BOOT_KT = `package ${PACOTE}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Reinício do celular, atualização do app, mudança de hora/fuso: os alarmes
// do sistema se perdem, então refaz os alertas de jornada gravados.
class AlertaBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      AlarmeFvf.reagendarTodos(context)
    } catch (e: Exception) {
    }
  }
}
`;

const SERVICO_KT = `package ${PACOTE}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings

// Serviço em primeiro plano do alarme: toca voz + vibração (USAGE_ALARM), mostra
// a notificação de tela cheia (celular bloqueado) e, se o app tem a permissão
// "Exibir sobre outros apps", abre a tela vermelha direto por cima de qualquer
// outro aplicativo (como uma chamada/despertador).
@Suppress("DEPRECATION")
class AlertaAlarmService : Service() {
  private var wake: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("id") ?: "alerta"
    val titulo = intent?.getStringExtra("titulo") ?: "Alerta de jornada"
    val corpo = intent?.getStringExtra("corpo") ?: ""
    val som = intent?.getStringExtra("som") ?: "generico"
    val quando = intent?.getLongExtra("quando", System.currentTimeMillis())
        ?: System.currentTimeMillis()

    AlarmeFvf.salvarAlertaAtivo(this, id, titulo, corpo, som, quando)

    val abrir = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    abrir.putExtra("notification", true)
    abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pi = PendingIntent.getActivity(
        this, 7, abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val canal = NotificationChannel(
          "fvf-alarme-ativo-v1", "Alarme de jornada", NotificationManager.IMPORTANCE_HIGH)
      canal.setSound(null, null)
      canal.enableVibration(false)
      canal.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      nm.createNotificationChannel(canal)
    }
    val b = if (Build.VERSION.SDK_INT >= 26)
      Notification.Builder(this, "fvf-alarme-ativo-v1")
    else
      Notification.Builder(this)
    b.setSmallIcon(applicationInfo.icon)
        .setContentTitle(titulo)
        .setContentText(corpo)
        .setStyle(Notification.BigTextStyle().bigText(corpo))
        .setCategory(Notification.CATEGORY_ALARM)
        .setOngoing(true)
        .setContentIntent(pi)
        .setFullScreenIntent(pi, true)
    val notificacao = b.build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(4242, notificacao, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(4242, notificacao)
    }

    try {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wake?.release()
      wake = pm.newWakeLock(
          PowerManager.PARTIAL_WAKE_LOCK, "fvf:alarme")
      wake?.acquire(3 * 60_000L)
    } catch (e: Exception) {
    }

    AlarmeFvf.iniciar(
        this, "alerta_" + som, longArrayOf(0, 800, 400, 800, 400, 800, 400, 800, 1500), 1500)

    // Com "Exibir sobre outros apps" liberado o Android deixa o app abrir a
    // tela por cima de qualquer coisa que o motorista esteja usando.
    try {
      if (Settings.canDrawOverlays(this)) {
        startActivity(abrir)
      }
    } catch (e: Exception) {
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    AlarmeFvf.parar()
    try {
      wake?.release()
    } catch (e: Exception) {
    }
    if (Build.VERSION.SDK_INT >= 24) {
      stopForeground(Service.STOP_FOREGROUND_REMOVE)
    } else {
      stopForeground(true)
    }
    super.onDestroy()
  }
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
    if (app) {
      app.receiver = app.receiver || [];
      if (!app.receiver.some((r) => r.$["android:name"] === ".AlertaAlarmReceiver")) {
        app.receiver.push({
          $: { "android:name": ".AlertaAlarmReceiver", "android:exported": "false" },
        });
      }
      if (!app.receiver.some((r) => r.$["android:name"] === ".AlertaBootReceiver")) {
        app.receiver.push({
          $: { "android:name": ".AlertaBootReceiver", "android:exported": "true" },
          "intent-filter": [
            {
              action: [
                { $: { "android:name": "android.intent.action.BOOT_COMPLETED" } },
                { $: { "android:name": "android.intent.action.MY_PACKAGE_REPLACED" } },
                { $: { "android:name": "android.intent.action.TIME_SET" } },
                { $: { "android:name": "android.intent.action.TIMEZONE_CHANGED" } },
              ],
            },
          ],
        });
      }
      app.service = app.service || [];
      if (!app.service.some((r) => r.$["android:name"] === ".AlertaAlarmService")) {
        app.service.push({
          $: {
            "android:name": ".AlertaAlarmService",
            "android:exported": "false",
            "android:foregroundServiceType": "mediaPlayback",
          },
        });
      }
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
      fs.writeFileSync(path.join(dir, "AlarmeFvf.kt"), ALARME_KT);
      fs.writeFileSync(path.join(dir, "AlertaAlarmReceiver.kt"), RECEPTOR_KT);
      fs.writeFileSync(path.join(dir, "AlertaAlarmService.kt"), SERVICO_KT);
      fs.writeFileSync(path.join(dir, "AlertaBootReceiver.kt"), BOOT_KT);
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
