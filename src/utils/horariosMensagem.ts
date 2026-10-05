/**
 * Rodada 148 , mensagens de alerta trazem a hora como marcador `[[t:ISO]]`
 * (o servidor não sabe em que fuso o motorista está agora). Aqui vira a hora
 * do fuso do próprio aparelho: 07h em Brasília aparece 06h para quem está em
 * Cuiabá.
 */
export function renderizarHorarios(texto: string): string {
  return texto.replace(
    /\[\[t:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\]/g,
    (_m, iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const p = (n: number) => String(n).padStart(2, "0");
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
  );
}
