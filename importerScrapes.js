const { normalizarUnidade, encontrarMelhorCorrespondencia } = require('./productMatcher');
const { analisarProdutoEPack } = require('./packParser');

// Mapeamento dos Mercados Scrapeados para Estabelecimentos Oficiais
const MAPA_ESTABELECIMENTOS_SCRAPE = {
  'atacadao': {
    nome: 'ATACADAO S.A. - ATIBAIA',
    nome_fantasia: 'Atacadão (Fernão Dias)',
    cnpj: '75315333000109',
    endereco: 'Rodovia Fernão Dias, km 38 - Atibaia/SP'
  },
  'nagumo': {
    nome: 'COMERCIAL BRASIL DE ATIBAIA LTDA - ALVINOPOLIS',
    nome_fantasia: 'Nagumo (Alvinópolis)',
    cnpj: '00386708000637',
    endereco: 'Av. Prof. Carlos Alberto de Carvalho Pinto, 915 - Alvinópolis, Atibaia - SP'
  },
  'paodeacucar': {
    nome: 'COMPANHIA BRASILEIRA DE DISTRIBUICAO - PAO DE ACUCAR',
    nome_fantasia: 'Pão de Açúcar (Lucas)',
    cnpj: '47508411032198',
    endereco: 'Al. Prof. Lucas Nogueira Garcez, 2525 - Atibaia/SP'
  },
  'pao_de_acucar': {
    nome: 'COMPANHIA BRASILEIRA DE DISTRIBUICAO - PAO DE ACUCAR',
    nome_fantasia: 'Pão de Açúcar (Lucas)',
    cnpj: '47508411032198',
    endereco: 'Al. Prof. Lucas Nogueira Garcez, 2525 - Atibaia/SP'
  }
};

/**
 * Processa um lote de produtos scrapeados e insere no banco (Turso ou SQLite local)
 * @param {Array} itensScrape - Array de itens scrapeados
 * @param {Object} db - Módulo database com runQuery, getQuery, allQuery
 */
async function processarLoteScrape(itensScrape, db) {
  if (!itensScrape || !Array.isArray(itensScrape) || itensScrape.length === 0) {
    return { processados: 0, novosProdutos: 0, precosInseridos: 0 };
  }

  // 1. Garantir que os Estabelecimentos existem
  const mapaEstIds = {};
  for (const [chave, dadosEst] of Object.entries(MAPA_ESTABELECIMENTOS_SCRAPE)) {
    let est = await db.getQuery('SELECT id FROM estabelecimentos WHERE UPPER(nome_fantasia) = ? OR cnpj = ?', [dadosEst.nome_fantasia.toUpperCase(), dadosEst.cnpj]);
    if (!est) {
      const res = await db.runQuery(
        'INSERT INTO estabelecimentos (nome, nome_fantasia, cnpj, endereco) VALUES (?, ?, ?, ?)',
        [dadosEst.nome, dadosEst.nome_fantasia, dadosEst.cnpj, dadosEst.endereco]
      );
      mapaEstIds[chave] = res.id;
    } else {
      mapaEstIds[chave] = est.id;
    }
  }

  // 2. Carregar catálogo existente para correspondência inteligente
  const produtosExistentes = await db.allQuery('SELECT id, nome_padrao, codigo, unidade FROM produtos');
  const mapaPorEan = new Map();
  const mapaPorNome = new Map();

  produtosExistentes.forEach(p => {
    if (p.codigo) mapaPorEan.set(String(p.codigo).trim(), p);
    if (p.nome_padrao) mapaPorNome.set(p.nome_padrao.trim().toUpperCase(), p);
  });

  let novosProdutos = 0;
  let precosInseridos = 0;
  let itensIgnorados = 0;

  for (const item of itensScrape) {
    const nomeLimpo = (item.nome || '').trim();
    const precoVarejo = parseFloat(item.preco_varejo || item.preco || 0);

    if (!nomeLimpo || isNaN(precoVarejo) || precoVarejo <= 0) {
      itensIgnorados++;
      continue;
    }

    const ean = item.ean ? String(item.ean).trim() : null;
    const mercadoChave = (item.mercado || '').toLowerCase().replace(/[^a-z]/g, '');
    const estId = mapaEstIds[mercadoChave] || mapaEstIds['nagumo'] || 1;

    // Data da coleta formatada
    let dataRegistro = new Date().toLocaleDateString('pt-BR');
    if (item.data_coleta) {
      const d = new Date(item.data_coleta);
      if (!isNaN(d.getTime())) {
        dataRegistro = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
      }
    }

    // Identificar ou Criar Produto
    let prod = null;

    // A) Pelo EAN
    if (ean && mapaPorEan.has(ean)) {
      prod = mapaPorEan.get(ean);
    }

    // B) Pelo Nome Exato
    if (!prod && mapaPorNome.has(nomeLimpo.toUpperCase())) {
      prod = mapaPorNome.get(nomeLimpo.toUpperCase());
    }

    // C) Pelo Fuzzy Matcher
    if (!prod) {
      const match = encontrarMelhorCorrespondencia(nomeLimpo, produtosExistentes, 0.78);
      if (match.produto) {
        prod = match.produto;
      }
    }

    // D) Criar Novo Produto
    if (!prod) {
      const unidadePadrao = nomeLimpo.match(/\bkg\b/i) ? 'KG' : 'UN';
      const resNovo = await db.runQuery(
        'INSERT INTO produtos (nome_padrao, codigo, unidade) VALUES (?, ?, ?)',
        [nomeLimpo, ean || null, unidadePadrao]
      );
      prod = { id: resNovo.id, nome_padrao: nomeLimpo, codigo: ean, unidade: unidadePadrao };
      produtosExistentes.push(prod);
      if (ean) mapaPorEan.set(ean, prod);
      mapaPorNome.set(nomeLimpo.toUpperCase(), prod);
      novosProdutos++;
    } else if (ean && !prod.codigo) {
      // Atualiza código EAN se não existia antes
      await db.runQuery('UPDATE produtos SET codigo = ? WHERE id = ?', [ean, prod.id]);
      prod.codigo = ean;
      mapaPorEan.set(ean, prod);
    }

    // Análise de pack fracionado
    const packInfo = analisarProdutoEPack(nomeLimpo, 1, precoVarejo, precoVarejo);
    const precoFracionado = packInfo.ehPack ? packInfo.precoPorUnidadeFracionada : precoVarejo;

    // Data no formato YYYY-MM-DD para checar duplicata no mesmo dia
    const dataDia = dataRegistro.split(' ')[0];

    // Evitar inserir o mesmo produto no mesmo mercado no mesmo dia
    const precoExistente = await db.getQuery(`
      SELECT id FROM historico_precos 
      WHERE produto_id = ? AND estabelecimento_id = ? AND data_registro LIKE ?
    `, [prod.id, estId, `${dataDia}%`]);

    if (!precoExistente) {
      await db.runQuery(
        'INSERT INTO historico_precos (produto_id, estabelecimento_id, compra_id, valor_unitario, preco_fracionado, data_registro) VALUES (?, ?, 0, ?, ?, ?)',
        [prod.id, estId, precoVarejo, precoFracionado, dataRegistro]
      );
      precosInseridos++;
    }
  }

  return {
    totalItensLote: itensScrape.length,
    novosProdutos,
    precosInseridos,
    itensIgnorados
  };
}

module.exports = {
  processarLoteScrape,
  MAPA_ESTABELECIMENTOS_SCRAPE
};
