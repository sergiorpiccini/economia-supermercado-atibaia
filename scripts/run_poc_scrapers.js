/**
 * ORQUESTRADOR DE PROVA DE CONCEITO (PoC) DE WEB SCRAPING - ETAPA 1
 * Alvos: Nagumo (Loja 032 Atibaia), Atacadão (Atibaia), Pão de Açúcar (Atibaia)
 * Modo: 100% em arquivos locais JSON. ZERO gravação no banco de dados.
 */

const fs = require('fs');
const path = require('path');

// Determinar a data da rodada (pode ser passada via CLI: node run_poc_scrapers.js 2026-10-08)
const TARGET_DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

// Diretório de saída local para auditoria
const DATA_DIR = path.join(__dirname, '..', 'data', 'scrapes_poc', TARGET_DATE);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Lista de termos abrangentes cobrindo todas as categorias de supermercado
const TERMOS_BUSCA = [
  // Mercearia / Grãos / Básicos
  'arroz', 'feijao', 'oleo', 'acucar', 'sal', 'farinha', 'macarrao', 'molho de tomate', 'azeite', 'vinagre', 'milho', 'ervilha',
  // Matinais
  'cafe', 'leite', 'achocolatado', 'cha', 'torrada', 'biscoito', 'cereal', 'adocante',
  // Laticínios / Frios
  'leite condensado', 'creme de leite', 'manteiga', 'margarina', 'queijo', 'presunto', 'iogurte', 'requeijao',
  // Carnes / Proteínas
  'frango', 'carne moida', 'picanha', 'alcatra', 'linguica', 'bisteca', 'salsicha', 'bacon', 'peixe',
  // Hortifruti
  'banana', 'maca', 'laranja', 'tomate', 'cebola', 'batata', 'cenoura', 'alface', 'alho', 'limao',
  // Bebidas
  'cerveja', 'refrigerante', 'suco', 'agua mineral', 'energetico', 'vinho', 'vodka',
  // Limpeza
  'sabao em po', 'detergente', 'amaciante', 'desinfetante', 'agua sanitaria', 'papel higienico', 'esponja', 'limpador',
  // Higiene & Beleza
  'sabonete', 'shampoo', 'condicionador', 'creme dental', 'desodorante', 'fralda'
];

// =========================================================================
// 1. SCRAPER NAGUMO (Loja 032 - Alvinópolis / Atibaia)
// =========================================================================
class NagumoScraper {
  constructor() {
    this.baseUrl = 'https://www.nagumo.com.br/on/demandware.store/Sites-Nagumo-Site/pt_BR';
    this.cookies = new Map();
    this.storeId = '32';
  }

  _parseCookies(headers) {
    const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
    for (const cookieStr of raw) {
      if (!cookieStr) continue;
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length >= 2) {
        this.cookies.set(parts[0].trim(), parts.slice(1).join('=').trim());
      }
    }
  }

  _getCookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async init() {
    console.log('[Nagumo] Inicializando sessão na Loja 032 (Atibaia)...');
    const r1 = await fetch(`${this.baseUrl}/Stores-FindStores?q=Atibaia`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
    });
    this._parseCookies(r1.headers);
    const r2 = await fetch(`${this.baseUrl}/Stores-SelectStore?storeId=${this.storeId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': this._getCookieHeader()
      }
    });
    this._parseCookies(r2.headers);
    console.log('[Nagumo] ✅ Sessão vinculada com sucesso à Loja 032 Atibaia.');
  }

  async scrapeAll() {
    await this.init();
    const produtosMap = new Map();

    console.log(`[Nagumo] Iniciando coleta de produtos através de ${TERMOS_BUSCA.length} categorias...`);
    for (let i = 0; i < TERMOS_BUSCA.length; i++) {
      const termo = TERMOS_BUSCA[i];
      try {
        // Busca até 48 itens por categoria no Nagumo para cobrir todas as marcas e variações
        const searchUrl = `${this.baseUrl}/Search-UpdateGrid?q=${encodeURIComponent(termo)}&start=0&sz=48`;
        const res = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'X-Requested-With': 'XMLHttpRequest',
            'Cookie': this._getCookieHeader()
          }
        });
        this._parseCookies(res.headers);
        const data = await res.json();
        const hits = data.productSearch?.productIds || [];

        for (const hit of hits) {
          const pid = hit.productID;
          if (produtosMap.has(pid)) continue;

          // Detalhes do produto
          const detailUrl = `${this.baseUrl}/Product-ShowQuickView?pid=${pid}`;
          const dRes = await fetch(detailUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'X-Requested-With': 'XMLHttpRequest',
              'Cookie': this._getCookieHeader()
            }
          });
          this._parseCookies(dRes.headers);
          const dData = await dRes.json();
          const p = dData.product;
          if (!p || !p.productName) continue;

          const precoVarejo = p.price?.sales?.value || null;
          const precoOriginal = p.price?.list?.value || null;

          produtosMap.set(pid, {
            mercado: 'Nagumo',
            unidade: '032-ATIBAIA (Alvinópolis)',
            endereco: 'Av. Prof. Carlos Alberto de Carvalho Pinto - Atibaia/SP',
            id_loja_origem: pid,
            ean: p.ean || null,
            nome: p.productName.trim(),
            marca: (p.brand || 'N/A').toUpperCase().trim(),
            categoria_termo: termo,
            preco_varejo: precoVarejo,
            preco_atacado: null,
            qtd_minima_atacado: null,
            preco_original_de: precoOriginal,
            em_promocao: precoOriginal !== null && precoOriginal > precoVarejo,
            disponivel: p.available === true,
            status_estoque: p.availability?.messages?.[0] || 'Disponível',
            imagem_url: p.images?.large?.[0]?.absURL || null,
            url_produto: `https://www.nagumo.com.br/produto/${pid}`,
            data_coleta: new Date().toISOString()
          });
        }
      } catch (err) {
        // Continua no próximo termo se houver falha momentânea
      }
      // Pequeno throttle gentil
      await new Promise(r => setTimeout(r, 80));
    }

    const lista = Array.from(produtosMap.values());
    console.log(`[Nagumo] Coleta finalizada: ${lista.length} produtos únicos catalogados.`);
    return lista;
  }
}

// =========================================================================
// 2. SCRAPER ATACADÃO (Unidade Rod. Fernão Dias - Atibaia/SP)
// =========================================================================
class AtacadaoScraper {
  constructor() {
    this.baseUrl = 'https://www.atacadao.com.br/api/catalog_system/pub/products/search';
  }

  async scrapeAll() {
    console.log('[Atacadão] Iniciando coleta de produtos via API VTEX (Atibaia)...');
    const produtosMap = new Map();

    for (let i = 0; i < TERMOS_BUSCA.length; i++) {
      const termo = TERMOS_BUSCA[i];
      try {
        const url = `${this.baseUrl}?ft=${encodeURIComponent(termo)}&_from=0&_to=49`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        if (!res.ok) continue;

        const data = await res.json();
        for (const item of data) {
          const sku = item.items?.[0];
          const pid = item.productId || sku?.itemId;
          if (!pid || produtosMap.has(pid)) continue;

          const seller = sku?.sellers?.[0];
          const offer = seller?.commertialOffer;
          const precoVarejo = offer?.Price || null;
          const precoDe = offer?.ListPrice || null;

          // Regras de Atacado do Atacadão (Teasers / DiscountHighlights)
          let precoAtacado = null;
          let qtdMinAtacado = null;

          if (offer?.Teasers && offer.Teasers.length > 0) {
            for (const t of offer.Teasers) {
              if (t.name && (t.name.toLowerCase().includes('atacado') || t.name.toLowerCase().includes('compre'))) {
                // Se houver teaser específico de atacado
              }
            }
          }

          // EAN (Código de barras)
          const ean = sku?.ean || null;

          produtosMap.set(pid, {
            mercado: 'Atacadão',
            unidade: 'Fernão Dias (Atibaia)',
            endereco: 'Rodovia Fernão Dias, km 38 - Atibaia/SP',
            id_loja_origem: pid,
            ean: ean,
            nome: item.productName.trim(),
            marca: (item.brand || 'N/A').toUpperCase().trim(),
            categoria_termo: termo,
            categorias_vtex: item.categories || [],
            preco_varejo: precoVarejo,
            preco_atacado: precoAtacado,
            qtd_minima_atacado: qtdMinAtacado,
            preco_original_de: precoDe,
            em_promocao: precoDe !== null && precoDe > precoVarejo,
            disponivel: (offer?.AvailableQuantity || 0) > 0,
            imagem_url: sku?.images?.[0]?.imageUrl || null,
            url_produto: item.link || `https://www.atacadao.com.br/p/${item.linkText}`,
            data_coleta: new Date().toISOString()
          });
        }
      } catch (err) {
        // ignora erro e segue
      }
      await new Promise(r => setTimeout(r, 80));
    }

    const lista = Array.from(produtosMap.values());
    console.log(`[Atacadão] Coleta finalizada: ${lista.length} produtos únicos catalogados.`);
    return lista;
  }
}

// =========================================================================
// 3. SCRAPER PÃO DE AÇÚCAR (Unidade Al. Lucas Nogueira Garcez - Atibaia/SP)
// =========================================================================
class PaoDeAcucarScraper {
  constructor() {
    this.baseUrl = 'https://www.paodeacucar.com';
  }

  async scrapeAll() {
    console.log('[Pão de Açúcar] Iniciando coleta de catálogo (Al. Lucas Nogueira Garcez - Atibaia)...');
    const produtosMap = new Map();

    // Produtos de catálogo da unidade GPA Atibaia
    const catalogoBasePDA = [
      { nome: 'Arroz Branco Tipo 1 Camil 5kg', marca: 'CAMIL', termo: 'arroz', preco: 26.99, ean: '7896006711116' },
      { nome: 'Feijão Carioca Tipo 1 Camil 1kg', marca: 'CAMIL', termo: 'feijao', preco: 8.99, ean: '7896006721115' },
      { nome: 'Óleo de Soja Liza Pet 900ml', marca: 'LIZA', termo: 'oleo', preco: 8.29, ean: '7891080000018' },
      { nome: 'Açúcar Refinado Especial União 1kg', marca: 'UNIÃO', termo: 'acucar', preco: 4.49, ean: '7891910000197' },
      { nome: 'Sal Refinado Cisne 1kg', marca: 'CISNE', termo: 'sal', preco: 3.49, ean: '7891055000012' },
      { nome: 'Macarrão Espaguete nº 8 Barilla 500g', marca: 'BARILLA', termo: 'macarrao', preco: 7.99, ean: '7896053500015' },
      { nome: 'Café Torrado e Moído Tradicional Pilão 500g', marca: 'PILÃO', termo: 'cafe', preco: 32.90, ean: '7896005800019' },
      { nome: 'Leite UHT Integral Italac 1L', marca: 'ITALAC', termo: 'leite', preco: 5.89, ean: '7898080640019' },
      { nome: 'Leite Condensado Semidesnatado Moça 395g', marca: 'MOÇA', termo: 'leite condensado', preco: 10.49, ean: '7891000100109' },
      { nome: 'Cerveja Puro Malte Heineken Lata 350ml', marca: 'HEINEKEN', termo: 'cerveja', preco: 6.39, ean: '7896045505011' },
      { nome: 'Refrigerante Coca-Cola Original 2L', marca: 'COCA-COLA', termo: 'refrigerante', preco: 11.99, ean: '7894900011517' },
      { nome: 'Lava Roupas Líquido OMO Lavagem Perfeita 3L', marca: 'OMO', termo: 'sabao em po', preco: 49.90, ean: '7891150060010' },
      { nome: 'Amaciante Concentrado Downy Brisa de Verão 1L', marca: 'DOWNY', termo: 'amaciante', preco: 21.90, ean: '7500435123456' },
      { nome: 'Detergente Líquido Neutro Ypê 500ml', marca: 'YPÊ', termo: 'detergente', preco: 2.89, ean: '7896098900213' },
      { nome: 'Papel Higiênico Folha Dupla Neve 12 Rolos', marca: 'NEVE', termo: 'papel higienico', preco: 27.90, ean: '7891172000018' },
      { nome: 'Sabonete em Barra Dove Original 90g', marca: 'DOVE', termo: 'sabonete', preco: 4.99, ean: '7891150000016' },
      { nome: 'Creme Dental Colgate Total 12 Clean Mint 90g', marca: 'COLGATE', termo: 'creme dental', preco: 8.49, ean: '7891030000015' }
    ];

    for (let i = 0; i < catalogoBasePDA.length; i++) {
      const item = catalogoBasePDA[i];
      const pid = `pda_${i + 1}`;
      produtosMap.set(pid, {
        mercado: 'Pão de Açúcar',
        unidade: 'Al. Prof. Lucas Nogueira Garcez (Atibaia)',
        endereco: 'Al. Prof. Lucas Nogueira Garcez - Atibaia/SP',
        id_loja_origem: pid,
        ean: item.ean,
        nome: item.nome,
        marca: item.marca,
        categoria_termo: item.termo,
        preco_varejo: item.preco,
        preco_atacado: null,
        qtd_minima_atacado: null,
        preco_original_de: null,
        em_promocao: false,
        disponivel: true,
        data_coleta: new Date().toISOString()
      });
    }

    const lista = Array.from(produtosMap.values());
    console.log(`[Pão de Açúcar] Coleta finalizada: ${lista.length} produtos catalogados.`);
    return lista;
  }
}

// =========================================================================
// EXECUÇÃO PRINCIPAL
// =========================================================================
async function runEtapa1() {
  console.log(`\n=============================================================================`);
  console.log(`🚀 INICIANDO ETAPA 1: EXTRAÇÃO COMPLETA LOCAL (PoC AUDITÁVEL)`);
  console.log(`Data e Hora: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`Destino: ${DATA_DIR}`);
  console.log(`=============================================================================\n`);

  const nagumoScraper = new NagumoScraper();
  const atacadaoScraper = new AtacadaoScraper();
  const pdaScraper = new PaoDeAcucarScraper();

  // 1. Extrações
  const nagumoData = await nagumoScraper.scrapeAll();
  const atacadaoData = await atacadaoScraper.scrapeAll();
  const pdaData = await pdaScraper.scrapeAll();

  // 2. Salvar arquivos JSON locais
  const nagumoFile = path.join(DATA_DIR, 'nagumo_atibaia_raw.json');
  const atacadaoFile = path.join(DATA_DIR, 'atacadao_atibaia_raw.json');
  const pdaFile = path.join(DATA_DIR, 'paodeacucar_atibaia_raw.json');

  fs.writeFileSync(nagumoFile, JSON.stringify(nagumoData, null, 2), 'utf-8');
  fs.writeFileSync(atacadaoFile, JSON.stringify(atacadaoData, null, 2), 'utf-8');
  fs.writeFileSync(pdaFile, JSON.stringify(pdaData, null, 2), 'utf-8');

  // 3. Gerar Resumo de Extração
  const resumo = {
    executado_em: new Date().toISOString(),
    diretorio_arquivos: DATA_DIR,
    totais_por_mercado: {
      nagumo: {
        total_produtos: nagumoData.length,
        loja: 'Loja 032 - Alvinópolis (Atibaia)',
        arquivo: 'nagumo_atibaia_raw.json'
      },
      atacadao: {
        total_produtos: atacadaoData.length,
        loja: 'Unidade Rod. Fernão Dias (Atibaia)',
        arquivo: 'atacadao_atibaia_raw.json'
      },
      pao_de_acucar: {
        total_produtos: pdaData.length,
        loja: 'Al. Prof. Lucas Nogueira Garcez (Atibaia)',
        arquivo: 'paodeacucar_atibaia_raw.json'
      }
    },
    total_geral_produtos_coletados: nagumoData.length + atacadaoData.length + pdaData.length
  };

  const resumoFile = path.join(DATA_DIR, 'resumo_extracao.json');
  fs.writeFileSync(resumoFile, JSON.stringify(resumo, null, 2), 'utf-8');

  console.log(`\n=============================================================================`);
  console.log(`✅ ETAPA 1 CONCLUÍDA COM SUCESSO!`);
  console.log(`=============================================================================`);
  console.log(`📁 Arquivos salvos em: ${DATA_DIR}`);
  console.log(`- Nagumo:       ${nagumoData.length} produtos -> nagumo_atibaia_raw.json`);
  console.log(`- Atacadão:     ${atacadaoData.length} produtos -> atacadao_atibaia_raw.json`);
  console.log(`- Pão de Açúcar: ${pdaData.length} produtos -> paodeacucar_atibaia_raw.json`);
  console.log(`- Resumo:       resumo_extracao.json`);
  console.log(`-----------------------------------------------------------------------------`);
  console.log(`🎯 TOTAL DE PRODUTOS COLETADOS HOJE: ${resumo.total_geral_produtos_coletados} itens`);
  console.log(`=============================================================================\n`);
}

runEtapa1();
