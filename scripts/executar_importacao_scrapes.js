const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../database');
const { processarLoteScrape } = require('../importerScrapes');

const BASE_DIR = path.join(__dirname, '..', 'data', 'scrapes_poc');
const REMOTE_API = process.env.API_URL || 'https://economia-supermercado-atibaia.onrender.com/api/admin/importar-scrapes';
const MODO_DIRETO_BD = true; // Executa direto no database.js conectado (Turso ou Local)

async function main() {
  console.log('=====================================================');
  console.log('🚀 INICIANDO IMPORTAÇÃO DE SCRAPES PARA O BANCO');
  console.log(`📁 Diretório base: ${BASE_DIR}`);
  console.log('=====================================================\n');

  if (!fs.existsSync(BASE_DIR)) {
    console.error('❌ Diretório data/scrapes_poc não encontrado!');
    return;
  }

  const pastasDatas = fs.readdirSync(BASE_DIR).filter(item => {
    const full = path.join(BASE_DIR, item);
    return fs.statSync(full).isDirectory();
  }).sort();

  console.log(`📅 Datas encontradas para importação: ${pastasDatas.join(', ')}\n`);

  let totalGeralProcessado = 0;
  let totalNovosProdutos = 0;
  let totalPrecosInseridos = 0;

  for (const dataFolder of pastasDatas) {
    const dirData = path.join(BASE_DIR, dataFolder);
    const arquivos = fs.readdirSync(dirData).filter(f => f.endsWith('_raw.json'));

    console.log(`--- [DATA: ${dataFolder}] Processando ${arquivos.length} arquivos... ---`);

    for (const arq of arquivos) {
      const fullPath = path.join(dirData, arq);
      try {
        const conteudo = fs.readFileSync(fullPath, 'utf8');
        const itens = JSON.parse(conteudo);

        if (!Array.isArray(itens) || itens.length === 0) {
          console.log(`  ⏩ ${arq}: vazio ou sem itens.`);
          continue;
        }

        console.log(`  📦 Importando ${itens.length} itens de: ${arq}...`);

        if (MODO_DIRETO_BD) {
          // Processa direto usando database.js
          const res = await processarLoteScrape(itens, db);
          totalGeralProcessado += res.totalItensLote;
          totalNovosProdutos += res.novosProdutos;
          totalPrecosInseridos += res.precosInseridos;
          console.log(`     ✅ Concluído: ${res.novosProdutos} novos produtos, ${res.precosInseridos} preços registrados.`);
        } else {
          // Envia via API remota
          const res = await axios.post(REMOTE_API, { itens }, { timeout: 60000 });
          if (res.data && res.data.sucesso) {
            const r = res.data.resultado;
            totalGeralProcessado += r.totalItensLote;
            totalNovosProdutos += r.novosProdutos;
            totalPrecosInseridos += r.precosInseridos;
            console.log(`     ✅ Concluído via API: ${r.novosProdutos} novos produtos, ${r.precosInseridos} preços registrados.`);
          }
        }
      } catch (err) {
        console.error(`  ❌ Erro ao processar ${arq}:`, err.message);
      }
    }
    console.log('');
  }

  console.log('=====================================================');
  console.log('🎉 RESUMO FINAL DA IMPORTAÇÃO');
  console.log(`* Total de registros processados: ${totalGeralProcessado}`);
  console.log(`* Novos produtos únicos adicionados ao catálogo: ${totalNovosProdutos}`);
  console.log(`* Históricos de preços registrados: ${totalPrecosInseridos}`);
  console.log('=====================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('Erro fatal na importação:', err);
  process.exit(1);
});
