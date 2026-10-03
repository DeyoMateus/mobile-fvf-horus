// Lista de países pro seletor de telefone (Rodada 41) , o usuário
// escolhe o país (bandeira + código de discagem) e digita só o DDD +
// número; o valor final enviado ao backend é sempre a concatenação em
// formato E.164 ("+<código><resto>"). Não é uma lista exaustiva dos
// ~195 países do mundo , cobre o Brasil (primeiro/padrão, é o público
// principal do sistema) e os países mais prováveis de aparecer num
// cadastro de transporte rodoviário/logística (Mercosul, resto das
// Américas, principais parceiros comerciais). Adicionar um país novo é
// só acrescentar uma linha aqui.
export interface PaisTelefone {
  nome: string;
  sigla: string;
  codigo: string; // com "+", ex.: "+55"
  bandeira: string; // emoji
}

export const PAISES_TELEFONE: PaisTelefone[] = [
  { nome: "Brasil", sigla: "BR", codigo: "+55", bandeira: "🇧🇷" },
  { nome: "Argentina", sigla: "AR", codigo: "+54", bandeira: "🇦🇷" },
  { nome: "Bolívia", sigla: "BO", codigo: "+591", bandeira: "🇧🇴" },
  { nome: "Chile", sigla: "CL", codigo: "+56", bandeira: "🇨🇱" },
  { nome: "Colômbia", sigla: "CO", codigo: "+57", bandeira: "🇨🇴" },
  { nome: "Equador", sigla: "EC", codigo: "+593", bandeira: "🇪🇨" },
  { nome: "Paraguai", sigla: "PY", codigo: "+595", bandeira: "🇵🇾" },
  { nome: "Peru", sigla: "PE", codigo: "+51", bandeira: "🇵🇪" },
  { nome: "Uruguai", sigla: "UY", codigo: "+598", bandeira: "🇺🇾" },
  { nome: "Venezuela", sigla: "VE", codigo: "+58", bandeira: "🇻🇪" },
  { nome: "Estados Unidos", sigla: "US", codigo: "+1", bandeira: "🇺🇸" },
  { nome: "Canadá", sigla: "CA", codigo: "+1", bandeira: "🇨🇦" },
  { nome: "México", sigla: "MX", codigo: "+52", bandeira: "🇲🇽" },
  { nome: "Portugal", sigla: "PT", codigo: "+351", bandeira: "🇵🇹" },
  { nome: "Espanha", sigla: "ES", codigo: "+34", bandeira: "🇪🇸" },
  { nome: "Itália", sigla: "IT", codigo: "+39", bandeira: "🇮🇹" },
  { nome: "França", sigla: "FR", codigo: "+33", bandeira: "🇫🇷" },
  { nome: "Alemanha", sigla: "DE", codigo: "+49", bandeira: "🇩🇪" },
  { nome: "Reino Unido", sigla: "GB", codigo: "+44", bandeira: "🇬🇧" },
  { nome: "China", sigla: "CN", codigo: "+86", bandeira: "🇨🇳" },
  { nome: "Japão", sigla: "JP", codigo: "+81", bandeira: "🇯🇵" },
];

export const PAIS_PADRAO = PAISES_TELEFONE[0]; // Brasil

/**
 * Tenta identificar o país e o número local a partir de um valor E.164
 * já salvo (ex.: "+5511999998888" → { pais: Brasil, numeroLocal:
 * "11999998888" }) , usado pra preencher o formulário na edição.
 * Quando nada bate (número antigo salvo fora do padrão, ou vazio),
 * cai no país padrão com o número local vazio.
 */
export function separarTelefone(valorE164: string | null | undefined): {
  pais: PaisTelefone;
  numeroLocal: string;
} {
  if (!valorE164 || !valorE164.startsWith("+")) {
    return { pais: PAIS_PADRAO, numeroLocal: "" };
  }
  // Ordena os códigos do mais longo pro mais curto antes de comparar,
  // pra "+1" não "roubar" um número que na verdade começa com "+591".
  const candidatos = [...PAISES_TELEFONE].sort(
    (a, b) => b.codigo.length - a.codigo.length,
  );
  for (const pais of candidatos) {
    if (valorE164.startsWith(pais.codigo)) {
      return { pais, numeroLocal: valorE164.slice(pais.codigo.length) };
    }
  }
  return { pais: PAIS_PADRAO, numeroLocal: valorE164.slice(1) };
}

export function montarTelefone(
  codigoPais: string,
  numeroLocal: string,
): string {
  const digitos = numeroLocal.replace(/\D/g, "");
  return digitos ? `${codigoPais}${digitos}` : "";
}
