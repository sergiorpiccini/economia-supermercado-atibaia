const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

// Verifica se existem credenciais da nuvem (Turso / LibSQL)
const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '';
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || '';

let libsql = null;
let db = null;

if (tursoUrl && (tursoUrl.startsWith('libsql://') || tursoUrl.startsWith('https://') || tursoUrl.startsWith('http://'))) {
  console.log('[Database] Conectando ao Banco de Dados SQLite na Nuvem Permanente (Turso/LibSQL)...');
  libsql = createClient({
    url: tursoUrl,
    authToken: tursoAuthToken
  });
} else {
  console.log('[Database] Usando Banco de Dados SQLite Local...');
  const dbPath = path.join(__dirname, 'economia_supermercado.db');
  db = new sqlite3.Database(dbPath);
}

function hashPassword(senha) {
  const salt = 'atibaia_mercado_salt_2026';
  return crypto.pbkdf2Sync(senha, salt, 1000, 64, 'sha512').toString('hex');
}

// Inicialização e criação das tabelas
async function initDb() {
  const schemaSqls = [
    `CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      bairro TEXT,
      cidade TEXT DEFAULT 'Atibaia - SP',
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS estabelecimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      nome_fantasia TEXT,
      cnpj TEXT UNIQUE,
      endereco TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS compras (
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
    )`,
    `CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_padrao TEXT NOT NULL,
      codigo TEXT,
      unidade TEXT DEFAULT 'UN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS itens_compra (
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
    )`,
    `CREATE TABLE IF NOT EXISTS historico_precos (
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
    )`,
    `CREATE TABLE IF NOT EXISTS grupos_comparacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_grupo TEXT NOT NULL,
      descricao TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS itens_grupo_comparacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grupo_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(grupo_id, produto_id),
      FOREIGN KEY (grupo_id) REFERENCES grupos_comparacao(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS listas_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL DEFAULT 1,
      nome_lista TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )`,
    `CREATE TABLE IF NOT EXISTS itens_lista_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lista_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL DEFAULT 1.0,
      observacao TEXT,
      comprado INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lista_id) REFERENCES listas_compras(id) ON DELETE CASCADE,
      FOREIGN KEY (produto_id) REFERENCES produtos(id)
    )`
  ];

  const migracoes = [
    'ALTER TABLE compras ADD COLUMN usuario_id INTEGER',
    'ALTER TABLE estabelecimentos ADD COLUMN nome_fantasia TEXT',
    'ALTER TABLE itens_compra ADD COLUMN eh_pack INTEGER DEFAULT 0',
    'ALTER TABLE itens_compra ADD COLUMN pack_qtd INTEGER DEFAULT 1',
    'ALTER TABLE itens_compra ADD COLUMN preco_unitario_fracionado REAL',
    'ALTER TABLE itens_compra ADD COLUMN preco_medida_padrao TEXT',
    'ALTER TABLE historico_precos ADD COLUMN preco_fracionado REAL',
    'ALTER TABLE itens_lista_compras ADD COLUMN grupo_id INTEGER'
  ];

  for (const sql of schemaSqls) {
    try {
      await runQuery(sql);
    } catch (e) {
      console.warn('[DB Init] Aviso na tabela:', e.message);
    }
  }

  for (const sql of migracoes) {
    try {
      await runQuery(sql);
    } catch (e) {
      // Ignora se coluna já existir
    }
  }

  // Se o banco estiver vazio (como no primeiro deploy na nuvem Turso), restaura todo o histórico de compras e produtos
  await povoarDadosHistoricosSeVazio();
}

async function povoarDadosHistoricosSeVazio() {
  try {
    const prodCountRow = await getQuery('SELECT COUNT(*) as total FROM produtos');
    const total = prodCountRow ? Number(prodCountRow.total || 0) : 0;
    if (total > 0) return; // Já possui dados

    console.log('[Database] Povoando dados históricos e notas fiscais anteriores no banco permanente...');

    // 1. Estabelecimentos
    const ests = [
      { id: 1, nome: "COMERCIAL BRASIL DE ATIBAIA LTDA", nome_fantasia: "Nagumo (Lucas)", cnpj: "00386708000475", endereco: "Av. Lucas Nogueira Garcez, 2827 - Vila Giglio, Atibaia - SP" },
      { id: 3, nome: "UNISUPER UNIAO SUPERMERCADO LOJA 10", nome_fantasia: "União (Alvinópolis)", cnpj: "72995475001067", endereco: "Av. Dona Gertrudes, 747 - Alvinópolis, Atibaia - SP" }
    ];
    for (const e of ests) {
      await runQuery('INSERT OR IGNORE INTO estabelecimentos (id, nome, nome_fantasia, cnpj, endereco) VALUES (?, ?, ?, ?, ?)', [e.id, e.nome, e.nome_fantasia, e.cnpj, e.endereco]);
    }

    // 2. Produtos
    const prods = [
      { id: 1, nome_padrao: "DETERGENTE YPE NEUTRO 500ML (PACK 6X500ML)", codigo: "206210", unidade: "UN" },
      { id: 2, nome_padrao: "Cafe", codigo: null, unidade: "UN" },
      { id: 3, nome_padrao: "PAO DE FORMA VISCONTI INTEGRAL 400G", codigo: "152426", unidade: "UN" },
      { id: 4, nome_padrao: "SABONETE ALBANY 80G HIDRATACAO INTENSIVA", codigo: "238094", unidade: "UN" },
      { id: 5, nome_padrao: "PAO FRANCES KG", codigo: "8414", unidade: "KG" },
      { id: 6, nome_padrao: "PRESUNTO COZIDO CERATTI KG", codigo: "2786", unidade: "KG" },
      { id: 7, nome_padrao: "QUEIJO MUSSARELA FATIADO KG", codigo: "345", unidade: "KG" },
      { id: 8, nome_padrao: "OVOS BRANCOS EXTRA PRETI PVC C/ 20", codigo: "36493", unidade: "UN" },
      { id: 9, nome_padrao: "BACON SEARA TABLETE KG", codigo: "2370", unidade: "KG" },
      { id: 10, nome_padrao: "MARGARINA QUALY 500G C/ SAL", codigo: "121385", unidade: "UN" },
      { id: 11, nome_padrao: "ATUM SOLIDO EM OLEO 88 170G", codigo: "225251", unidade: "UN" },
      { id: 12, nome_padrao: "OLEO MISTO SOJA E AZEITE CASTELO 500ML", codigo: "34621", unidade: "UN" },
      { id: 13, nome_padrao: "ALHO PICADO GARLIC 1KG", codigo: "78771", unidade: "UN" },
      { id: 14, nome_padrao: "BOMBOM DA ALCATRA KG", codigo: "9821", unidade: "KG" },
      { id: 16, nome_padrao: "CEBOLA KG", codigo: "913", unidade: "KG" }
    ];
    for (const p of prods) {
      await runQuery('INSERT OR IGNORE INTO produtos (id, nome_padrao, codigo, unidade) VALUES (?, ?, ?, ?)', [p.id, p.nome_padrao, p.codigo, p.unidade]);
    }

    // 3. Compras
    const compras = [
      { id: 5, estabelecimento_id: 1, usuario_id: 1, url_nfce: "https://www.nfce.fazenda.sp.gov.br/qrcode?p=35261000386708000475651070000729731258012928|3|1", data_emissao: "06/10/2026 10:51:24", valor_total: 30.68, total_itens: 4, created_at: "2026-10-06 16:06:13" },
      { id: 6, estabelecimento_id: 3, usuario_id: 1, url_nfce: "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261072995475001067651170000350651117251666|2|1|2|2D1F1DAA74DAF6BB16E596DB88E4871BE418236E", data_emissao: "06/10/2026 16:18:00", valor_total: 32.59, total_itens: 4, created_at: "2026-10-06 19:33:53" },
      { id: 7, estabelecimento_id: 1, usuario_id: 1, url_nfce: "https://www.nfce.fazenda.sp.gov.br/qrcode?p=35261000386708000475651030001161981491145357|3|1", data_emissao: "07/10/2026 11:19:25", valor_total: 33.33, total_itens: 3, created_at: "2026-10-07 14:56:52" },
      { id: 8, estabelecimento_id: 3, usuario_id: 1, url_nfce: "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35260972995475001067651180000574041118168257|2|1|2|1C667DCF8BF03E485F2DA1CBF4EFA95C6C7EB0C0", data_emissao: "30/09/2026 11:56:00", valor_total: 113.9, total_itens: 11, created_at: "2026-10-07 15:04:23" }
    ];
    for (const c of compras) {
      await runQuery('INSERT OR IGNORE INTO compras (id, estabelecimento_id, usuario_id, url_nfce, data_emissao, valor_total, total_itens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [c.id, c.estabelecimento_id, c.usuario_id, c.url_nfce, c.data_emissao, c.valor_total, c.total_itens, c.created_at]);
    }

    // 4. Itens da Compra
    const itens = [
      { id: 10, compra_id: 5, produto_id: 1, nome_original: "LAVA LOUCAS LIQ.YPE 6X500ML 10 D.NEUTRO", quantidade: 1, unidade: "UN", valor_unitario: 15.93, valor_total: 15.93, eh_pack: 1, pack_qtd: 6, preco_unitario_fracionado: 2.65, preco_medida_padrao: "R$ 5.30/L" },
      { id: 11, compra_id: 5, produto_id: 3, nome_original: "VISCONTI/PAO FORMA 400G.36 INTEGRAL", quantidade: 1, unidade: "UN", valor_unitario: 8.79, valor_total: 8.79, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 8.79, preco_medida_padrao: null },
      { id: 12, compra_id: 5, produto_id: 4, nome_original: "SABON.ALBANY 80G. HIDR.INTENSIVA", quantidade: 3, unidade: "UN", valor_unitario: 1.49, valor_total: 4.47, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 1.49, preco_medida_padrao: null },
      { id: 13, compra_id: 5, produto_id: 4, nome_original: "SABON.ALBANY 80G. HIDR.INTENSIVA", quantidade: 1, unidade: "UN", valor_unitario: 1.49, valor_total: 1.49, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 1.49, preco_medida_padrao: null },
      { id: 14, compra_id: 6, produto_id: 5, nome_original: "PAO FRANCES KG", quantidade: 0.364, unidade: "KG", valor_unitario: 15.494505, valor_total: 5.64, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 15.494505, preco_medida_padrao: null },
      { id: 15, compra_id: 6, produto_id: 6, nome_original: "PRESUNTO COZ CERATTI KG", quantidade: 0.114, unidade: "KG", valor_unitario: 29.912281, valor_total: 3.41, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 29.912281, preco_medida_padrao: null },
      { id: 16, compra_id: 6, produto_id: 7, nome_original: "QJO MUSS FAT KG", quantidade: 0.316, unidade: "KG", valor_unitario: 42.911392, valor_total: 13.56, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 42.911392, preco_medida_padrao: null },
      { id: 17, compra_id: 6, produto_id: 8, nome_original: "OVOS PRETI TP EXTRA BCO PVC C/ 20", quantidade: 1, unidade: "UN", valor_unitario: 9.98, valor_total: 9.98, eh_pack: 1, pack_qtd: 20, preco_unitario_fracionado: 0.5, preco_medida_padrao: null },
      { id: 18, compra_id: 7, produto_id: 9, nome_original: "BACON SEARA COZ.TABLETE kg", quantidade: 0.18, unidade: "KG", valor_unitario: 65.9, valor_total: 11.86, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 65.9, preco_medida_padrao: null },
      { id: 19, compra_id: 7, produto_id: 10, nome_original: "MARG.QUALY 500G. C/SAL", quantidade: 1, unidade: "UN", valor_unitario: 7.98, valor_total: 7.98, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 7.98, preco_medida_padrao: null },
      { id: 20, compra_id: 7, produto_id: 11, nome_original: "ATUM 88 173G/140G.SOLIDO OLEO", quantidade: 1, unidade: "UN", valor_unitario: 13.49, valor_total: 13.49, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 13.49, preco_medida_padrao: null },
      { id: 21, compra_id: 8, produto_id: 12, nome_original: "OLEO MISTO SOJA E AZEITE CASTELO 500ML", quantidade: 1, unidade: "UN", valor_unitario: 16.98, valor_total: 16.98, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 16.98, preco_medida_padrao: null },
      { id: 22, compra_id: 8, produto_id: 13, nome_original: "ALHO PICADO GARLIC 1KG", quantidade: 1, unidade: "UN", valor_unitario: 20.98, valor_total: 20.98, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 20.98, preco_medida_padrao: null },
      { id: 23, compra_id: 8, produto_id: 5, nome_original: "PAO FRANCES KG", quantidade: 0.38, unidade: "KG", valor_unitario: 15.5, valor_total: 5.89, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 15.5, preco_medida_padrao: null },
      { id: 24, compra_id: 8, produto_id: 7, nome_original: "QJO MUSS FAT KG", quantidade: 0.322, unidade: "KG", valor_unitario: 59.906832, valor_total: 19.29, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 59.906832, preco_medida_padrao: null },
      { id: 25, compra_id: 8, produto_id: 6, nome_original: "PRESUNTO COZ CERATTI KG", quantidade: 0.212, unidade: "KG", valor_unitario: 29.90566, valor_total: 6.34, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 29.90566, preco_medida_padrao: null },
      { id: 26, compra_id: 8, produto_id: 14, nome_original: "BOMBOM DA ALCATRA KG", quantidade: 0.234, unidade: "KG", valor_unitario: 76.923077, valor_total: 18, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 76.923077, preco_medida_padrao: null },
      { id: 27, compra_id: 8, produto_id: 14, nome_original: "BOMBOM DA ALCATRA KG", quantidade: 0.214, unidade: "KG", valor_unitario: 76.915888, valor_total: 16.46, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 76.915888, preco_medida_padrao: null },
      { id: 28, compra_id: 8, produto_id: 4, nome_original: "SAB ALBANY HID INTENSIVA 80G", quantidade: 1, unidade: "UN", valor_unitario: 1.68, valor_total: 1.68, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 1.68, preco_medida_padrao: null },
      { id: 29, compra_id: 8, produto_id: 4, nome_original: "SAB ALBANY HID INTENSIVA 80G", quantidade: 1, unidade: "UN", valor_unitario: 1.68, valor_total: 1.68, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 1.68, preco_medida_padrao: null },
      { id: 30, compra_id: 8, produto_id: 4, nome_original: "SAB ALBANY HID INTENSIVA 80G", quantidade: 1, unidade: "UN", valor_unitario: 1.68, valor_total: 1.68, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 1.68, preco_medida_padrao: null },
      { id: 31, compra_id: 8, produto_id: 16, nome_original: "CEBOLA KG", quantidade: 0.548, unidade: "KG", valor_unitario: 8.978102, valor_total: 4.92, eh_pack: 0, pack_qtd: 1, preco_unitario_fracionado: 8.978102, preco_medida_padrao: null }
    ];
    for (const i of itens) {
      await runQuery('INSERT OR IGNORE INTO itens_compra (id, compra_id, produto_id, nome_original, quantidade, unidade, valor_unitario, valor_total, eh_pack, pack_qtd, preco_unitario_fracionado, preco_medida_padrao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [i.id, i.compra_id, i.produto_id, i.nome_original, i.quantidade, i.unidade, i.valor_unitario, i.valor_total, i.eh_pack, i.pack_qtd, i.preco_unitario_fracionado, i.preco_medida_padrao]);
    }

    // 5. Histórico de Preços
    const hist = [
      { id: 10, produto_id: 1, estabelecimento_id: 1, compra_id: 5, valor_unitario: 15.93, preco_fracionado: 2.65, data_registro: "06/10/2026 10:51:24" },
      { id: 11, produto_id: 3, estabelecimento_id: 1, compra_id: 5, valor_unitario: 8.79, preco_fracionado: 8.79, data_registro: "06/10/2026 10:51:24" },
      { id: 12, produto_id: 4, estabelecimento_id: 1, compra_id: 5, valor_unitario: 1.49, preco_fracionado: 1.49, data_registro: "06/10/2026 10:51:24" },
      { id: 13, produto_id: 4, estabelecimento_id: 1, compra_id: 5, valor_unitario: 1.49, preco_fracionado: 1.49, data_registro: "06/10/2026 10:51:24" },
      { id: 14, produto_id: 5, estabelecimento_id: 3, compra_id: 6, valor_unitario: 15.494505, preco_fracionado: 15.494505, data_registro: "06/10/2026 16:18:00" },
      { id: 15, produto_id: 6, estabelecimento_id: 3, compra_id: 6, valor_unitario: 29.912281, preco_fracionado: 29.912281, data_registro: "06/10/2026 16:18:00" },
      { id: 16, produto_id: 7, estabelecimento_id: 3, compra_id: 6, valor_unitario: 42.911392, preco_fracionado: 42.911392, data_registro: "06/10/2026 16:18:00" },
      { id: 17, produto_id: 8, estabelecimento_id: 3, compra_id: 6, valor_unitario: 9.98, preco_fracionado: 0.5, data_registro: "06/10/2026 16:18:00" },
      { id: 18, produto_id: 9, estabelecimento_id: 1, compra_id: 7, valor_unitario: 65.9, preco_fracionado: 65.9, data_registro: "07/10/2026 11:19:25" },
      { id: 19, produto_id: 10, estabelecimento_id: 1, compra_id: 7, valor_unitario: 7.98, preco_fracionado: 7.98, data_registro: "07/10/2026 11:19:25" },
      { id: 20, produto_id: 11, estabelecimento_id: 1, compra_id: 7, valor_unitario: 13.49, preco_fracionado: 13.49, data_registro: "07/10/2026 11:19:25" },
      { id: 21, produto_id: 12, estabelecimento_id: 3, compra_id: 8, valor_unitario: 16.98, preco_fracionado: 16.98, data_registro: "30/09/2026 11:56:00" },
      { id: 22, produto_id: 13, estabelecimento_id: 3, compra_id: 8, valor_unitario: 20.98, preco_fracionado: 20.98, data_registro: "30/09/2026 11:56:00" },
      { id: 23, produto_id: 5, estabelecimento_id: 3, compra_id: 8, valor_unitario: 15.5, preco_fracionado: 15.5, data_registro: "30/09/2026 11:56:00" },
      { id: 24, produto_id: 7, estabelecimento_id: 3, compra_id: 8, valor_unitario: 59.906832, preco_fracionado: 59.906832, data_registro: "30/09/2026 11:56:00" },
      { id: 25, produto_id: 6, estabelecimento_id: 3, compra_id: 8, valor_unitario: 29.90566, preco_fracionado: 29.90566, data_registro: "30/09/2026 11:56:00" },
      { id: 26, produto_id: 14, estabelecimento_id: 3, compra_id: 8, valor_unitario: 76.923077, preco_fracionado: 76.923077, data_registro: "30/09/2026 11:56:00" },
      { id: 27, produto_id: 14, estabelecimento_id: 3, compra_id: 8, valor_unitario: 76.915888, preco_fracionado: 76.915888, data_registro: "30/09/2026 11:56:00" },
      { id: 28, produto_id: 4, estabelecimento_id: 3, compra_id: 8, valor_unitario: 1.68, preco_fracionado: 1.68, data_registro: "30/09/2026 11:56:00" },
      { id: 29, produto_id: 4, estabelecimento_id: 3, compra_id: 8, valor_unitario: 1.68, preco_fracionado: 1.68, data_registro: "30/09/2026 11:56:00" },
      { id: 30, produto_id: 4, estabelecimento_id: 3, compra_id: 8, valor_unitario: 1.68, preco_fracionado: 1.68, data_registro: "30/09/2026 11:56:00" },
      { id: 31, produto_id: 16, estabelecimento_id: 3, compra_id: 8, valor_unitario: 8.978102, preco_fracionado: 8.978102, data_registro: "30/09/2026 11:56:00" }
    ];
    for (const h of hist) {
      await runQuery('INSERT OR IGNORE INTO historico_precos (id, produto_id, estabelecimento_id, compra_id, valor_unitario, preco_fracionado, data_registro) VALUES (?, ?, ?, ?, ?, ?, ?)', [h.id, h.produto_id, h.estabelecimento_id, h.compra_id, h.valor_unitario, h.preco_fracionado, h.data_registro]);
    }

    // 6. Grupos de Comparação
    await runQuery("INSERT OR IGNORE INTO grupos_comparacao (id, nome_grupo, descricao) VALUES (1, 'Sabonetes do Dia a Dia', 'Comparativo de marcas de sabonete')");
    await runQuery('INSERT OR IGNORE INTO itens_grupo_comparacao (grupo_id, produto_id) VALUES (1, 4)');

    console.log('[Database] ✅ Histórico e notas fiscais restaurados com sucesso no banco permanente!');
  } catch (err) {
    console.warn('[Database] Aviso ao restaurar histórico inicial:', err.message);
  }
}

// Executa queries genéricas com suporte híbrido (Nuvem LibSQL / Local SQLite)
async function runQuery(sql, params = []) {
  if (libsql) {
    const res = await libsql.execute({ sql, args: params });
    return { id: Number(res.lastInsertRowid), changes: res.rowsAffected };
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

async function getQuery(sql, params = []) {
  if (libsql) {
    const res = await libsql.execute({ sql, args: params });
    if (res.rows && res.rows.length > 0) {
      return res.rows[0];
    }
    return null;
  }
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function allQuery(sql, params = []) {
  if (libsql) {
    const res = await libsql.execute({ sql, args: params });
    return res.rows || [];
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
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
    "UPDATE estabelecimentos SET nome_fantasia = ?, endereco = COALESCE(NULLIF(?, ''), endereco) WHERE id = ?",
    [estResolvido.nomeFantasia, estResolvido.endereco, estId]
  );

  const valorTotalFinal = Number(valorTotalNota) || 0.0;
  const dataFinal = dataEmissao || new Date().toISOString();

  // 2. Blindagem Anti-Duplicidade (Evita que a mesma nota seja escaneada e salva 2x)
  if (urlConsultada) {
    const compraPorUrl = await getQuery(`
      SELECT c.id, c.data_emissao, u.nome as usuario_nome, COALESCE(e.nome_fantasia, e.nome) as mercado_nome
      FROM compras c
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      LEFT JOIN estabelecimentos e ON c.estabelecimento_id = e.id
      WHERE c.url_nfce = ?
    `, [urlConsultada]);

    if (compraPorUrl) {
      const autor = compraPorUrl.usuario_nome || 'um usuário';
      const dataReg = compraPorUrl.data_emissao || 'data anterior';
      throw new Error(`Esta nota fiscal (${compraPorUrl.mercado_nome} emitida em ${dataReg}) já foi cadastrada anteriormente no sistema por ${autor}!`);
    }
  }

  if (estId && dataFinal && valorTotalFinal > 0) {
    const compraPorAssinatura = await getQuery(`
      SELECT c.id, c.data_emissao, u.nome as usuario_nome, COALESCE(e.nome_fantasia, e.nome) as mercado_nome
      FROM compras c
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      LEFT JOIN estabelecimentos e ON c.estabelecimento_id = e.id
      WHERE c.estabelecimento_id = ? AND c.data_emissao = ? AND ABS(c.valor_total - ?) < 0.01
    `, [estId, dataFinal, valorTotalFinal]);

    if (compraPorAssinatura) {
      const autor = compraPorAssinatura.usuario_nome || 'um usuário';
      throw new Error(`Esta compra exata do ${compraPorAssinatura.mercado_nome} emitida em ${compraPorAssinatura.data_emissao} já foi cadastrada por ${autor}!`);
    }
  }

  // 3. Criar registro da Compra vinculada ao Usuário
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

        // Economia real: calculada de forma justa contra o Preço Médio praticado em Atibaia
        let economiaItem = 0;
        let pctEconomia = 0;
        if (precoFracionado < precoMedio) {
          economiaItem = (precoMedio - precoFracionado) * (qtd * packQtd);
          pctEconomia = ((precoMedio - precoFracionado) / precoMedio) * 100;
          totalEconomiaCompra += economiaItem;
        }

        comparacao = {
          ultimoPreco: Number(ultimoPreco.toFixed(2)),
          ultimoMercado,
          maiorPreco: Number(maiorPreco.toFixed(2)),
          menorPreco: Number(menorPreco.toFixed(2)),
          precoMedio: Number(precoMedio.toFixed(2)),
          diffUltimo: Number(diffUltimo.toFixed(2)),
          diffMedia: Number((precoFracionado - precoMedio).toFixed(2)),
          pctDiffUltimo: Number(pctDiffUltimo.toFixed(1)),
          pctEconomia: Number(pctEconomia.toFixed(1)),
          economiaItem: Number(economiaItem.toFixed(2)),
          abaixoDaMedia: precoFracionado < precoMedio,
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

// Lista compras realizadas (estritamente privadas do usuário autenticado)
async function listarCompras(usuarioId = 1) {
  const sql = `
    SELECT c.id, c.usuario_id, c.data_emissao, c.valor_total, c.total_itens, c.economia_estimada, c.created_at,
           e.nome as estabelecimento_nome, e.nome_fantasia as estabelecimento_fantasia,
           e.cnpj as estabelecimento_cnpj, e.endereco as estabelecimento_endereco,
           u.nome as usuario_nome, u.bairro as usuario_bairro
    FROM compras c
    LEFT JOIN estabelecimentos e ON c.estabelecimento_id = e.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.usuario_id = ?
    ORDER BY c.id DESC
  `;
  const compras = await allQuery(sql, [usuarioId || 1]);
  return compras;
}

// Detalha uma compra com todos os itens, autor e análise de economia item a item
async function detalharCompra(compraId, usuarioId = null) {
  let sql = `
    SELECT c.*, e.nome as estabelecimento_nome, e.nome_fantasia as estabelecimento_fantasia,
           e.cnpj as estabelecimento_cnpj, e.endereco as estabelecimento_endereco,
           u.nome as usuario_nome, u.bairro as usuario_bairro
    FROM compras c
    LEFT JOIN estabelecimentos e ON c.estabelecimento_id = e.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
    WHERE c.id = ?
  `;
  const params = [compraId];
  if (usuarioId) {
    sql += ' AND c.usuario_id = ?';
    params.push(usuarioId);
  }

  const compra = await getQuery(sql, params);
  if (!compra) return null;

  const itens = await allQuery(`
    SELECT i.*, p.nome_padrao
    FROM itens_compra i
    JOIN produtos p ON i.produto_id = p.id
    WHERE i.compra_id = ?
    ORDER BY i.id ASC
  `, [compraId]);

  // Enriquece cada item com a comparação estatística da cidade
  const itensEnriquecidos = await Promise.all(itens.map(async (item) => {
    const historico = await allQuery(`
      SELECT h.valor_unitario, h.preco_fracionado, COALESCE(e.nome_fantasia, e.nome) as mercado
      FROM historico_precos h
      JOIN estabelecimentos e ON h.estabelecimento_id = e.id
      WHERE h.produto_id = ?
    `, [item.produto_id]);

    const precos = historico.map(h => Number(h.preco_fracionado || h.valor_unitario) || 0).filter(p => p > 0);
    const precoPago = Number(item.preco_unitario_fracionado || item.valor_unitario) || 0;
    
    let precoMedio = 0;
    let menorPreco = precoPago;
    let maiorPreco = precoPago;
    let economiaItem = 0;
    let pctEconomia = 0;
    let statusEconomia = 'sem_historico'; // 'abaixo_media', 'na_media', 'acima_media', 'sem_historico'

    if (precos.length > 1) {
      precoMedio = Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2));
      menorPreco = Number(Math.min(...precos).toFixed(2));
      maiorPreco = Number(Math.max(...precos).toFixed(2));

      if (precoPago < precoMedio) {
        const diffUnit = precoMedio - precoPago;
        economiaItem = Number((diffUnit * (item.quantidade * (item.pack_qtd || 1))).toFixed(2));
        pctEconomia = Number(((diffUnit / precoMedio) * 100).toFixed(1));
        statusEconomia = 'abaixo_media';
      } else if (precoPago > precoMedio) {
        statusEconomia = 'acima_media';
      } else {
        statusEconomia = 'na_media';
      }
    }

    return {
      ...item,
      comparacao: {
        precoMedio,
        menorPreco,
        maiorPreco,
        economiaItem,
        pctEconomia,
        statusEconomia,
        totalRegistros: precos.length
      }
    };
  }));

  return { ...compra, itens: itensEnriquecidos };
}

// Extrato Completo e Transparente de Economia (Item por Item)
async function obterExtratoEconomia(usuarioId = null) {
  let userClause = '';
  const params = [];
  if (usuarioId) {
    userClause = ' WHERE c.usuario_id = ?';
    params.push(usuarioId);
  }

  const itens = await allQuery(`
    SELECT i.id, i.nome_original, i.quantidade, i.unidade, i.valor_unitario, i.valor_total,
           i.eh_pack, i.pack_qtd, i.preco_unitario_fracionado,
           p.id as produto_id, p.nome_padrao,
           c.id as compra_id, c.data_emissao, c.usuario_id,
           e.nome as mercado_razao, COALESCE(e.nome_fantasia, e.nome) as mercado_nome,
           u.nome as usuario_nome
    FROM itens_compra i
    JOIN compras c ON i.compra_id = c.id
    JOIN produtos p ON i.produto_id = p.id
    JOIN estabelecimentos e ON c.estabelecimento_id = e.id
    LEFT JOIN usuarios u ON c.usuario_id = u.id
    ${userClause}
    ORDER BY c.id DESC, i.id ASC
  `, params);

  const extratoItens = [];
  let totalEconomiaGeral = 0;

  for (const item of itens) {
    const historico = await allQuery(`
      SELECT h.valor_unitario, h.preco_fracionado, COALESCE(e.nome_fantasia, e.nome) as mercado
      FROM historico_precos h
      JOIN estabelecimentos e ON h.estabelecimento_id = e.id
      WHERE h.produto_id = ?
    `, [item.produto_id]);

    const precos = historico.map(h => Number(h.preco_fracionado || h.valor_unitario) || 0).filter(p => p > 0);
    const precoPago = Number(item.preco_unitario_fracionado || item.valor_unitario) || 0;

    if (precos.length > 1) {
      const precoMedio = Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2));
      const menorPreco = Number(Math.min(...precos).toFixed(2));
      const maiorPreco = Number(Math.max(...precos).toFixed(2));

      if (precoPago < precoMedio) {
        const diffUnit = precoMedio - precoPago;
        const economiaTotalItem = Number((diffUnit * (item.quantidade * (item.pack_qtd || 1))).toFixed(2));
        const pctEconomia = Number(((diffUnit / precoMedio) * 100).toFixed(1));

        totalEconomiaGeral += economiaTotalItem;

        extratoItens.push({
          itemId: item.id,
          compraId: item.compra_id,
          dataEmissao: item.data_emissao,
          mercadoNome: item.mercado_nome,
          usuarioNome: item.usuario_nome,
          produtoNome: item.nome_padrao || item.nome_original,
          quantidade: item.quantidade,
          unidade: item.unidade,
          precoPago,
          precoMedio,
          maiorPreco,
          economiaTotalItem,
          pctEconomia
        });
      }
    }
  }

  // Ordena os itens onde mais se economizou no topo
  extratoItens.sort((a, b) => b.economiaTotalItem - a.economiaTotalItem);

  return {
    totalEconomia: Number(totalEconomiaGeral.toFixed(2)),
    totalItensComEconomia: extratoItens.length,
    extrato: extratoItens
  };
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

// Busca rápida e instantânea de produtos para autocompletar na lista de compras (< 10ms)
async function buscarProdutosAutocomplete(termo = '', limite = 15) {
  const t = (termo || '').trim();
  if (!t) return [];

  const termoUpper = `%${t.toUpperCase()}%`;
  const termoInicio = `${t.toUpperCase()}%`;

  const sql = `
    SELECT p.id, p.nome_padrao, p.codigo, p.unidade,
           MIN(COALESCE(h.preco_fracionado, h.valor_unitario)) as menor_preco,
           ROUND(AVG(COALESCE(h.preco_fracionado, h.valor_unitario)), 2) as preco_medio
    FROM produtos p
    LEFT JOIN historico_precos h ON p.id = h.produto_id
    WHERE UPPER(p.nome_padrao) LIKE ? OR p.codigo LIKE ?
    GROUP BY p.id
    ORDER BY
      CASE WHEN UPPER(p.nome_padrao) LIKE ? THEN 1 ELSE 2 END,
      COUNT(h.id) DESC,
      p.nome_padrao ASC
    LIMIT ?
  `;

  const prods = await allQuery(sql, [termoUpper, `%${t}%`, termoInicio, limite]);
  return prods.map(p => ({
    id: p.id,
    nome_padrao: p.nome_padrao,
    codigo: p.codigo,
    unidade: p.unidade || 'UN',
    menor_preco: p.menor_preco ? Number(Number(p.menor_preco).toFixed(2)) : 0,
    preco_medio: p.preco_medio ? Number(Number(p.preco_medio).toFixed(2)) : 0
  }));
}

// Lista produtos com paginação/limite e estatísticas sem subconsultas N+1
async function listarTodosProdutos(termoBusca = '', limite = 500) {
  let query = `
    SELECT p.id, p.nome_padrao, p.codigo, p.unidade, p.created_at,
           COUNT(DISTINCT i.compra_id) as vezes_comprado,
           COUNT(i.id) as total_itens_comprados,
           MIN(COALESCE(h.preco_fracionado, h.valor_unitario)) as menor_preco,
           MAX(COALESCE(h.preco_fracionado, h.valor_unitario)) as maior_preco,
           ROUND(AVG(COALESCE(h.preco_fracionado, h.valor_unitario)), 2) as preco_medio
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
  if (limite) {
    query += ` LIMIT ?`;
    params.push(limite);
  }

  const prods = await allQuery(query, params);

  return prods.map(prod => ({
    id: prod.id,
    nome_padrao: prod.nome_padrao,
    codigo: prod.codigo,
    unidade: prod.unidade,
    vezes_comprado: prod.vezes_comprado || 0,
    menor_preco: prod.menor_preco ? Number(Number(prod.menor_preco).toFixed(2)) : 0,
    maior_preco: prod.maior_preco ? Number(Number(prod.maior_preco).toFixed(2)) : 0,
    preco_medio: prod.preco_medio ? Number(Number(prod.preco_medio).toFixed(2)) : 0,
    ultimo_preco: prod.menor_preco ? Number(Number(prod.menor_preco).toFixed(2)) : 0,
    ultimo_mercado: '',
    melhor_mercado: ''
  }));
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

// Adicionar múltiplos produtos a um grupo de comparação de uma só vez (Bulk Add)
async function adicionarProdutosEmMassaAoGrupo(grupoId, produtoIds) {
  if (!Array.isArray(produtoIds) || produtoIds.length === 0) return { inseridos: 0 };
  let inseridos = 0;
  for (const pid of produtoIds) {
    const existe = await getQuery(
      'SELECT id FROM itens_grupo_comparacao WHERE grupo_id = ? AND produto_id = ?',
      [grupoId, pid]
    );
    if (!existe) {
      await runQuery(
        'INSERT INTO itens_grupo_comparacao (grupo_id, produto_id) VALUES (?, ?)',
        [grupoId, pid]
      );
      inseridos++;
    }
  }
  return { sucesso: true, inseridos };
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

// ==========================================
// 📋 LISTAS DE COMPRAS & OTIMIZADOR DE CESTA
// ==========================================

async function criarListaCompras(usuarioId = 1, nomeLista = 'Minha Lista de Compras') {
  const nome = (nomeLista || 'Minha Lista de Compras').trim();
  const res = await runQuery(
    'INSERT INTO listas_compras (usuario_id, nome_lista) VALUES (?, ?)',
    [usuarioId, nome]
  );
  return { id: res.id, nome_lista: nome, total_itens: 0, itens_comprados: 0 };
}

async function listarListasCompras(usuarioId = 1) {
  const listas = await allQuery(`
    SELECT l.id, l.nome_lista, l.created_at, l.updated_at,
           COUNT(i.id) as total_itens,
           SUM(CASE WHEN i.comprado = 1 THEN 1 ELSE 0 END) as itens_comprados
    FROM listas_compras l
    LEFT JOIN itens_lista_compras i ON l.id = i.lista_id
    WHERE l.usuario_id = ?
    GROUP BY l.id
    ORDER BY l.id DESC
  `, [usuarioId]);

  if (listas.length === 0) {
    const nova = await criarListaCompras(usuarioId, 'Minha Lista de Compras');
    return [{ ...nova, total_itens: 0, itens_comprados: 0, created_at: new Date().toISOString() }];
  }

  return listas;
}

async function obterListaCompras(listaId, usuarioId = 1) {
  const lista = await getQuery('SELECT * FROM listas_compras WHERE id = ? AND usuario_id = ?', [listaId, usuarioId]);
  if (!lista) return null;

  const itensRaw = await allQuery(`
    SELECT i.id as item_id, i.produto_id, i.grupo_id, i.quantidade, i.observacao, i.comprado,
           p.nome_padrao, p.codigo, p.unidade,
           g.nome_grupo
    FROM itens_lista_compras i
    LEFT JOIN produtos p ON i.produto_id = p.id
    LEFT JOIN grupos_comparacao g ON i.grupo_id = g.id
    WHERE i.lista_id = ?
    ORDER BY i.comprado ASC, i.id DESC
  `, [listaId]);

  const itens = await Promise.all(itensRaw.map(async item => {
    if (item.grupo_id) {
      // Cesta Flexível (avalia todos os produtos da cesta)
      const prodsGrupo = await allQuery(
        'SELECT produto_id FROM itens_grupo_comparacao WHERE grupo_id = ?',
        [item.grupo_id]
      );
      const pIds = prodsGrupo.map(p => p.produto_id);
      let menor = null;
      let medio = null;
      if (pIds.length > 0) {
        const placeholders = pIds.map(() => '?').join(',');
        const h = await getQuery(`
          SELECT MIN(COALESCE(preco_fracionado, valor_unitario)) as menor,
                 ROUND(AVG(COALESCE(preco_fracionado, valor_unitario)), 2) as medio
          FROM historico_precos
          WHERE produto_id IN (${placeholders})
        `, pIds);
        menor = h ? h.menor : null;
        medio = h ? h.medio : null;
      }
      return {
        ...item,
        eh_cesta: 1,
        nome_padrao: `[Cesta Flexível] ${item.nome_grupo || 'Cesta de Produtos'}`,
        unidade: 'UN',
        total_opcoes_cesta: pIds.length,
        preco_medio_cidade: medio,
        menor_preco_cidade: menor
      };
    } else {
      const h = await getQuery(`
        SELECT MIN(COALESCE(preco_fracionado, valor_unitario)) as menor,
               ROUND(AVG(COALESCE(preco_fracionado, valor_unitario)), 2) as medio
        FROM historico_precos
        WHERE produto_id = ?
      `, [item.produto_id]);
      return {
        ...item,
        eh_cesta: 0,
        preco_medio_cidade: h ? h.medio : null,
        menor_preco_cidade: h ? h.menor : null
      };
    }
  }));

  return {
    ...lista,
    itens
  };
}

async function adicionarItemListaCompras(listaId, produtoId, quantidade = 1, observacao = '', grupoId = null) {
  const qtd = parseFloat(quantidade) || 1.0;

  if (grupoId) {
    const itemExistente = await getQuery(
      'SELECT id, quantidade FROM itens_lista_compras WHERE lista_id = ? AND grupo_id = ?',
      [listaId, grupoId]
    );
    if (itemExistente) {
      const novaQtd = Number((itemExistente.quantidade + qtd).toFixed(3));
      await runQuery(
        "UPDATE itens_lista_compras SET quantidade = ?, observacao = COALESCE(NULLIF(?, ''), observacao) WHERE id = ?",
        [novaQtd, observacao, itemExistente.id]
      );
      await runQuery("UPDATE listas_compras SET updated_at = datetime('now') WHERE id = ?", [listaId]);
      return { id: itemExistente.id, atualizado: true, novaQtd };
    }
    const res = await runQuery(
      'INSERT INTO itens_lista_compras (lista_id, produto_id, grupo_id, quantidade, observacao) VALUES (?, 0, ?, ?, ?)',
      [listaId, grupoId, qtd, observacao || null]
    );
    await runQuery("UPDATE listas_compras SET updated_at = datetime('now') WHERE id = ?", [listaId]);
    return { id: res.id, criado: true };
  }

  const itemExistente = await getQuery(
    'SELECT id, quantidade FROM itens_lista_compras WHERE lista_id = ? AND produto_id = ?',
    [listaId, produtoId]
  );

  if (itemExistente) {
    const novaQtd = Number((itemExistente.quantidade + qtd).toFixed(3));
    await runQuery(
      "UPDATE itens_lista_compras SET quantidade = ?, observacao = COALESCE(NULLIF(?, ''), observacao) WHERE id = ?",
      [novaQtd, observacao, itemExistente.id]
    );
    await runQuery("UPDATE listas_compras SET updated_at = datetime('now') WHERE id = ?", [listaId]);
    return { id: itemExistente.id, atualizado: true, novaQtd };
  }

  const res = await runQuery(
    'INSERT INTO itens_lista_compras (lista_id, produto_id, quantidade, observacao) VALUES (?, ?, ?, ?)',
    [listaId, produtoId, qtd, observacao || null]
  );
  await runQuery("UPDATE listas_compras SET updated_at = datetime('now') WHERE id = ?", [listaId]);
  return { id: res.id, criado: true };
}

async function atualizarItemListaCompras(itemId, quantidade, comprado, observacao) {
  const campos = [];
  const params = [];

  if (quantidade !== undefined && quantidade !== null) {
    campos.push('quantidade = ?');
    params.push(parseFloat(quantidade) || 1.0);
  }
  if (comprado !== undefined && comprado !== null) {
    campos.push('comprado = ?');
    params.push(comprado ? 1 : 0);
  }
  if (observacao !== undefined) {
    campos.push('observacao = ?');
    params.push(observacao);
  }

  if (campos.length === 0) return { sucesso: true };

  params.push(itemId);
  await runQuery(`UPDATE itens_lista_compras SET ${campos.join(', ')} WHERE id = ?`, params);
  return { sucesso: true };
}

async function removerItemListaCompras(itemId) {
  await runQuery('DELETE FROM itens_lista_compras WHERE id = ?', [itemId]);
  return { sucesso: true };
}

async function excluirListaCompras(listaId, usuarioId = 1) {
  await runQuery('DELETE FROM itens_lista_compras WHERE lista_id = ?', [listaId]);
  await runQuery('DELETE FROM listas_compras WHERE id = ? AND usuario_id = ?', [listaId, usuarioId]);
  return { sucesso: true };
}

/**
 * Motor de Otimização e Comparação de Cesta de Compras em Atibaia
 */
async function otimizarListaCompras(listaId = null, itensAdHoc = null) {
  let itens = [];
  if (itensAdHoc && Array.isArray(itensAdHoc) && itensAdHoc.length > 0) {
    itens = itensAdHoc;
  } else if (listaId) {
    itens = await allQuery(`
      SELECT i.id as item_id, i.produto_id, i.grupo_id, i.quantidade, 
             p.nome_padrao, p.unidade, p.codigo,
             g.nome_grupo
      FROM itens_lista_compras i
      LEFT JOIN produtos p ON i.produto_id = p.id
      LEFT JOIN grupos_comparacao g ON i.grupo_id = g.id
      WHERE i.lista_id = ?
    `, [listaId]);
  }

  if (itens.length === 0) {
    return {
      totalItens: 0,
      rankingMercados: [],
      melhorMercadoUnico: null,
      cenarioDividido: null,
      comparativoItens: []
    };
  }

  // Coleta todos os produto_ids (tanto de itens diretos quanto de produtos dentro das Cestas)
  const gruposMap = new Map(); // grupo_id -> [produtos]
  const todosProdutoIdsSet = new Set();

  for (const item of itens) {
    if (item.grupo_id) {
      if (!gruposMap.has(item.grupo_id)) {
        const prods = await allQuery(`
          SELECT p.id, p.nome_padrao, p.unidade, p.codigo
          FROM itens_grupo_comparacao ig
          JOIN produtos p ON ig.produto_id = p.id
          WHERE ig.grupo_id = ?
        `, [item.grupo_id]);
        gruposMap.set(item.grupo_id, prods);
        prods.forEach(p => todosProdutoIdsSet.add(p.id));
      }
    } else if (item.produto_id) {
      todosProdutoIdsSet.add(item.produto_id);
    }
  }

  const produtoIds = Array.from(todosProdutoIdsSet);
  const placeholders = produtoIds.length > 0 ? produtoIds.map(() => '?').join(',') : '0';

  // 1. Obter todos os estabelecimentos
  const todosMercados = await allQuery('SELECT id, nome, nome_fantasia, endereco FROM estabelecimentos ORDER BY id ASC');
  const mapaMercados = new Map();
  todosMercados.forEach(m => {
    mapaMercados.set(m.id, {
      id: m.id,
      nome: m.nome_fantasia || m.nome,
      endereco: m.endereco || 'Atibaia/SP'
    });
  });

  // 2. Obter os preços mais recentes de cada produto em cada mercado
  let historico = [];
  if (produtoIds.length > 0) {
    historico = await allQuery(`
      SELECT h.produto_id, h.estabelecimento_id, h.valor_unitario, h.preco_fracionado, h.data_registro, h.id as hist_id
      FROM historico_precos h
      WHERE h.produto_id IN (${placeholders})
      ORDER BY h.id DESC
    `, produtoIds);
  }

  const mapaPrecos = new Map();
  historico.forEach(row => {
    if (!mapaPrecos.has(row.produto_id)) {
      mapaPrecos.set(row.produto_id, new Map());
    }
    const porMercado = mapaPrecos.get(row.produto_id);
    if (!porMercado.has(row.estabelecimento_id)) {
      porMercado.set(row.estabelecimento_id, {
        preco: Number(row.valor_unitario),
        precoFracionado: row.preco_fracionado ? Number(row.preco_fracionado) : Number(row.valor_unitario),
        dataRegistro: row.data_registro
      });
    }
  });

  // 3. Analisar cada item da lista (produto avulso ou Cesta Flexível)
  const comparativoItens = [];
  const mercadosComPreco = new Set();

  itens.forEach(item => {
    const qtd = parseFloat(item.quantidade) || 1.0;
    const ehCesta = !!item.grupo_id;
    const precosPorEst = {};
    let menorPrecoItem = Infinity;
    let melhorEstId = null;
    let somaPrecos = 0;
    let contPrecos = 0;

    if (ehCesta) {
      const prodsCesta = gruposMap.get(item.grupo_id) || [];
      // Para cada mercado, escolhe o produto mais barato desta Cesta naquele mercado
      todosMercados.forEach(mercado => {
        const estId = mercado.id;
        let menorPrecoMercado = Infinity;
        let prodEscolhidoMercado = null;
        let dadosEscolhido = null;

        prodsCesta.forEach(p => {
          const precosP = mapaPrecos.get(p.id);
          if (precosP && precosP.has(estId)) {
            const dp = precosP.get(estId);
            const pr = dp.precoFracionado || dp.preco;
            if (pr < menorPrecoMercado) {
              menorPrecoMercado = pr;
              prodEscolhidoMercado = p;
              dadosEscolhido = dp;
            }
          }
        });

        if (prodEscolhidoMercado && menorPrecoMercado < Infinity) {
          mercadosComPreco.add(estId);
          const estInfo = mapaMercados.get(estId);
          const subtotalItem = Number((menorPrecoMercado * qtd).toFixed(2));

          precosPorEst[estId] = {
            mercadoId: estId,
            mercadoNome: estInfo ? estInfo.nome : `Mercado #${estId}`,
            precoUnitario: menorPrecoMercado,
            subtotal: subtotalItem,
            produtoEscolhidoNome: prodEscolhidoMercado.nome_padrao,
            produtoEscolhidoId: prodEscolhidoMercado.id,
            dataRegistro: dadosEscolhido ? dadosEscolhido.dataRegistro : ''
          };

          somaPrecos += menorPrecoMercado;
          contPrecos++;

          if (menorPrecoMercado < menorPrecoItem) {
            menorPrecoItem = menorPrecoMercado;
            melhorEstId = estId;
          }
        }
      });

      const precoMedioItem = contPrecos > 0 ? Number((somaPrecos / contPrecos).toFixed(2)) : 0;

      comparativoItens.push({
        itemId: item.item_id || null,
        produtoId: null,
        grupoId: item.grupo_id,
        ehCesta: true,
        nome: `[Cesta Flexível] ${item.nome_grupo || 'Cesta de Produtos'}`,
        unidade: 'UN',
        quantidade: qtd,
        totalOpcoes: prodsCesta.length,
        precoMedio: precoMedioItem,
        menorPreco: menorPrecoItem < Infinity ? menorPrecoItem : null,
        melhorMercadoId: melhorEstId,
        melhorMercadoNome: melhorEstId && mapaMercados.get(melhorEstId) ? mapaMercados.get(melhorEstId).nome : null,
        melhorProdutoNome: melhorEstId && precosPorEst[melhorEstId] ? precosPorEst[melhorEstId].produtoEscolhidoNome : null,
        precosPorMercado: precosPorEst
      });

    } else {
      const pId = item.produto_id;
      const precosItemMercados = mapaPrecos.get(pId) || new Map();

      precosItemMercados.forEach((dadosPreco, estId) => {
        mercadosComPreco.add(estId);
        const estInfo = mapaMercados.get(estId);
        const precoUnit = dadosPreco.precoFracionado || dadosPreco.preco;
        const subtotalItem = Number((precoUnit * qtd).toFixed(2));

        precosPorEst[estId] = {
          mercadoId: estId,
          mercadoNome: estInfo ? estInfo.nome : `Mercado #${estId}`,
          precoUnitario: precoUnit,
          subtotal: subtotalItem,
          dataRegistro: dadosPreco.dataRegistro
        };

        somaPrecos += precoUnit;
        contPrecos++;

        if (precoUnit < menorPrecoItem) {
          menorPrecoItem = precoUnit;
          melhorEstId = estId;
        }
      });

      const precoMedioItem = contPrecos > 0 ? Number((somaPrecos / contPrecos).toFixed(2)) : 0;

      comparativoItens.push({
        itemId: item.item_id || null,
        produtoId: pId,
        grupoId: null,
        ehCesta: false,
        nome: item.nome_padrao,
        unidade: item.unidade || 'UN',
        quantidade: qtd,
        precoMedio: precoMedioItem,
        menorPreco: menorPrecoItem < Infinity ? menorPrecoItem : null,
        melhorMercadoId: melhorEstId,
        melhorMercadoNome: melhorEstId && mapaMercados.get(melhorEstId) ? mapaMercados.get(melhorEstId).nome : null,
        precosPorMercado: precosPorEst
      });
    }
  });

  // 4. Calcular Cesta em Cada Estabelecimento (Cenário Monomercado)
  const rankingMercados = [];

  mercadosComPreco.forEach(estId => {
    const estInfo = mapaMercados.get(estId) || { id: estId, nome: `Mercado #${estId}`, endereco: '' };
    let totalCesta = 0;
    let itensEncontrados = 0;
    const itensFaltantes = [];
    const detalhesItens = [];

    comparativoItens.forEach(item => {
      const precoEst = item.precosPorMercado[estId];
      if (precoEst) {
        totalCesta += precoEst.subtotal;
        itensEncontrados++;
        detalhesItens.push({
          produtoId: item.produtoId,
          grupoId: item.grupoId,
          ehCesta: item.ehCesta,
          nome: item.nome,
          produtoEscolhidoNome: precoEst.produtoEscolhidoNome || null,
          quantidade: item.quantidade,
          precoUnitario: precoEst.precoUnitario,
          subtotal: precoEst.subtotal,
          disponivel: true
        });
      } else {
        itensFaltantes.push({
          produtoId: item.produtoId,
          grupoId: item.grupoId,
          ehCesta: item.ehCesta,
          nome: item.nome,
          quantidade: item.quantidade
        });
        detalhesItens.push({
          produtoId: item.produtoId,
          grupoId: item.grupoId,
          ehCesta: item.ehCesta,
          nome: item.nome,
          quantidade: item.quantidade,
          precoUnitario: null,
          subtotal: null,
          disponivel: false
        });
      }
    });

    const pctDisponibilidade = Number(((itensEncontrados / comparativoItens.length) * 100).toFixed(0));

    rankingMercados.push({
      mercadoId: estId,
      mercadoNome: estInfo.nome,
      endereco: estInfo.endereco,
      totalCesta: Number(totalCesta.toFixed(2)),
      itensEncontrados,
      totalItensLista: comparativoItens.length,
      pctDisponibilidade,
      itensFaltantes,
      detalhesItens
    });
  });

  rankingMercados.sort((a, b) => {
    if (b.itensEncontrados !== a.itensEncontrados) {
      return b.itensEncontrados - a.itensEncontrados;
    }
    return a.totalCesta - b.totalCesta;
  });

  const melhorMercadoUnico = rankingMercados.length > 0 ? rankingMercados[0] : null;

  // 5. Otimização do Cenário Dividido Inteligente
  const divisaoPorMercado = {};
  let totalCenarioDividido = 0;
  let itensMapeadosDividido = 0;

  comparativoItens.forEach(item => {
    if (item.melhorMercadoId) {
      const mId = item.melhorMercadoId;
      if (!divisaoPorMercado[mId]) {
        const info = mapaMercados.get(mId) || { id: mId, nome: `Mercado #${mId}`, endereco: '' };
        divisaoPorMercado[mId] = {
          mercadoId: mId,
          mercadoNome: info.nome,
          endereco: info.endereco,
          subtotal: 0,
          itens: []
        };
      }
      const precoUnit = item.precosPorMercado[mId].precoUnitario;
      const subtotalItem = Number((precoUnit * item.quantidade).toFixed(2));
      divisaoPorMercado[mId].subtotal = Number((divisaoPorMercado[mId].subtotal + subtotalItem).toFixed(2));
      divisaoPorMercado[mId].itens.push({
        produtoId: item.produtoId,
        nome: item.nome,
        quantidade: item.quantidade,
        unidade: item.unidade,
        precoUnitario: precoUnit,
        subtotal: subtotalItem
      });

      totalCenarioDividido += subtotalItem;
      itensMapeadosDividido++;
    }
  });

  totalCenarioDividido = Number(totalCenarioDividido.toFixed(2));
  const gruposMercado = Object.values(divisaoPorMercado).sort((a, b) => b.subtotal - a.subtotal);

  let economiaVsMelhorUnico = 0;
  let pctEconomiaExtra = 0;
  if (melhorMercadoUnico && melhorMercadoUnico.totalCesta > totalCenarioDividido && melhorMercadoUnico.itensEncontrados === itensMapeadosDividido) {
    economiaVsMelhorUnico = Number((melhorMercadoUnico.totalCesta - totalCenarioDividido).toFixed(2));
    pctEconomiaExtra = Number(((economiaVsMelhorUnico / melhorMercadoUnico.totalCesta) * 100).toFixed(1));
  }

  return {
    totalItens: comparativoItens.length,
    rankingMercados,
    melhorMercadoUnico,
    cenarioDividido: {
      totalOtimizado: totalCenarioDividido,
      totalMercadosEnvolvidos: gruposMercado.length,
      gruposMercado,
      economiaVsMelhorUnico,
      pctEconomiaExtra
    },
    comparativoItens
  };
}

// Criar lista automática a partir dos produtos mais frequentes do usuário
async function gerarListaComMaisComprados(usuarioId = 1, nomeLista = 'Meus Itens Frequentes') {
  let topProdutos = await allQuery(`
    SELECT i.produto_id, COUNT(i.id) as vezes_comprado, p.nome_padrao
    FROM itens_compra i
    JOIN compras c ON i.compra_id = c.id
    JOIN produtos p ON i.produto_id = p.id
    WHERE c.usuario_id = ?
    GROUP BY i.produto_id
    ORDER BY vezes_comprado DESC
    LIMIT 15
  `, [usuarioId]);

  if (topProdutos.length < 3) {
    topProdutos = await allQuery(`
      SELECT i.produto_id, COUNT(i.id) as vezes_comprado, p.nome_padrao
      FROM itens_compra i
      JOIN produtos p ON i.produto_id = p.id
      GROUP BY i.produto_id
      ORDER BY vezes_comprado DESC
      LIMIT 15
    `);
  }

  const nome = (nomeLista || 'Meus Itens Frequentes').trim();
  const novaLista = await criarListaCompras(usuarioId, nome);

  for (const prod of topProdutos) {
    await runQuery(
      'INSERT INTO itens_lista_compras (lista_id, produto_id, quantidade) VALUES (?, ?, ?)',
      [novaLista.id, prod.produto_id, 1]
    );
  }

  return {
    ...novaLista,
    total_itens: topProdutos.length
  };
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
  obterExtratoEconomia,
  listarTodosProdutos,
  buscarProdutosAutocomplete,
  criarGrupoComparacao,
  listarGruposComparacao,
  adicionarProdutoAoGrupo,
  adicionarProdutosEmMassaAoGrupo,
  removerProdutoDoGrupo,
  excluirGrupoComparacao,
  criarListaCompras,
  listarListasCompras,
  obterListaCompras,
  adicionarItemListaCompras,
  atualizarItemListaCompras,
  removerItemListaCompras,
  excluirListaCompras,
  gerarListaComMaisComprados,
  otimizarListaCompras,
  initDb,
  runQuery,
  getQuery,
  allQuery
};
