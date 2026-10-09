// Config plugin (Expo): copia os mp3 falados dos alertas
// (assets/sons/alerta_<id>.mp3) para res/raw do Android, de onde os
// canais de notificação os usam como som. Falha cedo, com mensagem
// clara, se os áudios ainda não foram gerados.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

module.exports = function withSonsDeAlerta(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const raiz = cfg.modRequest.projectRoot;
      const origem = path.join(raiz, "assets", "sons");
      const { frases } = JSON.parse(
        fs.readFileSync(path.join(origem, "frases.json"), "utf8"),
      );
      const faltando = Object.keys(frases).filter(
        (id) => !fs.existsSync(path.join(origem, `alerta_${id}.mp3`)),
      );
      if (faltando.length) {
        throw new Error(
          `Áudios dos alertas ausentes (${faltando.join(", ")}). ` +
            `Rode: node scripts/gerar-audios-alertas.js (veja o cabeçalho do script).`,
        );
      }
      const destino = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "raw",
      );
      fs.mkdirSync(destino, { recursive: true });
      for (const id of Object.keys(frases)) {
        fs.copyFileSync(
          path.join(origem, `alerta_${id}.mp3`),
          path.join(destino, `alerta_${id}.mp3`),
        );
      }
      return cfg;
    },
  ]);
};
