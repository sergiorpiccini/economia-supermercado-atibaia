const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'economia_supermercado.db');
const db = new sqlite3.Database(dbPath);

function hashPassword(senha) {
  const salt = 'atibaia_mercado_salt_2026';
  return crypto.pbkdf2Sync(senha, salt, 1000, 64, 'sha512').toString('hex');
}

// Inicialização e criação das tabelas
function initDb() {
  db.serialize(() => {
    // Tabela Usuários (Para colaboração e identificação das notas)
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        bairro TEXT,
        cidade TEXT DEFAULT 'Atibaia - SP',
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela Estabelecimentos
    db.run(`
      CREATE TABLE IF NOT EXISTS estabelecimentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        nome_fantasia TEXT,
        cnpj TEXT UNIQUE,
        endereco TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela Compras / Notas Fiscais
    db.run(`
      CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        estabelecimento_id INTEGER,
        url_nfce TEXT,
        chave_acesso TEXT,
        data_emissao TEXT,
        valor_total REAL NOT NULL DEFAULT 0.0,
        total_itens INTEGER NOT NULL DEFAULT 0,
        economia_estimada REAL DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
        FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimentos(id)
      )
    `);

    // Tabela Produtos
    db.run(`
      CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_padrao TEXT NOT NULL,
        codigo TEXT,
        unidade TEXT DEFAULT 'UN',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela Itens da Compra
    db.run(`
      CREATE TABLE IF NOT EXISTS itens_compra (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        compra_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        nome_original TEXT NOT NULL,
        quantidade REAL NOT NULL DEFAULT 1.0,
        unidade TEXT DEFAULT 'UN',
        valor_unitario REAL NOT NULL DEFAULT 0.0,
        valor_total REAL NOT NULL DEFAULT 0.0,
        eh_pack INTEGER DEFAULT 0,
        pack_qtd INTEGER DEFAULT 1,
        preco_unitario_fracionado REAL,
        preco_medida_padrao TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
      )
    `);

    // Tabela Histórico de Preços
    db.run(`
      CREATE TABLE IF NOT EXISTS historico_precos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        estabelecimento_id INTEGER NOT NULL,
        compra_id INTEGER NOT NULL,
        valor_unitario REAL NOT NULL DEFAULT 0.0,
        preco_fracionado REAL,
        data_registro TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (produto_id) REFERENCES produtos(id),
        FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimentos(id),
        FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE
      )
    `);

    // Tabela Grupos de Comparação Personalizados (Cestas de Equivalência de Marcas)
    db.run(`
      CREATE TABLE IF NOT EXISTS grupos_comparacao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_grupo TEXT NOT NULL,
        descricao TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela Itens do Grupo de Comparação
    db.run(`
      CREATE TABLE IF NOT EXISTS itens_grupo_comparacao (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grupo_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(grupo_id, produto_id),
        FOREIGN KEY (grupo_id) REFERENCES grupos_comparacao(id) ON DELETE CASCADE,
        FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
      )
    `);

    // Migrações dinâmicas para adicionar colunas caso o banco já existisse
    const migracoes = [
      'ALTER TABLE compras ADD COLUMN usuario_id INTEGER',
      'ALTER TABLE estabelecimentos ADD COLUMN nome_fantasia TEXT',
      'ALTER TABLE itens_compra ADD COLUMN eh_pack INTEGER DEFAULT 0',
      'ALTER TABLE itens_compra ADD COLUMN pack_qtd INTEGER DEFAULT 1',
      'ALTER TABLE itens_compra ADD COLUMN preco_unitario_fracionado REAL',
      'ALTER TABLE itens_compra ADD COLUMN preco_medida_padrao TEXT',
      'ALTER TABLE historico_precos ADD COLUMN preco_fracionado REAL'
    ];

    migracoes.forEach(sql => {
      db.run(sql, () => {}); // Ignora se a coluna já existir
    });

    // Garante que existe ao menos 1 usuário padrão (Administrador / Criador) e vincula compras anteriores
    const hashPadrao = hashPassword('123456');
    db.run(`
      INSERT OR IGNORE INTO usuarios (id, nome, email, senha_hash, bairro, cidade)
      VALUES (1, 'Você (Criador)', 'admin@atibaia.com', ?, 'Lucas / Centro', 'Atibaia - SP')
    `, [hashPadrao], () => {
      db.run('UPDATE compras SET usuario_id = 1 WHERE usuario_id IS NULL');
    });
  });
}

// Executa queries genéricas com Promise
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

const { normalizarUnidade, encontrarMelhorCorrespondencia } = require('./productMatcher');
const { resolverEstabelecimento } = require('./storeResolver');
const { analisarProdutoEPack } = require('./packParser');

// Salva compra completa e calcula comparações
async function salvarCompra(dados, usuarioId = 1) {
  const { estabelecimento = {}, dataEmissao, valorTotalNota, itens = [], urlConsultada } = dados;

  // 1. Obter ou Criar Estabelecimento com Nome Fantasia e Endereço Resolvido
  const cnpjLimpo = estabelecimento.cnpj ? String(estabelecimento.cnpj).replace(/[^\d]/g, '') : '';
  const nomeEst = (estabelecimento.nome || 'Supermercado Desconhecido').trim();
  
  const estResolvido = await resolverEstabelecimento(cnpjLimpo, nomeEst, estabelecimento.endereco);

  let estId = null;
  if (cnpjLimpo) {
    const estExistente = await getQuery('SELECT id FROM estabelecimentos WHERE cnpj = ?', [cnpjLimpo]);
    if (estExistente) {
      estId = estExistente.id;
    }
  }

  if (!estId) {
    const estPorNome = await getQuery('SELECT id FROM estabelecimentos WHERE UPPER(nome) = ?', [nomeEst.toUpperCase()]);
    if (estPorNome) {
      estId = estPorNome.id;
    } else {
      const resEst = await runQuery(
        'INSERT INTO estabelecimentos (nome, nome_fantasia, cnpj, endereco) VALUES (?, ?, ?, ?)',
        [nomeEst, estResolvido.nomeFantasia, cnpjLimpo || null, estResolvido.endereco]
      );
      estId = resEst.id;
    }
  }

  // Sempre atualiza nome fantasia e endereço com a versão resolvida
  await runQuery(
    'UPDATE estabelecimentos SET nome_fantasia = ?, endereco = COALESCE(NULLIF(?, ""), endereco) WHERE id = ?',
    [estResolvido.nomeFantasia, estResolvido.endereco, estId]
  );

  const valorTotalFinal = Number(valorTotalNota) || 0.0;
  const dataFinal = dataEmissao || new Date().toISOString();

  // 2. Criar registro da Compra vinculada ao Usuário
  const resCompra = await runQuery(
    `INSERT INTO compras (usuario_id, estabelecimento_id, url_nfce, data_emissao, valor_total, total_itens)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [usuarioId || 1, estId, urlConsultada || '', dataFinal, valorTotalFinal, itens.length]
  );
  const compraId = resCompra.id;

  let totalEconomiaCompra = 0;
  const itensProcessados = [];

  // Carrega todos os produtos existentes para correspondência inteligente
  const todosProdutosExistentes = await allQuery('SELECT id, nome_padrao, codigo, unidade FROM produtos');

  // 3. Processar cada Item com correspondência inteligente de produto e inteligência de Pack
  for (const item of itens) {
    const nomeOriginal = (item.nome || 'Produto').trim();
    const codigoItem = item.codigo ? String(item.codigo).trim() : '';

    let qtd = parseFloat(item.quantidade);
    if (isNaN(qtd) || qtd <= 0) qtd = 1.0;

    let vlTot = parseFloat(item.valorTotal);
    if (isNaN(vlTot) || vlTot < 0) vlTot = 0.0;

    let vlUnit = parseFloat(item.valorUnitario);
    if (isNaN(vlUnit) || vlUnit <= 0) {
      vlUnit = vlTot > 0 ? Number((vlTot / qtd).toFixed(2)) : 0.0;
    }
    if (vlTot === 0.0 && vlUnit > 0) {
      vlTot = Number((qtd * vlUnit).toFixed(2));
    }

    const unidadeLimpa = normalizarUnidade(item.unidade);
    
    // Analisa se é Pack (se não tiver sido analisado antes)
    const packInfo = item.packInfo || analisarProdutoEPack(nomeOriginal, qtd, vlUnit, vlTot);
    const ehPack = packInfo.ehPack ? 1 : 0;
    const packQtd = packInfo.quantidadeItensNoPack || 1;
    const precoFracionado = packInfo.precoPorUnidadeFracionada || vlUnit;
    const precoMedidaPadrao = packInfo.precoPorMedidaPadrao || null;

    // Correspondência Inteligente de Produto
    let prodId = null;
    let nomePadraoFinal = nomeOriginal;

    // A) Busca por código de barras / código se houver
    if (codigoItem) {
      const prodPorCodigo = todosProdutosExistentes.find(p => p.codigo && p.codigo === codigoItem);
      if (prodPorCodigo) {
        prodId = prodPorCodigo.id;
        nomePadraoFinal = prodPorCodigo.nome_padrao;
      }
    }

    // B) Busca por similaridade inteligente / fuzzy matching
    if (!prodId) {
      const match = encontrarMelhorCorrespondencia(nomeOriginal, todosProdutosExistentes, 0.65);
      if (match.produto) {
        prodId = match.produto.id;
        nomePadraoFinal = match.produto.nome_padrao;
      }
    }

    // C) Se for novo produto, cadastra
    if (!prodId) {
      const resProd = await runQuery(
        'INSERT INTO produtos (nome_padrao, codigo, unidade) VALUES (?, ?, ?)',
        [nomeOriginal, codigoItem || null, unidadeLimpa]
      );
      prodId = resProd.id;
      todosProdutosExistentes.push({
        id: prodId,
        nome_padrao: nomeOriginal,
        codigo: codigoItem || null,
        unidade: unidadeLimpa
      });
    }

    // Inserir Item da Compra
    await runQuery(
      `INSERT INTO itens_compra (compra_id, produto_id, nome_original, quantidade, unidade, valor_unitario, valor_total, eh_pack, pack_qtd, preco_unitario_fracionado, preco_medida_padrao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [compraId, prodId, nomeOriginal, qtd, unidadeLimpa, vlUnit, vlTot, ehPack, packQtd, precoFracionado, precoMedidaPadrao]
    );

    // Buscar histórico ANTERIOR deste produto para comparação justa (apenas compras anteriores)
    const historicoAnterior = await allQuery(
      `SELECT h.valor_unitario, h.preco_fracionado, e.nome as mercado, e.nome_fantasia, h.data_registro, h.compra_id
       FROM historico_precos h
       JOIN estabelecimentos e ON h.estabelecimento_id = e.id
       WHERE h.produto_id = ? AND h.compra_id != ?
       ORDER BY h.id DESC`,
      [prodId, compraId]
    );

    let comparacao = null;
    if (historicoAnterior && historicoAnterior.length > 0) {
      const precosFracionados = historicoAnterior.map(h => Number(h.preco_fracionado || h.valor_unitario) || 0).filter(p => p > 0);
      
      if (precosFracionados.length > 0) {
        const maiorPreco = Math.max(...precosFracionados);
        const menorPreco = Math.min(...precosFracionados);
        const precoMedio = precosFracionados.reduce((a, b) => a + b, 0) / precosFracionados.length;
        
        const ultimoRegistro = historicoAnterior[0];
        const ultimoPreco = Number(ultimoRegistro.preco_fracionado || ultimoRegistro.valor_unitario) || 0;
        const ultimoMercado = ultimoRegistro.nome_fantasia || ultimoRegistro.mercado;

        const diffUltimo = precoFracionado - ultimoPreco;
        const pctDiffUltimo = ultimoPreco > 0 ? ((diffUltimo / ultimoPreco) * 100) : 0;

        // Economia real: se pagou mais barato que a média ou maior preço registrado
        let economiaItem = 0;
        if (precoFracionado < maiorPreco) {
          economiaItem = (maiorPreco - precoFracionado) * (qtd * packQtd);
          totalEconomiaCompra += economiaItem;
        }

        comparacao = {
          ultimoPreco: Number(ultimoPreco.toFixed(2)),
          ultimoMercado,
          maiorPreco: Number(maiorPreco.toFixed(2)),
          menorPreco: Number(menorPreco.toFixed(2)),
          precoMedio: Number(precoMedio.toFixed(2)),
          diffUltimo: Number(diffUltimo.toFixed(2)),
          pctDiffUltimo: Number(pctDiffUltimo.toFixed(1)),
          economiaItem: Number(economiaItem.toFixed(2)),
          historicoQtd: historicoAnterior.length
        };
      }
    }

    // Registrar no Histórico de Preços
    await runQuery(
      `INSERT INTO historico_precos (produto_id, estabelecimento_id, compra_id, valor_unitario, preco_fracionado, data_registro)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [prodId, estId, compraId, vlUnit, precoFracionado, dataFinal]
    );

    itensProcessados.push({
      nome: nomeOriginal,
      codigo: codigoItem,
      quantidade: qtd,
      unidade: unidadeLimpa,
      valorUnitario: vlUnit,
      valorTotal: vlTot,
      ehPack,
      packQtd,
      precoFracionado,
      precoMedidaPadrao,
      packInfo,
      produtoId: prodId,
      comparacao
    });
  }

  // Atualizar a economia estimada na compra
  const economiaFinal = Number(totalEconomiaCompra.toFixed(2));
  await runQuery(
    'UPDATE compras SET economia_estimada = ? WHERE id = ?',
    [economiaFinal, compraId]
  );

  return {
    compraId,
    estabelecimento: estResolvido.nomeFantasia,
    razaoSocial: nomeEst,
    endereco: estResolvido.endereco,
    valorTotal: valorTotalFinal,
    totalItens: itens.length,
    economiaEstimada: economiaFinal,
    itens: itensProcessados
  };
}

// Funções de Usuários e Autenticação
async function cadastrarUsuario(dados) {
  const { nome, email, senha, bairro, cidade } = dados;
  if (!email || !senha || !nome) {
    throw new Error('Nome, E-mail e Senha são obrigatórios.');
  }
  const emailLimpo = email.trim().toLowerCase();
  const existe = await getQuery('SELECT id FROM usuarios WHERE email = ?', [emailLimpo]);
  if (existe) {
    throw new Error('Este e-mail já está cadastrado.');
  }
  const hash = hashPassword(senha);
  const res = await runQuery(
    'INSERT INTO usuarios (nome, email, senha_hash, bairro, cidade) VALUES (?, ?, ?, ?, ?)',
    [nome.trim(), emailLimpo, hash, bairro ? bairro.trim() : 'Atibaia', cidade ? cidade.trim() : 'Atibaia - SP']
  );
  return {
    id: res.id,
    nome: nome.trim(),
    email: emailLimpo,
    bairro: bairro ? bairro.trim() : 'Atibaia',
    cidade: cidade ? cidade.trim() : 'Atibaia - SP'
  };
}

async function autenticarUsuario(email, senha) {
  if (!email || !senha) throw new Error('E-mail e senha são obrigatórios.');
  const emailLimpo = email.trim().toLowerCase();
  const user = await getQuery('SELECT * FROM usuarios WHERE email = ?', [emailLimpo]);
  if (!user) throw new Error('Usuário não encontrado.');
  const hash = hashPassword(senha);
  if (user.senha_hash !== hash) {
    throw new Error('Senha incorreta.');
  }
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    bairro: user.bairro,
    cidade: user.cidade,
    created_at: user.created_at
  };
}

async function obterUsuarioPorId(id) {
  const user = await getQuery('SELECT id, nome, email, bairro, cidade, created_at FROM usuarios WHERE id = ?', [id]);
  return user || null;
}

async function listarUsuarios() {
  const users = await allQuery(`
    SELECT u.id, u.nome, u.email, u.bairro, u.cidade, u.created_at,
           COUNT(c.id) as total_compras,
           COALESCE(SUM(c.valor_total), 0) as total_gasto,
           COALESCE(SUM(c.economia_estimada), 0) as total_economia
    FROM usuarios u
    LEFT JOIN compras c ON u.id = c.usuario_id
    GROUP BY u.id
    ORDER BY total_compras DESC, u.nome ASC
  `);
  return users;
}

// Lista compras realizadas (se usuarioId informado, filtra pelo usuário; senão, lista todas)
async function listarCompras(usuarioId = null) {
  let sql = `
    SELECT c.id, c.usuario_id, c.data_emissao, c.valor_total, c.total_itens, c.economia_estimada, c.created_at,
           e.nome as estabelecimento_nome, e.nome_fantasia as estabelecimento_fantasia,
           e.cnpj as estabelecimento_cnpj, e.endereco as estabelecimento_endereco,
           u.nome as usuario_nome, u.bairro as usuario_bairro
    FROM compras c
    LEFT JOIN estabelecimentos e ON c.estabelecimento_id = e.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
  `;
  const params = [];
  if (usuarioId) {
    sql += ` WHERE c.usuario_id = ?`;
    params.push(usuarioId);
  }
  sql += ` ORDER BY c.id DESC`;

  const compras = await allQuery(sql, params);
  return compras;
}

// Detalha uma compra com todos os itens e autor do escaneamento
async function detalharCompra(compraId) {
  const compra = await getQuery(`
    SELECT c.*, e.nome as estabelecimento_nome, e.nome_fantasia as estabelecimento_fantasia,
           e.cnpj as estabelecimento_cnpj, e.endereco as estabelecimento_endereco,
           u.nome as usuario_nome, u.bairro as usuario_bairro
    FROM compras c
    LEFT JOIN estabelecimentos e ON c.estabelecimento_id = e.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.id = ?
  `, [compraId]);

  if (!compra) return null;

  const itens = await allQuery(`
    SELECT i.*, p.nome_padrao
    FROM itens_compra i
    JOIN produtos p ON i.produto_id = p.id
    WHERE i.compra_id = ?
    ORDER BY i.id ASC
  `, [compraId]);

  return { ...compra, itens };
}

// Exclui uma compra
async function excluirCompra(compraId, usuarioId = null) {
  if (usuarioId) {
    const compra = await getQuery('SELECT id FROM compras WHERE id = ? AND usuario_id = ?', [compraId, usuarioId]);
    if (!compra) throw new Error('Permissão negada ou compra não encontrada.');
  }
  await runQuery('DELETE FROM compras WHERE id = ?', [compraId]);
  await runQuery('DELETE FROM itens_compra WHERE compra_id = ?', [compraId]);
  await runQuery('DELETE FROM historico_precos WHERE compra_id = ?', [compraId]);
  return { sucesso: true };
}

// Timeline de Preço de um Produto
async function obterHistoricoProduto(termoOuId) {
  let produto = null;
  if (typeof termoOuId === 'number' || !isNaN(Number(termoOuId))) {
    produto = await getQuery('SELECT * FROM produtos WHERE id = ?', [Number(termoOuId)]);
  } else {
    produto = await getQuery('SELECT * FROM produtos WHERE UPPER(nome_padrao) LIKE ? LIMIT 1', [`%${String(termoOuId).toUpperCase()}%`]);
  }

  if (!produto) return null;

  const historico = await allQuery(`
    SELECT h.valor_unitario, h.preco_fracionado, h.data_registro, 
           e.nome as estabelecimento_razao, 
           COALESCE(e.nome_fantasia, e.nome) as estabelecimento_nome,
           e.endereco as estabelecimento_endereco
    FROM historico_precos h
    JOIN estabelecimentos e ON h.estabelecimento_id = e.id
    WHERE h.produto_id = ?
    ORDER BY h.id DESC
  `, [produto.id]);

  const precos = historico.map(h => Number(h.preco_fracionado || h.valor_unitario) || 0).filter(p => p > 0);
  const menorPreco = precos.length ? Math.min(...precos) : 0;
  const maiorPreco = precos.length ? Math.max(...precos) : 0;
  const precoMedio = precos.length ? (precos.reduce((a, b) => a + b, 0) / precos.length) : 0;

  return {
    produto,
    estatisticas: {
      menorPreco: Number(menorPreco.toFixed(2)),
      maiorPreco: Number(maiorPreco.toFixed(2)),
      precoMedio: Number(precoMedio.toFixed(2)),
      totalRegistros: historico.length
    },
    historico
  };
}

// Métricas e Resumo Pessoal + Colaborativo da Comunidade
async function obterMetricasGlobais(usuarioId = null) {
  let userClause = '';
  let userParams = [];
  if (usuarioId) {
    userClause = ' WHERE usuario_id = ?';
    userParams = [usuarioId];
  }

  const userCompras = (await getQuery(`SELECT COUNT(*) as count FROM compras${userClause}`, userParams)).count || 0;
  const userGasto = (await getQuery(`SELECT SUM(valor_total) as sum FROM compras${userClause}`, userParams)).sum || 0;
  const userEconomia = (await getQuery(`SELECT SUM(economia_estimada) as sum FROM compras${userClause}`, userParams)).sum || 0;

  // Métricas comunitárias de toda Atibaia
  const totalCompras = (await getQuery('SELECT COUNT(*) as count FROM compras')).count || 0;
  const totalGasto = (await getQuery('SELECT SUM(valor_total) as sum FROM compras')).sum || 0;
  const totalEconomia = (await getQuery('SELECT SUM(economia_estimada) as sum FROM compras')).sum || 0;
  const totalProdutos = (await getQuery('SELECT COUNT(*) as count FROM produtos')).count || 0;
  const totalMercados = (await getQuery('SELECT COUNT(*) as count FROM estabelecimentos')).count || 0;
  const totalUsuarios = (await getQuery('SELECT COUNT(*) as count FROM usuarios')).count || 0;

  const topProdutos = await allQuery(`
    SELECT p.id, p.nome_padrao, COUNT(i.id) as vezes_comprado,
           MIN(COALESCE(h.preco_fracionado, h.valor_unitario)) as menor_preco,
           MAX(COALESCE(h.preco_fracionado, h.valor_unitario)) as maior_preco
    FROM produtos p
    JOIN itens_compra i ON p.id = i.produto_id
    LEFT JOIN historico_precos h ON p.id = h.produto_id
    GROUP BY p.id
    ORDER BY vezes_comprado DESC
    LIMIT 6
  `);

  return {
    usuario: {
      totalCompras: userCompras,
      totalGasto: Number(userGasto.toFixed(2)),
      totalEconomia: Number(userEconomia.toFixed(2))
    },
    comunidade: {
      totalCompras,
      totalGasto: Number(totalGasto.toFixed(2)),
      totalEconomia: Number(totalEconomia.toFixed(2)),
      totalProdutos,
      totalMercados,
      totalUsuarios
    },
    totalCompras: userCompras,
    totalGasto: Number(userGasto.toFixed(2)),
    totalEconomia: Number(userEconomia.toFixed(2)),
    totalProdutos,
    totalMercados,
    totalUsuarios,
    topProdutos
  };
}

// Lista todos os produtos cadastrados com estatísticas de preço
async function listarTodosProdutos(termoBusca = '') {
  let query = `
    SELECT p.id, p.nome_padrao, p.codigo, p.unidade, p.created_at,
           COUNT(DISTINCT i.compra_id) as vezes_comprado,
           COUNT(i.id) as total_itens_comprados,
           MIN(COALESCE(h.preco_fracionado, h.valor_unitario)) as menor_preco,
           MAX(COALESCE(h.preco_fracionado, h.valor_unitario)) as maior_preco,
           AVG(COALESCE(h.preco_fracionado, h.valor_unitario)) as preco_medio
    FROM produtos p
    LEFT JOIN itens_compra i ON p.id = i.produto_id
    LEFT JOIN historico_precos h ON p.id = h.produto_id
  `;
  const params = [];
  if (termoBusca && termoBusca.trim()) {
    query += ` WHERE UPPER(p.nome_padrao) LIKE ? OR p.codigo LIKE ?`;
    const t = `%${termoBusca.trim().toUpperCase()}%`;
    params.push(t, `%${termoBusca.trim()}%`);
  }
  query += ` GROUP BY p.id ORDER BY vezes_comprado DESC, p.nome_padrao ASC`;

  const prods = await allQuery(query, params);

  const resultados = await Promise.all(prods.map(async (prod) => {
    const ultimo = await getQuery(`
      SELECT h.valor_unitario, h.preco_fracionado, h.data_registro,
             COALESCE(e.nome_fantasia, e.nome) as mercado, e.endereco
      FROM historico_precos h
      JOIN estabelecimentos e ON h.estabelecimento_id = e.id
      WHERE h.produto_id = ?
      ORDER BY h.id DESC LIMIT 1
    `, [prod.id]);

    const melhor = await getQuery(`
      SELECT h.valor_unitario, h.preco_fracionado, h.data_registro,
             COALESCE(e.nome_fantasia, e.nome) as mercado, e.endereco
      FROM historico_precos h
      JOIN estabelecimentos e ON h.estabelecimento_id = e.id
      WHERE h.produto_id = ?
      ORDER BY COALESCE(h.preco_fracionado, h.valor_unitario) ASC, h.id DESC LIMIT 1
    `, [prod.id]);

    return {
      id: prod.id,
      nome_padrao: prod.nome_padrao,
      codigo: prod.codigo,
      unidade: prod.unidade,
      vezes_comprado: prod.vezes_comprado || 0,
      menor_preco: prod.menor_preco ? Number(Number(prod.menor_preco).toFixed(2)) : 0,
      maior_preco: prod.maior_preco ? Number(Number(prod.maior_preco).toFixed(2)) : 0,
      preco_medio: prod.preco_medio ? Number(Number(prod.preco_medio).toFixed(2)) : 0,
      ultimo_preco: ultimo ? Number((ultimo.preco_fracionado || ultimo.valor_unitario || 0).toFixed(2)) : 0,
      ultimo_mercado: ultimo ? ultimo.mercado : '',
      ultimo_endereco: ultimo ? ultimo.endereco : '',
      ultima_data: ultimo ? ultimo.data_registro : '',
      melhor_mercado: melhor ? melhor.mercado : '',
      melhor_endereco: melhor ? melhor.endereco : ''
    };
  }));

  return resultados;
}

// Criar Grupo de Comparação
async function criarGrupoComparacao(nomeGrupo, descricao = '') {
  const res = await runQuery(
    'INSERT INTO grupos_comparacao (nome_grupo, descricao) VALUES (?, ?)',
    [nomeGrupo.trim(), descricao ? descricao.trim() : '']
  );
  return { id: res.id, nome_grupo: nomeGrupo.trim(), descricao };
}

// Listar Grupos de Comparação com seus produtos e o produto vencedor (mais barato)
async function listarGruposComparacao() {
  const grupos = await allQuery('SELECT * FROM grupos_comparacao ORDER BY id DESC');
  
  const gruposComProdutos = await Promise.all(grupos.map(async (g) => {
    const produtos = await allQuery(`
      SELECT p.id, p.nome_padrao, p.unidade, p.codigo,
             ig.created_at as adicionado_em
      FROM itens_grupo_comparacao ig
      JOIN produtos p ON ig.produto_id = p.id
      WHERE ig.grupo_id = ?
      ORDER BY p.nome_padrao ASC
    `, [g.id]);

    const prodsComDetalhes = await Promise.all(produtos.map(async (prod) => {
      const hist = await allQuery(`
        SELECT h.valor_unitario, h.preco_fracionado, h.data_registro,
               COALESCE(e.nome_fantasia, e.nome) as mercado, e.endereco
        FROM historico_precos h
        JOIN estabelecimentos e ON h.estabelecimento_id = e.id
        WHERE h.produto_id = ?
        ORDER BY h.id DESC
      `, [prod.id]);

      const precos = hist.map(h => Number(h.preco_fracionado || h.valor_unitario) || 0).filter(p => p > 0);
      const menorPreco = precos.length ? Math.min(...precos) : 0;
      const ultimoRegistro = hist.length ? hist[0] : null;
      const ultimoPreco = ultimoRegistro ? Number((ultimoRegistro.preco_fracionado || ultimoRegistro.valor_unitario).toFixed(2)) : 0;
      const melhorRegistro = hist.find(h => Number(h.preco_fracionado || h.valor_unitario) === menorPreco);

      return {
        id: prod.id,
        nome_padrao: prod.nome_padrao,
        unidade: prod.unidade,
        codigo: prod.codigo,
        menorPreco: Number(menorPreco.toFixed(2)),
        ultimoPreco: ultimoPreco,
        ultimoMercado: ultimoRegistro ? ultimoRegistro.mercado : '',
        melhorMercado: melhorRegistro ? melhorRegistro.mercado : (ultimoRegistro ? ultimoRegistro.mercado : ''),
        melhorEndereco: melhorRegistro ? melhorRegistro.endereco : '',
        totalRegistros: hist.length
      };
    }));

    // Determinar o produto "Vencedor" (menor preço dentre os cadastrados no grupo)
    let vencedor = null;
    const produtosComPreco = prodsComDetalhes.filter(p => p.menorPreco > 0 || p.ultimoPreco > 0);
    if (produtosComPreco.length > 0) {
      vencedor = produtosComPreco.reduce((prev, curr) => {
        const precoP = prev.ultimoPreco || prev.menorPreco;
        const precoC = curr.ultimoPreco || curr.menorPreco;
        return (precoC < precoP) ? curr : prev;
      });
    }

    return {
      id: g.id,
      nome_grupo: g.nome_grupo,
      descricao: g.descricao,
      created_at: g.created_at,
      total_produtos: produtos.length,
      vencedor,
      produtos: prodsComDetalhes
    };
  }));

  return gruposComProdutos;
}

// Adicionar produto a um grupo de comparação
async function adicionarProdutoAoGrupo(grupoId, produtoId) {
  const existe = await getQuery(
    'SELECT id FROM itens_grupo_comparacao WHERE grupo_id = ? AND produto_id = ?',
    [grupoId, produtoId]
  );
  if (existe) return { id: existe.id, jaExistia: true };

  const res = await runQuery(
    'INSERT INTO itens_grupo_comparacao (grupo_id, produto_id) VALUES (?, ?)',
    [grupoId, produtoId]
  );
  return { id: res.id, sucesso: true };
}

// Remover produto de um grupo
async function removerProdutoDoGrupo(grupoId, produtoId) {
  await runQuery(
    'DELETE FROM itens_grupo_comparacao WHERE grupo_id = ? AND produto_id = ?',
    [grupoId, produtoId]
  );
  return { sucesso: true };
}

// Excluir grupo de comparação
async function excluirGrupoComparacao(grupoId) {
  await runQuery('DELETE FROM itens_grupo_comparacao WHERE grupo_id = ?', [grupoId]);
  await runQuery('DELETE FROM grupos_comparacao WHERE id = ?', [grupoId]);
  return { sucesso: true };
}

initDb();

module.exports = {
  cadastrarUsuario,
  autenticarUsuario,
  obterUsuarioPorId,
  listarUsuarios,
  salvarCompra,
  listarCompras,
  detalharCompra,
  excluirCompra,
  obterHistoricoProduto,
  obterMetricasGlobais,
  listarTodosProdutos,
  criarGrupoComparacao,
  listarGruposComparacao,
  adicionarProdutoAoGrupo,
  removerProdutoDoGrupo,
  excluirGrupoComparacao
};
