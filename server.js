const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const { analisarProdutoEPack } = require('./packParser');

const app = express();
const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Gera certificado SSL autoassinado para permitir câmera no celular localmente
const attrs = [{ name: 'commonName', value: '192.168.15.64' }];
const pems = selfsigned.generate(attrs, { days: 365 });

const sslOptions = {
  key: pems.private,
  cert: pems.cert
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Parser universal / heurístico calibrado para portais SEFAZ (incluindo SP / RJ / RS)
function parseSefazHtml(html, url) {
  const $ = cheerio.load(html);
  
  // 1. Dados do Estabelecimento
  let estabelecimento = {
    nome: '',
    nomeFantasia: '',
    cnpj: '',
    endereco: ''
  };

  const possibleNames = [
    $('#u20.txtTopo').text().trim(),
    $('#u20').text().trim(),
    $('.txtTopo').first().text().trim(),
    $('.txtTopoGrande').first().text().trim(),
    $('.conteudo_txtTopo').first().text().trim(),
    $('div[class*="topo"]').first().text().trim(),
    $('div[class*="emitente"]').first().text().trim(),
    $('.ui-header-title').text().trim(),
    $('h4').first().text().trim()
  ];
  estabelecimento.nome = possibleNames.find(n => n && n.length > 2) || 'Estabelecimento não identificado';

  // Tentar encontrar CNPJ
  const fullText = $('body').text();
  const cnpjMatch = fullText.match(/CNPJ:\s*([\d.\-\/]+)/i) || fullText.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  if (cnpjMatch) {
    estabelecimento.cnpj = cnpjMatch[1].trim();
  }

  // Tentar encontrar Endereço Físico
  const enderecoDiv = $('.txtCenter .text, .conteudo_text, div:contains("ATIBAIA")').filter((i, el) => {
    const t = $(el).text();
    return (t.includes('AVENIDA') || t.includes('RUA') || t.includes('RODOVIA') || t.includes('ALAMEDA') || t.includes('PRACA')) && !t.includes('CNPJ');
  }).first();

  if (enderecoDiv.length) {
    estabelecimento.endereco = enderecoDiv.text().replace(/[\r\n\t]+/g, ' ').replace(/\s*,\s*,?\s*/g, ', ').trim();
  }

  // 2. Itens / Produtos da Nota
  const itens = [];

  // Padrão SEFAZ SP / Padrão Nacional (#tabResult tr com span.txtTit / .RCod / .Rqtd / .RUN / .RvlUnit / span.valor)
  $('#tabResult tr, table[id*="tabResult"] tr, .table-hover tr').each((i, el) => {
    // Busca o nome estritamente no span para evitar pegar texto da coluna vizinha de valor
    let nome = $(el).find('span.txtTit, span.txtTit2, span.conteudo_txtTit, .item-nome').first().text().trim();
    if (!nome) {
      nome = $(el).find('.txtTit, .txtTit2, .conteudo_txtTit').first().text().trim();
    }
    // Remove quebras de linha ou 'Vl. Total' que possam ter entrado
    nome = nome.replace(/Vl\.?\s*Total.*/is, '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!nome) return;

    // Código do produto
    const codigoText = $(el).find('.RCod, .conteudo_RCod, .item-codigo').text().trim();
    const codigo = (codigoText.match(/\d+/) || [codigoText])[0] || '';

    // Quantidade
    const qtdRaw = $(el).find('.Rqtd, .conteudo_Rqtd, .item-qtd').text().replace(/Qtde?\.?:?/i, '').replace(',', '.').trim();
    const qtdMatch = qtdRaw.match(/[\d.]+/);
    const quantidade = qtdMatch ? parseFloat(qtdMatch[0]) : 1.0;

    // Unidade (UN, KG, CX, etc.)
    const unRaw = $(el).find('.RUN, .conteudo_RUN, .item-unidade').text().replace(/UN:?/i, '').trim();
    const unidade = unRaw || 'UN';

    // Valor Unitário
    const vlUnitRaw = $(el).find('.RvlUnit, .conteudo_RvlUnit, .item-vlunit').text().replace(/Vl?\.?\s*Unit\.?:?/i, '').replace(',', '.').trim();
    const vlUnitMatch = vlUnitRaw.match(/[\d.]+/);
    let valorUnitario = vlUnitMatch ? parseFloat(vlUnitMatch[0]) : 0.0;

    // Valor Total
    const vlTotalRaw = $(el).find('span.valor, .conteudo_valor, .RTotal, .item-vltotal').first().text().replace(',', '.').trim();
    const vlTotalMatch = vlTotalRaw.match(/[\d.]+/);
    let valorTotal = vlTotalMatch ? parseFloat(vlTotalMatch[0]) : 0.0;

    if (valorTotal === 0.0 && valorUnitario > 0) {
      valorTotal = Number((quantidade * valorUnitario).toFixed(2));
    }
    if (valorUnitario === 0.0 && valorTotal > 0 && quantidade > 0) {
      valorUnitario = Number((valorTotal / quantidade).toFixed(2));
    }

    // Inteligência de Pack e Preço Unitário Fracionado
    const packInfo = analisarProdutoEPack(nome, quantidade, valorUnitario, valorTotal);

    itens.push({
      nome,
      codigo,
      quantidade,
      unidade,
      valorUnitario,
      valorTotal,
      packInfo
    });
  });

  // Mapeamento / Dicionário de Nomes Fantasia conhecidos por CNPJ ou Razão
  const cnpjLimpo = estabelecimento.cnpj ? estabelecimento.cnpj.replace(/[^\d]/g, '') : '';
  const DICIONARIO_MERCADOS = {
    '00386708000475': 'Nagumo (Lucas)',
    '00386708000122': 'Nagumo (Centro)',
    '45543915000181': 'Supermercado Nagumo',
    '47508411000156': 'Supermercado Big',
    '50066141000108': 'Supermercado Covabra',
    '60772496000188': 'Atacadão'
  };

  if (cnpjLimpo && DICIONARIO_MERCADOS[cnpjLimpo]) {
    estabelecimento.nomeFantasia = DICIONARIO_MERCADOS[cnpjLimpo];
  } else if (estabelecimento.nome.toUpperCase().includes('COMERCIAL BRASIL')) {
    estabelecimento.nomeFantasia = 'Nagumo (Lucas)';
  } else {
    estabelecimento.nomeFantasia = estabelecimento.nome;
  }

  // Padrão 2: Lista baseada em cartões/divs (fallback)
  if (itens.length === 0) {
    $('[class*="item"], [id*="Item"], .ui-listview li').each((i, el) => {
      let nome = $(el).find('h3, .nome, strong, .txtTit').first().text().trim();
      nome = nome.replace(/Vl\.?\s*Total.*/is, '').replace(/[\r\n\t]+/g, ' ').trim();
      const textBlock = $(el).text();
      
      if (nome && (textBlock.includes('Qtde') || textBlock.includes('Vl. Total') || textBlock.includes('UN'))) {
        const qtdMatch = textBlock.match(/Qtde?\.?:\s*([\d,.]+)/i);
        const vlUnitMatch = textBlock.match(/Vl?\.?\s*Unit\.?:\s*([\d,.]+)/i);
        const vlTotalMatch = textBlock.match(/Vl?\.?\s*Total\.?:\s*([\d,.]+)/i);

        const quantidade = qtdMatch ? parseFloat(qtdMatch[1].replace(',', '.')) : 1;
        const valorUnitario = vlUnitMatch ? parseFloat(vlUnitMatch[1].replace(',', '.')) : 0;
        const valorTotal = vlTotalMatch ? parseFloat(vlTotalMatch[1].replace(',', '.')) : (quantidade * valorUnitario);

        if (nome.length > 2 && (valorTotal > 0 || valorUnitario > 0)) {
          itens.push({
            nome,
            codigo: '',
            quantidade,
            unidade: 'UN',
            valorUnitario,
            valorTotal
          });
        }
      }
    });
  }

  // 3. Totais da Nota
  let valorTotalNota = 0;
  const txtMax = $('.txtMax, .linhaShade .totalNumb, #linhaTotal:contains("Valor a pagar") .totalNumb').first().text().replace(',', '.').trim();
  const matchMax = txtMax.match(/[\d.]+/);
  if (matchMax) {
    valorTotalNota = parseFloat(matchMax[0]);
  } else if (itens.length > 0) {
    valorTotalNota = itens.reduce((acc, item) => acc + (item.valorTotal || 0), 0);
  }

  // 4. Data da Emissão
  let dataEmissao = '';
  const dataMatch = fullText.match(/Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i) || fullText.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/);
  if (dataMatch) {
    dataEmissao = dataMatch[1];
  }

  return {
    sucesso: true,
    urlConsultada: url,
    estabelecimento,
    dataEmissao,
    totalItens: itens.length,
    valorTotalNota: Number(valorTotalNota.toFixed(2)),
    itens,
    htmlSnippet: html.length > 3000 ? html.substring(0, 3000) + '... [TRUNCADO]' : html
  };
}

// Endpoint de Extração
app.post('/api/extrair', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      sucesso: false,
      erro: 'URL da NFC-e não informada ou inválida.'
    });
  }

  try {
    console.log(`[Extrator] Fazendo requisição para: ${url}`);
    
    // Headers que simulam um navegador real para evitar bloqueios da SEFAZ
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache'
      }
    });

    const parsedData = parseSefazHtml(response.data, url);

    if (parsedData.itens.length === 0) {
      console.warn('[Extrator] Aviso: Nenhum item foi extraído automaticamente. Pode ser necessário ajustar o parser para este modelo de SEFAZ.');
    }

    return res.json(parsedData);
  } catch (error) {
    console.error('[Extrator] Erro ao consultar a URL da SEFAZ:', error.message);
    return res.status(500).json({
      sucesso: false,
      erro: `Erro ao acessar o portal da SEFAZ: ${error.message}`,
      dica: 'Verifique se a URL está completa e acessível no navegador.'
    });
  }
});

const db = require('./database');
const crypto = require('crypto');
const JWT_SECRET = 'atibaia_supermercado_jwt_secret_2026';

function gerarToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, email: user.email, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString('base64');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64');
  return `${payload}.${signature}`;
}

function validarToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64');
  if (signature !== expectedSignature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Middleware para ler token de autenticação
app.use((req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = validarToken(token);
    if (decoded) {
      req.usuario = decoded;
    }
  }
  next();
});

// ==================== ROTAS DE AUTENTICAÇÃO E USUÁRIOS ====================
app.post('/api/auth/cadastro', async (req, res) => {
  try {
    const { nome, email, senha, bairro, cidade } = req.body;
    const usuario = await db.cadastrarUsuario({ nome, email, senha, bairro, cidade });
    const token = gerarToken(usuario);
    res.json({ sucesso: true, usuario, token });
  } catch (error) {
    res.status(400).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await db.autenticarUsuario(email, senha);
    const token = gerarToken(usuario);
    res.json({ sucesso: true, usuario, token });
  } catch (error) {
    res.status(400).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    if (!req.usuario) {
      return res.status(401).json({ sucesso: false, erro: 'Não autenticado.' });
    }
    const usuario = await db.obterUsuarioPorId(req.usuario.id);
    if (!usuario) {
      return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    }
    res.json({ sucesso: true, usuario });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/auth/usuarios', async (req, res) => {
  try {
    const usuarios = await db.listarUsuarios();
    res.json({ sucesso: true, usuarios });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Salvar Compra no Banco de Dados
app.post('/api/compras', async (req, res) => {
  try {
    const dados = req.body;
    if (!dados || !dados.itens || !Array.isArray(dados.itens)) {
      return res.status(400).json({ sucesso: false, erro: 'Dados da compra inválidos.' });
    }

    const usuarioId = req.usuario?.id || dados.usuarioId || 1;
    const resultado = await db.salvarCompra(dados, usuarioId);
    res.json({ sucesso: true, resultado });
  } catch (error) {
    console.error('[Database] Erro ao salvar compra:', error);
    res.status(500).json({ sucesso: false, erro: `Erro ao salvar no banco de dados: ${error.message}` });
  }
});

// Endpoint para Listar Compras (Filtra por usuário se logado, ou lista todas se especificado)
app.get('/api/compras', async (req, res) => {
  try {
    const usuarioId = req.query.todas === 'true' ? null : (req.query.usuarioId || req.usuario?.id || null);
    const compras = await db.listarCompras(usuarioId);
    res.json({ sucesso: true, compras });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Detalhar uma Compra
app.get('/api/compras/:id', async (req, res) => {
  try {
    const compra = await db.detalharCompra(req.params.id);
    if (!compra) {
      return res.status(404).json({ sucesso: false, erro: 'Compra não encontrada.' });
    }
    res.json({ sucesso: true, compra });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Excluir uma Compra
app.delete('/api/compras/:id', async (req, res) => {
  try {
    await db.excluirCompra(req.params.id);
    res.json({ sucesso: true, mensagem: 'Compra excluída com sucesso.' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Histórico de Preços de um Produto
app.get('/api/produtos/:id/historico', async (req, res) => {
  try {
    const historico = await db.obterHistoricoProduto(req.params.id);
    if (!historico) {
      return res.status(404).json({ sucesso: false, erro: 'Produto não encontrado.' });
    }
    res.json({ sucesso: true, ...historico });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Listar Todos os Produtos do Catálogo
app.get('/api/produtos', async (req, res) => {
  try {
    const q = req.query.q || '';
    const produtos = await db.listarTodosProdutos(q);
    res.json({ sucesso: true, produtos });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoints de Grupos de Comparação Personalizados (Cestas de Marcas Equivalentes)
app.get('/api/grupos', async (req, res) => {
  try {
    const grupos = await db.listarGruposComparacao();
    res.json({ sucesso: true, grupos });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/grupos', async (req, res) => {
  try {
    const { nome, descricao } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'Nome do grupo é obrigatório.' });
    }
    const grupo = await db.criarGrupoComparacao(nome, descricao);
    res.json({ sucesso: true, grupo });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/grupos/:id/produtos', async (req, res) => {
  try {
    const { produtoId } = req.body;
    if (!produtoId) {
      return res.status(400).json({ sucesso: false, erro: 'ID do produto é obrigatório.' });
    }
    const resultado = await db.adicionarProdutoAoGrupo(req.params.id, produtoId);
    res.json({ sucesso: true, ...resultado });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/grupos/:id/produtos/:prodId', async (req, res) => {
  try {
    await db.removerProdutoDoGrupo(req.params.id, req.params.prodId);
    res.json({ sucesso: true, mensagem: 'Produto removido do grupo.' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/grupos/:id', async (req, res) => {
  try {
    await db.excluirGrupoComparacao(req.params.id);
    res.json({ sucesso: true, mensagem: 'Grupo excluído com sucesso.' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Métricas do Dashboard (pessoal e da comunidade)
app.get('/api/metricas', async (req, res) => {
  try {
    const usuarioId = req.query.usuarioId || req.usuario?.id || null;
    const metricas = await db.obterMetricasGlobais(usuarioId);
    res.json({ sucesso: true, metricas });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Extrato Detalhado de Economia (Item a Item)
app.get('/api/economia/extrato', async (req, res) => {
  try {
    const usuarioId = req.query.todas === 'true' ? null : (req.query.usuarioId || req.usuario?.id || null);
    const extrato = await db.obterExtratoEconomia(usuarioId);
    res.json({ sucesso: true, ...extrato });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ==========================================
// 📋 ROTAS: LISTAS DE COMPRAS & OTIMIZADOR
// ==========================================

// Listar todas as listas do usuário
app.get('/api/listas', async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || 1;
    const listas = await db.listarListasCompras(usuarioId);
    res.json({ sucesso: true, listas });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Criar nova lista
app.post('/api/listas', async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || 1;
    const { nome } = req.body;
    const lista = await db.criarListaCompras(usuarioId, nome);
    res.json({ sucesso: true, lista });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Obter detalhes e itens de uma lista
app.get('/api/listas/:id', async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || 1;
    const lista = await db.obterListaCompras(req.params.id, usuarioId);
    if (!lista) return res.status(404).json({ sucesso: false, erro: 'Lista não encontrada.' });
    res.json({ sucesso: true, lista });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Excluir lista
app.delete('/api/listas/:id', async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || 1;
    await db.excluirListaCompras(req.params.id, usuarioId);
    res.json({ sucesso: true, mensagem: 'Lista excluída com sucesso.' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Adicionar produto à lista
app.post('/api/listas/:id/itens', async (req, res) => {
  try {
    const { produto_id, quantidade, observacao } = req.body;
    if (!produto_id) {
      return res.status(400).json({ sucesso: false, erro: 'produto_id é obrigatório.' });
    }
    const resultado = await db.adicionarItemListaCompras(req.params.id, produto_id, quantidade, observacao);
    res.json({ sucesso: true, resultado });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Atualizar item da lista (quantidade, comprado, observação)
app.put('/api/listas/itens/:itemId', async (req, res) => {
  try {
    const { quantidade, comprado, observacao } = req.body;
    await db.atualizarItemListaCompras(req.params.itemId, quantidade, comprado, observacao);
    res.json({ sucesso: true, mensagem: 'Item atualizado com sucesso.' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Remover item da lista
app.delete('/api/listas/itens/:itemId', async (req, res) => {
  try {
    await db.removerItemListaCompras(req.params.itemId);
    res.json({ sucesso: true, mensagem: 'Item removido da lista.' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Otimizar Cesta da Lista de Compras (Comparador Monomercado & Dividido)
app.get('/api/listas/:id/otimizacao', async (req, res) => {
  try {
    const analise = await db.otimizarListaCompras(req.params.id);
    res.json({ sucesso: true, analise });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Simulação ad-hoc de cesta sem salvar lista prévia
app.post('/api/listas/simular', async (req, res) => {
  try {
    const { itens } = req.body;
    if (!itens || !Array.isArray(itens)) {
      return res.status(400).json({ sucesso: false, erro: 'Array de itens obrigatório.' });
    }
    const analise = await db.otimizarListaCompras(null, itens);
    res.json({ sucesso: true, analise });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint para Importação em Lote de Scrapes de Supermercados
const { processarLoteScrape } = require('./importerScrapes');
app.post('/api/admin/importar-scrapes', async (req, res) => {
  try {
    const { itens } = req.body;
    if (!itens || !Array.isArray(itens)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato inválido. Esperado array "itens".' });
    }
    const resultado = await processarLoteScrape(itens, db);
    res.json({ sucesso: true, resultado });
  } catch (error) {
    console.error('[Admin] Erro ao importar scrapes:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Endpoint de teste rápido / health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Inicialização do Servidor (Adaptado para Nuvem e Local)
if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.PORT) {
  app.listen(HTTP_PORT, () => {
    console.log(`\n🚀 [Nuvem] Servidor rodando com sucesso na porta ${HTTP_PORT}`);
  });
} else {
  // Inicializa servidor HTTP local
  http.createServer(app).listen(HTTP_PORT, () => {
    console.log(`\n🚀 [HTTP]  Servidor rodando em: http://localhost:${HTTP_PORT} e http://192.168.15.64:${HTTP_PORT}`);
  });

  // Inicializa servidor HTTPS local
  https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
    console.log(`🔒 [HTTPS] Servidor Seguro rodando em: https://192.168.15.64:${HTTPS_PORT}`);
  });
}
