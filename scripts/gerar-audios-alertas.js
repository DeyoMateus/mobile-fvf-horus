#!/usr/bin/env node
/**
 * Gera UMA vez os áudios falados dos alertas (ElevenLabs) e salva em
 * assets/sons/alerta_<id>.mp3. Os mp3 vão dentro do app (funcionam sem
 * internet); a chave NUNCA vai para o app nem para o repositório.
 *
 * Uso (Git Bash, na pasta mobile):
 *   export ELEVENLABS_API_KEY="sua_chave"     # só neste terminal
 *   node scripts/gerar-audios-alertas.js            # gera só os que faltam
 *   node scripts/gerar-audios-alertas.js --force    # regera todos
 * Gasta ~900 caracteres do plano (gratuito: 10.000/mês).
 * Depois de gerar, REVOGUE/rotacione a chave no painel do ElevenLabs.
 */
const fs = require("fs");
const path = require("path");

const pasta = path.join(__dirname, "..", "assets", "sons");
const { voz, frases } = JSON.parse(
  fs.readFileSync(path.join(pasta, "frases.json"), "utf8"),
);
const chave = process.env.ELEVENLABS_API_KEY;
const forcar = process.argv.includes("--force");

if (!chave) {
  console.error('Defina a chave: export ELEVENLABS_API_KEY="..."');
  process.exit(1);
}

async function gerar(id, texto) {
  const destino = path.join(pasta, `alerta_${id}.mp3`);
  if (!forcar && fs.existsSync(destino)) {
    console.log(`= ${id}: já existe, pulando`);
    return;
  }
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": chave,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: texto,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.55, similarity_boost: 0.75 },
      }),
    },
  );
  if (!r.ok) {
    throw new Error(`${id}: HTTP ${r.status} ${await r.text()}`);
  }
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  console.log(`✔ ${id} (${texto.length} caracteres)`);
}

(async () => {
  for (const [id, texto] of Object.entries(frases)) await gerar(id, texto);
  console.log("Pronto. Agora revogue a chave no ElevenLabs.");
})().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});
