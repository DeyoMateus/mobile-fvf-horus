// Config plugin (Expo): deixa a MainActivity abrir por cima da tela de
// bloqueio e acender a tela quando um alerta de tela cheia (full-screen
// intent) dispara com o celular bloqueado. Sem esses dois atributos o
// Android só mostra a notificação, não a tela do app.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withTelaSobreBloqueio(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const atividade = app?.activity?.find(
      (a) => a.$["android:name"] === ".MainActivity",
    );
    if (atividade) {
      atividade.$["android:showWhenLocked"] = "true";
      atividade.$["android:turnScreenOn"] = "true";
    }
    return cfg;
  });
};
