/**
 * Módulo para detecção de Packs, Fardos, Caixas e Cálculo de Preço Unitário Fracionado e Normalizado
 */

function analisarProdutoEPack(nomeOriginal, quantidade = 1, valorUnitario = 0, valorTotal = 0) {
  const nome = (nomeOriginal || '').toUpperCase().trim();
  const vUnit = parseFloat(valorUnitario) || 0;
  
  let infoPack = {
    ehPack: false,
    quantidadeItensNoPack: 1,
    volumePorItem: null,
    unidadeMedida: null,
    precoPorUnidadeFracionada: vUnit,
    precoPorMedidaPadrao: null, // R$/Kg ou R$/L
    descricaoResumidaPack: null
  };

  if (vUnit <= 0) return infoPack;

  // Padrão 1: "6X500ML", "12X350ML", "4X90G", "6X 1L", "3X80G"
  const regexNxMedida = /(\d+)\s*[X\*]\s*([\d.,]+)?\s*(ML|G|KG|L|UN|FOLHAS|M|ROLOS|CAPS)?/i;
  // Padrão 2: "500ML X 6", "350ML X 12 UN", "500ML X 6 UN"
  const regexMedidaXn = /([\d.,]+)\s*(ML|G|KG|L)\s*[X\*]\s*(\d+)\s*(?:UN|UND|PCS)?/i;
  // Padrão 3: "COM 6UN", "COM 6 UNIDADES 500ML", "C/ 6 UNIDADES", "C/ 20", "KIT COM 6UN", "PACK C/ 12"
  const regexComQtd = /(?:KIT|PACK|FARDO|PCT|CX|CAIXA|COMBO|CBO)?\s*(?:COM|C\/|C\b)\s*(\d+)\s*(?:UNIDADES|UNIDADE|UND|UN|PCS|ROLOS|CAPS)?(?:\s*(?:DE\s*)?([\d.,]+)\s*(ML|G|KG|L))?/i;
  // Padrão 4: "LEVE 6 PAGUE 5", "LV6 PG5", "LV 4 PG 3"
  const regexLevePague = /(?:LEVE|LV)\s*(\d+)\s*(?:PAGUE|PG)\s*(\d+)(?:\s*(?:DE\s*)?([\d.,]+)\s*(ML|G|KG|L))?/i;

  let matchMXn = nome.match(regexMedidaXn);
  let matchNxM = nome.match(regexNxMedida);
  let matchCom = nome.match(regexComQtd);
  let matchLvPg = nome.match(regexLevePague);

  if (matchMXn && parseInt(matchMXn[3]) > 1 && parseInt(matchMXn[3]) <= 60) {
    const qtdPack = parseInt(matchMXn[3]);
    const volume = parseFloat(matchMXn[1].replace(',', '.'));
    const unidade = matchMXn[2].toUpperCase();

    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdPack;
    infoPack.volumePorItem = volume;
    infoPack.unidadeMedida = unidade;
    infoPack.precoPorUnidadeFracionada = Number((vUnit / qtdPack).toFixed(2));
  } else if (matchNxM && parseInt(matchNxM[1]) > 1 && parseInt(matchNxM[1]) <= 60) {
    const qtdPack = parseInt(matchNxM[1]);
    const volume = matchNxM[2] ? parseFloat(matchNxM[2].replace(',', '.')) : null;
    const unidade = matchNxM[3] ? matchNxM[3].toUpperCase() : 'UN';

    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdPack;
    infoPack.volumePorItem = volume;
    infoPack.unidadeMedida = unidade;
    infoPack.precoPorUnidadeFracionada = Number((vUnit / qtdPack).toFixed(2));
  } else if (matchCom && parseInt(matchCom[1]) > 1 && parseInt(matchCom[1]) <= 60) {
    const qtdPack = parseInt(matchCom[1]);
    const volume = matchCom[2] ? parseFloat(matchCom[2].replace(',', '.')) : null;
    const unidade = matchCom[3] ? matchCom[3].toUpperCase() : 'UN';

    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdPack;
    infoPack.volumePorItem = volume;
    infoPack.unidadeMedida = unidade;
    infoPack.precoPorUnidadeFracionada = Number((vUnit / qtdPack).toFixed(2));
  } else if (matchLvPg) {
    const qtdTotal = parseInt(matchLvPg[1]);
    const volume = matchLvPg[3] ? parseFloat(matchLvPg[3].replace(',', '.')) : null;
    const unidade = matchLvPg[4] ? matchLvPg[4].toUpperCase() : 'UN';

    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdTotal;
    infoPack.volumePorItem = volume;
    infoPack.unidadeMedida = unidade;
    infoPack.precoPorUnidadeFracionada = Number((vUnit / qtdTotal).toFixed(2));
  }

  // Tenta extrair peso/volume do nome caso o produto seja pack mas o regex do pack não capturou o volume
  if (infoPack.ehPack && !infoPack.volumePorItem) {
    const matchVol = nome.match(/(\d+(?:[.,]\d+)?)\s*(ML|G|KG|L)\b/i);
    if (matchVol) {
      infoPack.volumePorItem = parseFloat(matchVol[1].replace(',', '.'));
      infoPack.unidadeMedida = matchVol[2].toUpperCase();
    }
  }

  if (infoPack.ehPack) {
    if (infoPack.volumePorItem && (infoPack.unidadeMedida === 'ML' || infoPack.unidadeMedida === 'L')) {
      const volumeEmLitros = infoPack.unidadeMedida === 'ML' ? (infoPack.volumePorItem / 1000) : infoPack.volumePorItem;
      const precoPorLitro = (infoPack.precoPorUnidadeFracionada / volumeEmLitros);
      infoPack.precoPorMedidaPadrao = `R$ ${precoPorLitro.toFixed(2).replace('.', ',')}/L`;
    } else if (infoPack.volumePorItem && (infoPack.unidadeMedida === 'G' || infoPack.unidadeMedida === 'KG')) {
      const pesoEmKg = infoPack.unidadeMedida === 'G' ? (infoPack.volumePorItem / 1000) : infoPack.volumePorItem;
      const precoPorKg = (infoPack.precoPorUnidadeFracionada / pesoEmKg);
      infoPack.precoPorMedidaPadrao = `R$ ${precoPorKg.toFixed(2).replace('.', ',')}/kg`;
    }

    infoPack.descricaoResumidaPack = `📦 Pack com ${infoPack.quantidadeItensNoPack} un (${infoPack.volumePorItem ? `${infoPack.volumePorItem}${infoPack.unidadeMedida}` : 'un'}) → R$ ${infoPack.precoPorUnidadeFracionada.toFixed(2).replace('.', ',')} / un`;
  }

  return infoPack;
}

/**
 * Normaliza o preço para uma base comparável (R$/kg, R$/L ou R$/un)
 */
function extrairMedidaEPrecoNormalizado(nomeOriginal, unidadeOriginal = 'UN', valorUnitario = 0) {
  const preco = parseFloat(valorUnitario) || 0;
  const nome = (nomeOriginal || '').toUpperCase().trim();
  const un = (unidadeOriginal || 'UN').toUpperCase().trim();

  let resultado = {
    tipoMedida: 'UN', // 'KG', 'L', 'UN'
    quantidadeMedida: 1.0,
    unidadeExibicao: un || 'UN',
    precoNormalizado: preco, // Valor em R$/kg, R$/L ou R$/un
    textoNormalizado: null, // Ex: "R$ 86,53/kg"
    ehPack: false,
    qtdPack: 1,
    precoFracionado: preco
  };

  if (preco <= 0) return resultado;

  // 1. Verifica se é Pack / Combo
  const packInfo = analisarProdutoEPack(nome, 1, preco, preco);
  if (packInfo.ehPack) {
    resultado.ehPack = true;
    resultado.qtdPack = packInfo.quantidadeItensNoPack;
    resultado.precoFracionado = packInfo.precoPorUnidadeFracionada;

    if (packInfo.volumePorItem && (packInfo.unidadeMedida === 'ML' || packInfo.unidadeMedida === 'L')) {
      const volItemL = packInfo.unidadeMedida === 'ML' ? (packInfo.volumePorItem / 1000) : packInfo.volumePorItem;
      const volTotalL = volItemL * packInfo.quantidadeItensNoPack;
      resultado.tipoMedida = 'L';
      resultado.quantidadeMedida = volTotalL;
      resultado.unidadeExibicao = 'L';
      resultado.precoNormalizado = volTotalL > 0 ? Number((preco / volTotalL).toFixed(2)) : preco;
      resultado.textoNormalizado = `R$ ${resultado.precoNormalizado.toFixed(2).replace('.', ',')}/L`;
      return resultado;
    }

    if (packInfo.volumePorItem && (packInfo.unidadeMedida === 'G' || packInfo.unidadeMedida === 'KG')) {
      const pesoItemKg = packInfo.unidadeMedida === 'G' ? (packInfo.volumePorItem / 1000) : packInfo.volumePorItem;
      const pesoTotalKg = pesoItemKg * packInfo.quantidadeItensNoPack;
      resultado.tipoMedida = 'KG';
      resultado.quantidadeMedida = pesoTotalKg;
      resultado.unidadeExibicao = 'kg';
      resultado.precoNormalizado = pesoTotalKg > 0 ? Number((preco / pesoTotalKg).toFixed(2)) : preco;
      resultado.textoNormalizado = `R$ ${resultado.precoNormalizado.toFixed(2).replace('.', ',')}/kg`;
      return resultado;
    }

    resultado.tipoMedida = 'UN';
    resultado.quantidadeMedida = packInfo.quantidadeItensNoPack;
    resultado.unidadeExibicao = 'un';
    resultado.precoNormalizado = packInfo.precoPorUnidadeFracionada;
    resultado.textoNormalizado = `R$ ${packInfo.precoPorUnidadeFracionada.toFixed(2).replace('.', ',')}/un`;
    return resultado;
  }

  // 2. Se a unidade já é KG ou L no cadastro oficial da NFC-e ou venda por quilo/litro
  if (un === 'KG' || /\b(?:KG|QUILO|KILO)\b/i.test(un) || /(?:^|\s)(?:POR\s+)?(?:QUILO|KILO|KG)(?:\s|\.|$)/i.test(nome)) {
    resultado.tipoMedida = 'KG';
    resultado.quantidadeMedida = 1.0;
    resultado.unidadeExibicao = 'kg';
    resultado.precoNormalizado = preco;
    resultado.textoNormalizado = `R$ ${preco.toFixed(2).replace('.', ',')}/kg`;
    return resultado;
  }

  if (un === 'L' || un === 'LT' || un === 'LTS' || /\b(?:LITRO|LITROS)\b/i.test(un) || /(?:^|\s)(?:POR\s+)?(?:LITRO|LITROS)(?:\s|\.|$)/i.test(nome)) {
    resultado.tipoMedida = 'L';
    resultado.quantidadeMedida = 1.0;
    resultado.unidadeExibicao = 'L';
    resultado.precoNormalizado = preco;
    resultado.textoNormalizado = `R$ ${preco.toFixed(2).replace('.', ',')}/L`;
    return resultado;
  }

  // 3. Extração por Regex no nome do produto
  // Peso em KG (ex: 5KG, 1KG, 1.5KG, 2,5 KG)
  const regexKg = /(?:^|\s|\()(\d+(?:[.,]\d+)?)\s*(?:KG|KGS|QUILOS?|KILOS?)(?:\s|\)|\.|$)/i;
  // Peso em Gramas (ex: 150G, 400G, 500G, 80G, 90 GR, 200GR, 170G)
  const regexG = /(?:^|\s|\()(\d+(?:[.,]\d+)?)\s*(?:G|GR|GRS|GRAMAS)(?:\s|\)|\.|$)/i;
  // Volume em Litros (ex: 1L, 2L, 1.5L, 5L, 1,5 LTS)
  const regexL = /(?:^|\s|\()(\d+(?:[.,]\d+)?)\s*(?:L|LT|LTS|LITROS?)(?:\s|\)|\.|$)/i;
  // Volume em ML (ex: 500ML, 350ML, 900ML, 200 ML)
  const regexMl = /(?:^|\s|\()(\d+(?:[.,]\d+)?)\s*(?:ML|MLS|MILILITROS?)(?:\s|\)|\.|$)/i;

  const matchKg = nome.match(regexKg);
  if (matchKg) {
    const peso = parseFloat(matchKg[1].replace(',', '.'));
    if (peso > 0 && peso <= 100) {
      resultado.tipoMedida = 'KG';
      resultado.quantidadeMedida = peso;
      resultado.unidadeExibicao = 'kg';
      resultado.precoNormalizado = Number((preco / peso).toFixed(2));
      resultado.textoNormalizado = `R$ ${resultado.precoNormalizado.toFixed(2).replace('.', ',')}/kg`;
      return resultado;
    }
  }

  const matchG = nome.match(regexG);
  if (matchG) {
    const gramas = parseFloat(matchG[1].replace(',', '.'));
    if (gramas > 0 && gramas <= 50000) {
      const pesoKg = gramas / 1000;
      resultado.tipoMedida = 'KG';
      resultado.quantidadeMedida = pesoKg;
      resultado.unidadeExibicao = 'kg';
      resultado.precoNormalizado = Number((preco / pesoKg).toFixed(2));
      resultado.textoNormalizado = `R$ ${resultado.precoNormalizado.toFixed(2).replace('.', ',')}/kg`;
      return resultado;
    }
  }

  const matchL = nome.match(regexL);
  if (matchL) {
    const litros = parseFloat(matchL[1].replace(',', '.'));
    if (litros > 0 && litros <= 100) {
      resultado.tipoMedida = 'L';
      resultado.quantidadeMedida = litros;
      resultado.unidadeExibicao = 'L';
      resultado.precoNormalizado = Number((preco / litros).toFixed(2));
      resultado.textoNormalizado = `R$ ${resultado.precoNormalizado.toFixed(2).replace('.', ',')}/L`;
      return resultado;
    }
  }

  const matchMl = nome.match(regexMl);
  if (matchMl) {
    const ml = parseFloat(matchMl[1].replace(',', '.'));
    if (ml > 0 && ml <= 50000) {
      const volL = ml / 1000;
      resultado.tipoMedida = 'L';
      resultado.quantidadeMedida = volL;
      resultado.unidadeExibicao = 'L';
      resultado.precoNormalizado = Number((preco / volL).toFixed(2));
      resultado.textoNormalizado = `R$ ${resultado.precoNormalizado.toFixed(2).replace('.', ',')}/L`;
      return resultado;
    }
  }

  return resultado;
}

/**
 * Verifica se um produto se enquadra em tamanho de consumo doméstico ou atacado/industrial
 */
function classificarTamanhoDomestico(nomeProduto, tipoMedida, quantidadeMedida) {
  const nome = (nomeProduto || '').toUpperCase();

  // Termos industriais/foodservice explícitos
  if (/\b(?:BALDE|FOOD\s*SERVICE|INSTITUCIONAL|INDUSTRIAL|SACO\s*25KG|BARRA\s*10KG|BAG\s*IN\s*BOX)\b/i.test(nome)) {
    return false;
  }

  // Margarinas, Manteigas, Requeijão, Cremes: limite doméstico é 1.2kg (baldes de 14kg, 10kg, 5kg são industriais)
  if (/MARGARINA|MANTEIGA|REQUEIJAO|CREME DE LEITE|LEITE CONDENSADO/i.test(nome)) {
    if (tipoMedida === 'KG' && quantidadeMedida > 1.2) return false;
  }

  // Detergentes de louça comuns: limite doméstico unitário é 1.5L
  if (/DETERGENTE/i.test(nome) && !/LAVA\s*ROUPAS|ROUPA/i.test(nome)) {
    if (tipoMedida === 'L' && quantidadeMedida > 2.0 && !/PACK|KIT/i.test(nome)) return false;
  }

  // Sabonetes em barra: limite doméstico é 300g por barra
  if (/SABONETE/i.test(nome) && !/LIQUIDO/i.test(nome)) {
    if (tipoMedida === 'KG' && quantidadeMedida > 0.4 && !/PACK|KIT/i.test(nome)) return false;
  }

  // Queijo mussarela / prato fatiado ou pedaço: limite doméstico é 1.5kg
  if (/QUEIJO|MUSSARELA|MOZZARELLA|PRATO/i.test(nome)) {
    if (tipoMedida === 'KG' && quantidadeMedida > 2.0) return false;
  }

  // Geral: qualquer produto individual com mais de 5kg ou 5L que não seja arroz/feijão/açúcar/sabão em pó
  if (!/ARROZ|FEIJAO|ACUCAR|SABAO\s*EM\s*PO|LAVA\s*ROUPAS|AMACIANTE/i.test(nome)) {
    if ((tipoMedida === 'KG' || tipoMedida === 'L') && quantidadeMedida > 3.0) return false;
  }

  return true;
}

module.exports = {
  analisarProdutoEPack,
  extrairMedidaEPrecoNormalizado,
  classificarTamanhoDomestico
};

