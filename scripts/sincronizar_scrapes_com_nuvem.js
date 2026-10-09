const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_DIR = path.join(__dirname, '..', 'data', 'scrapes_poc');
const REMOTE_API = 'https://economia-supermercado-atibaia.onrender.com/api/admin/importar-scrapes';

async function main() {
  console.log('=====================================================');
  console.log('☁️ ENVIANDO SCRAPES PARA O BANCO PERMANENTE NA NUVEM');
  console.log(`🎯 URL: ${REMOTE_API}`);
  console.log('=====================================================\n');

  const pastasDatas = fs.readdirSync(BASE_DIR).filter(item => {
    const full = path.join(BASE_DIR, item);
    return fs.statSync(full).isDirectory();
  }).sort();

  let totalEnviado = 0;
  let totalNovos = 0;
  let totalPrecos = 0;

  for (const dataFolder of pastasDatas) {
    const dirData = path.join(BASE_DIR, dataFolder);
    const arquivos = fs.readdirSync(dirData).filter(f => f.endsWith('_raw.json'));

    console.log(`📅 [DATA: ${dataFolder}] Enviando ${arquivos.length} arquivos...`);

    for (const arq of arquivos) {
      const fullPath = path.join(dirData, arq);
      const conteudo = fs.readFileSync(fullPath, 'utf8');
      const itens = JSON.parse(conteudo);

      if (!Array.isArray(itens) || itens.length === 0) continue;

      // Sanitiza apenas os campos necessários para economizar banda e evitar payloads gigantes
      const itensLimpos = itens.map(it => ({
        mercado: it.mercado,
        nome: it.nome,
        preco_varejo: it.preco_varejo || it.preco,
        ean: it.ean,
        data_coleta: it.data_coleta
      }));

      // Envia em lotes de 50 itens
      const TAMANHO_LOTE = 50;
      for (let i = 0; i < itensLimpos.length; i += TAMANHO_LOTE) {
        const chunk = itensLimpos.slice(i, i + TAMANHO_LOTE);
        process.stdout.write(`   Enviando ${arq} [itens ${i + 1} a ${Math.min(i + TAMANHO_LOTE, itensLimpos.length)}]... `);
        
        try {
          const res = await axios.post(REMOTE_API, { itens: chunk }, { timeout: 60000 });
          if (res.data && res.data.sucesso) {
            const r = res.data.resultado;
            totalEnviado += r.totalItensLote;
            totalNovos += r.novosProdutos;
            totalPrecos += r.precosInseridos;
            console.log(`✅ (${r.novosProdutos} novos, ${r.precosInseridos} preços)`);
          } else {
            console.log(`⚠️ Resposta:`, res.data);
          }
        } catch (err) {
          const errMsg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
          console.log(`❌ Erro:`, errMsg);
        }
      }
    }
    console.log('');
  }

  console.log('=====================================================');
  console.log('🎉 SINCRONIZAÇÃO COM A NUVEM CONCLUÍDA!');
  console.log(`* Total de registros enviados: ${totalEnviado}`);
  console.log(`* Novos produtos adicionados: ${totalNovos}`);
  console.log(`* Preços registrados no histórico permanente: ${totalPrecos}`);
  console.log('=====================================================');
}

main().catch(err => {
  console.error('Erro na sincronização:', err);
});
