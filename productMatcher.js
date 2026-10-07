/**
 * Módulo para Normalização e Unificação Inteligente de Produtos de Supermercado
 * (Fuzzy Matching, Remoção de Ruídos e Dicionário de Sinônimos/Abreviações)
 */

// Dicionário de Abreviações e Sinônimos comuns em Notas Fiscais
const DICIONARIO_ABREVIACOES = {
  'SABON': 'SABONETE',
  'SAB': 'SABONETE',
  'SABONETE': 'SABONETE',
  'REFRIG': 'REFRIGERANTE',
  'REFR': 'REFRIGERANTE',
  'REF': 'REFRIGERANTE',
  'DETERG': 'DETERGENTE',
  'DET': 'DETERGENTE',
  'LAVA LOUCAS': 'DETERGENTE',
  'LAV.LOU': 'DETERGENTE',
  'LIQ': 'LIQUIDO',
  'LIQ.': 'LIQUIDO',
  'LIQUIDO': 'LIQUIDO',
  'PAO FORMA': 'PAO DE FORMA',
  'P.FORMA': 'PAO DE FORMA',
  'PAO FRANC': 'PAO FRANCES',
  'PAO FRANCES': 'PAO FRANCES',
  'QJO': 'QUEIJO',
  'QUEIJ': 'QUEIJO',
  'QUEIJO': 'QUEIJO',
  'MUSS': 'MUSSARELA',
  'MUCL': 'MUSSARELA',
  'MUSSARELA': 'MUSSARELA',
  'PRES': 'PRESUNTO',
  'PRESNT': 'PRESUNTO',
  'PRESUNTO': 'PRESUNTO',
  'MARG': 'MARGARINA',
  'MARGAR': 'MARGARINA',
  'MARGARINA': 'MARGARINA',
  'DESINF': 'DESINFETANTE',
  'COND': 'CONDICIONADOR',
  'SHAMP': 'SHAMPOO',
  'HID': 'HIDRATACAO',
  'HIDR': 'HIDRATACAO',
  'HIDRAT': 'HIDRATACAO',
  'FAT': 'FATIADO',
  'FATIAD': 'FATIADO',
  'COZ': 'COZIDO',
  'INT': 'INTEGRAL',
  'INTEG': 'INTEGRAL',
  'INTEGRAL': 'INTEGRAL',
  'BCO': 'BRANCO',
  'PCT': 'PACOTE',
  'C/': 'COM',
  'C': 'COM'
};

// Limpeza de Unidades Estranhas da SEFAZ (ex: KG0001 -> KG, UN0001 -> UN)
function normalizarUnidade(unidadeRaw) {
  if (!unidadeRaw) return 'UN';
  const u = String(unidadeRaw).toUpperCase().trim();
  if (u.startsWith('KG')) return 'KG';
  if (u.startsWith('UN') || u.startsWith('UND')) return 'UN';
  if (u.startsWith('LT') || u.startsWith('L')) return 'L';
  if (u.startsWith('CX')) return 'CX';
  if (u.startsWith('PC') || u.startsWith('PCT')) return 'PCT';
  if (u.startsWith('DZ')) return 'DZ';
  if (u.startsWith('GR') || u.startsWith('G')) return 'G';
  if (u.startsWith('ML')) return 'ML';
  return u.replace(/\d+/g, '') || 'UN';
}

// Remove acentos e caracteres especiais
function removerAcentos(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

// Gera uma chave canônica de palavras-chave para agrupamento de produtos idênticos
function gerarChaveCanonica(nomeOriginal) {
  if (!nomeOriginal) return '';
  
  let texto = removerAcentos(nomeOriginal)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Substitui abreviações por palavras completas
  const palavras = texto.split(' ').filter(p => p.length > 0);
  const palavrasNormalizadas = palavras.map(p => DICIONARIO_ABREVIACOES[p] || p);

  // Ordena termos significativos para permitir correspondência independente da ordem
  return palavrasNormalizadas.join(' ');
}

// Calcula índice de similaridade (Jaccard entre conjuntos de palavras)
function calcularSimilaridade(nome1, nome2) {
  const chave1 = gerarChaveCanonica(nome1);
  const chave2 = gerarChaveCanonica(nome2);

  if (chave1 === chave2) return 1.0;

  const set1 = new Set(chave1.split(' ').filter(p => p.length > 1));
  const set2 = new Set(chave2.split(' ').filter(p => p.length > 1));

  if (set1.size === 0 || set2.size === 0) return 0;

  let intersecao = 0;
  for (const item of set1) {
    if (set2.has(item)) intersecao++;
  }

  const uniao = new Set([...set1, ...set2]).size;
  return intersecao / uniao;
}

// Encontra o melhor produto existente na base ou retorna null
function encontrarMelhorCorrespondencia(nomeNovo, listaProdutosExistentes, threshold = 0.65) {
  let melhorMatch = null;
  let maiorScore = 0;

  const chaveNova = gerarChaveCanonica(nomeNovo);

  for (const prod of listaProdutosExistentes) {
    const score = calcularSimilaridade(nomeNovo, prod.nome_padrao);
    if (score > maiorScore && score >= threshold) {
      maiorScore = score;
      melhorMatch = prod;
    }
  }

  return { produto: melhorMatch, score: maiorScore };
}

module.exports = {
  normalizarUnidade,
  gerarChaveCanonica,
  calcularSimilaridade,
  encontrarMelhorCorrespondencia
};
