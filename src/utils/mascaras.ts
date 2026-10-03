/**
 * Máscaras de digitação (Rodada 53, pedido do usuário) , funções puras,
 * sem dependência de UI, reaproveitadas pelos componentes de data e
 * pelos campos de CPF do app.
 */

/** "20260918" -> "20/09/2026" (enquanto digita, também funciona parcial: "2009" -> "20/09"). */
export function aplicarMascaraDataBr(textoDigitado: string): string {
  const digitos = textoDigitado.replace(/\D/g, "").slice(0, 8);
  const dia = digitos.slice(0, 2);
  const mes = digitos.slice(2, 4);
  const ano = digitos.slice(4, 8);
  if (digitos.length <= 2) return dia;
  if (digitos.length <= 4) return `${dia}/${mes}`;
  return `${dia}/${mes}/${ano}`;
}

/** "1430" -> "14:30". */
export function aplicarMascaraHora(textoDigitado: string): string {
  const digitos = textoDigitado.replace(/\D/g, "").slice(0, 4);
  const hora = digitos.slice(0, 2);
  const minuto = digitos.slice(2, 4);
  if (digitos.length <= 2) return hora;
  return `${hora}:${minuto}`;
}

/** "20260918" (dentro de "DD/MM/AAAA HH:MM") -> mascara combinada, usada pelo campo de data+hora. */
export function aplicarMascaraDataHoraBr(textoDigitado: string): string {
  const digitos = textoDigitado.replace(/\D/g, "").slice(0, 12);
  const dataDigitos = digitos.slice(0, 8);
  const horaDigitos = digitos.slice(8, 12);
  const dataMascarada = aplicarMascaraDataBr(dataDigitos);
  if (!horaDigitos) return dataMascarada;
  const horaMascarada = aplicarMascaraHora(horaDigitos);
  return `${dataMascarada} ${horaMascarada}`;
}

/** "DD/MM/AAAA" completo e válido -> "AAAA-MM-DD"; incompleto/inválido -> null (não propaga pro estado ISO ainda). */
export function dataBrParaIso(dataBr: string): string | null {
  const m = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const data = new Date(Number(ano), Number(mes) - 1, Number(dia));
  const valida =
    data.getFullYear() === Number(ano) &&
    data.getMonth() === Number(mes) - 1 &&
    data.getDate() === Number(dia);
  if (!valida) return null;
  return `${ano}-${mes}-${dia}`;
}

/** "AAAA-MM-DD" -> "DD/MM/AAAA"; vazio/inválido -> ''. */
export function dataIsoParaBr(dataIso: string): string {
  const m = dataIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, ano, mes, dia] = m;
  return `${dia}/${mes}/${ano}`;
}

/** "AAAA-MM-DD" -> Date local (meio-dia, pra evitar problema de fuso horário virando o dia); inválido -> null. */
export function dataIsoParaDate(dataIso: string): Date | null {
  const m = dataIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  return new Date(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0);
}

/** Date -> "AAAA-MM-DD", usando os componentes locais do aparelho (não UTC , evita a data "voltar" um dia). */
export function dateParaDataIso(data: Date): string {
  const ano = data.getFullYear().toString().padStart(4, "0");
  const mes = (data.getMonth() + 1).toString().padStart(2, "0");
  const dia = data.getDate().toString().padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** "12345678901" -> "123.456.789-01" (também funciona parcial, conforme a pessoa digita). */
export function aplicarMascaraCpf(textoDigitado: string): string {
  const digitos = textoDigitado.replace(/\D/g, "").slice(0, 11);
  const p1 = digitos.slice(0, 3);
  const p2 = digitos.slice(3, 6);
  const p3 = digitos.slice(6, 9);
  const p4 = digitos.slice(9, 11);
  if (digitos.length <= 3) return p1;
  if (digitos.length <= 6) return `${p1}.${p2}`;
  if (digitos.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

/** Tira tudo que não for dígito , usado pra guardar o CPF "cru" (o que a API espera), independente da máscara exibida. */
export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}
