/**
 * Módulo para detecção de Packs, Fardos, Caixas e Cálculo de Preço Unitário Fracionado
 */

function analisarProdutoEPack(nomeOriginal, quantidade, valorUnitario, valorTotal) {
  const nome = (nomeOriginal || '').toUpperCase().trim();
  
  let infoPack = {
    ehPack: false,
    quantidadeItensNoPack: 1,
    volumePorItem: null,
    unidadeMedida: null,
    precoPorUnidadeFracionada: valorUnitario,
    precoPorMedidaPadrao: null, // R$/Kg ou R$/L
    descricaoResumidaPack: null
  };

  // Padrão 1: "6X500ML", "12X350ML", "4X90G", "6X 1L", "3X80G"
  const regexNxMedida = /(\d+)\s*[X\*]\s*([\d.,]+)?\s*(ML|G|KG|L|UN|FOLHAS|M|ROLOS|CAPS)?/i;
  // Padrão 2: "PCT C/ 6", "CX C/ 12", "C/ 6 UN", "FARDO C/ 12"
  const regexComQtd = /(?:PCT|CX|FARDO|CBO|KIT|PROMO|PACK)?\s*C\/?\s*(\d+)\s*(?:UN|UND|PCS)?/i;
  // Padrão 3: "LEVE 6 PAGUE 5", "LV6 PG5", "LV 4 PG 3"
  const regexLevePague = /(?:LEVE|LV)\s*(\d+)\s*(?:PAGUE|PG)\s*(\d+)/i;

  let matchPack = nome.match(regexNxMedida);
  let matchCom = nome.match(regexComQtd);
  let matchLvPg = nome.match(regexLevePague);

  if (matchPack && parseInt(matchPack[1]) > 1 && parseInt(matchPack[1]) <= 60) {
    const qtdPack = parseInt(matchPack[1]);
    const volume = matchPack[2] ? parseFloat(matchPack[2].replace(',', '.')) : null;
    const unidade = matchPack[3] ? matchPack[3].toUpperCase() : 'UN';

    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdPack;
    infoPack.volumePorItem = volume;
    infoPack.unidadeMedida = unidade;
    infoPack.precoPorUnidadeFracionada = Number((valorUnitario / qtdPack).toFixed(2));
    
    if (volume && (unidade === 'ML' || unidade === 'L')) {
      const volumeEmLitros = unidade === 'ML' ? (volume / 1000) : volume;
      const precoPorLitro = (infoPack.precoPorUnidadeFracionada / volumeEmLitros);
      infoPack.precoPorMedidaPadrao = `R$ ${precoPorLitro.toFixed(2)}/L`;
    } else if (volume && (unidade === 'G' || unidade === 'KG')) {
      const pesoEmKg = unidade === 'G' ? (volume / 1000) : volume;
      const precoPorKg = (infoPack.precoPorUnidadeFracionada / pesoEmKg);
      infoPack.precoPorMedidaPadrao = `R$ ${precoPorKg.toFixed(2)}/kg`;
    }

    infoPack.descricaoResumidaPack = `📦 Pack com ${qtdPack} un (${volume ? `${volume}${unidade}` : 'un'}) → R$ ${infoPack.precoPorUnidadeFracionada.toFixed(2)} / un`;
  } else if (matchCom && parseInt(matchCom[1]) > 1 && parseInt(matchCom[1]) <= 60) {
    const qtdPack = parseInt(matchCom[1]);
    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdPack;
    infoPack.precoPorUnidadeFracionada = Number((valorUnitario / qtdPack).toFixed(2));
    infoPack.descricaoResumidaPack = `📦 Conjunto com ${qtdPack} un → R$ ${infoPack.precoPorUnidadeFracionada.toFixed(2)} / un`;
  } else if (matchLvPg) {
    const qtdTotal = parseInt(matchLvPg[1]);
    infoPack.ehPack = true;
    infoPack.quantidadeItensNoPack = qtdTotal;
    infoPack.precoPorUnidadeFracionada = Number((valorUnitario / qtdTotal).toFixed(2));
    infoPack.descricaoResumidaPack = `🎁 Leve ${matchLvPg[1]} Pague ${matchLvPg[2]} → R$ ${infoPack.precoPorUnidadeFracionada.toFixed(2)} / un real`;
  }

  return infoPack;
}

module.exports = {
  analisarProdutoEPack
};
