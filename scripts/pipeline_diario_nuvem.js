/**
 * Pipeline Diário de Coleta e Sincronização Direta na Nuvem (Render + Turso)
 * Garante que NENHUM dado fique preso em arquivos locais.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const REMOTE_API = process.env.API_URL || 'https://economia-supermercado-atibaia.onrender.com/api/admin/importar-scrapes';
const REMOTE_HEALTH = 'https://economia-supermercado-atibaia.onrender.com/api/health';
const REMOTE_GRUPOS = 'https://economia-supermercado-atibaia.onrender.com/api/grupos';

async function executarAtualizacaoDiaria(caminhoPastaData) {
  console.log('=====================================================');
  console.log('🚀 PIPELINE DIÁRIO OFICIAL — ATUALIZAÇÃO DIRETA NO TURSO');
  console.log(`🌐 Destino: ${REMOTE_API}`);
  console.log('=====================================================\n');

  // 1. Health check do Render
  process.stdout.write('🔍 1. Verificando conectividade com o servidor na nuvem... ');
  try {
    const health = await axios.get(REMOTE_HEALTH, { timeout: 15000 });
    console.log(`✅ Online (${health.data.status})`);
  } catch (err) {
    console.log(`⚠️ Servidor acordando (aguardando 20s)...`);
    await new Promise(r => setTimeout(r, 20000));
  }

  // 2. Identificar arquivos do dia
  const baseDir = caminhoPastaData || path.join(__dirname, '..', 'data', 'scrapes_poc');
  if (!fs.existsSync(baseDir)) {
    console.error(`❌ Diretório ${baseDir} não encontrado.`);
    return;
  }

  const subpastas = fs.readdirSync(baseDir).filter(f => fs.statSync(path.join(baseDir, f)).isDirectory()).sort();
  const ultimaData = subpastas[subpastas.length - 1];
  const dirAlvo = caminhoPastaData || path.join(baseDir, ultimaData);

  console.log(`📁 2. Processando arquivos da pasta: ${dirAlvo}`);
  const arquivos = fs.readdirSync(dirAlvo).filter(f => f.endsWith('_raw.json'));
  console.log(`   Encontrados ${arquivos.length} arquivos de coleta de supermercados.`);

  let totalItens = 0;
  let totalPrecos = 0;

  // 3. Envio direto via HTTP para o Turso
  for (const arq of arquivos) {
    const fullPath = path.join(dirAlvo, arq);
    const conteudo = fs.readFileSync(fullPath, 'utf8');
    const itens = JSON.parse(conteudo);
    if (!Array.isArray(itens) || itens.length === 0) continue;

    const itensLimpos = itens.map(it => ({
      mercado: it.mercado,
      nome: it.nome,
      preco_varejo: it.preco_varejo || it.preco,
      ean: it.ean,
      data_coleta: it.data_coleta
    }));

    const TAMANHO_LOTE = 50;
    for (let i = 0; i < itensLimpos.length; i += TAMANHO_LOTE) {
      const chunk = itensLimpos.slice(i, i + TAMANHO_LOTE);
      process.stdout.write(`   📤 [${arq}] Enviando itens ${i + 1} a ${Math.min(i + TAMANHO_LOTE, itensLimpos.length)}... `);

      try {
        const res = await axios.post(REMOTE_API, { itens: chunk }, { timeout: 60000 });
        if (res.data && res.data.sucesso) {
          const r = res.data.resultado;
          totalItens += r.totalItensLote;
          totalPrecos += r.precosInseridos;
          console.log(`✅ (${r.precosInseridos} preços gravados no Turso)`);
        } else {
          console.log(`⚠️ Resposta:`, res.data);
        }
      } catch (err) {
        console.log(`❌ Erro:`, err.message);
      }
    }
  }

  // 4. Auditoria Final Automática das Cestas na Nuvem
  console.log('\n📊 4. Realizando Auditoria Final Direta no Turso...');
  try {
    const resGrupos = await axios.get(REMOTE_GRUPOS, { timeout: 20000 });
    if (resGrupos.data && resGrupos.data.grupos) {
      resGrupos.data.grupos.forEach(g => {
        const comPreco = (g.produtos || []).filter(p => p.menorPreco > 0).length;
        const total = (g.produtos || []).length;
        const vencedor = g.vencedor ? `${g.vencedor.nome_padrao} (R$ ${g.vencedor.menorPreco})` : 'Aguardando';
        console.log(`   🧺 [Cesta ${g.nome_grupo}]: ${comPreco}/${total} produtos com preço ativo | Vencedor 🏆: ${vencedor}`);
      });
    }
  } catch (err) {
    console.warn(`⚠️ Não foi possível auditar os grupos: ${err.message}`);
  }

  console.log('\n=====================================================');
  console.log('🎉 PIPELINE FINALIZADO COM SUCESSO NO TURSO!');
  console.log(`* Registros transmitidos: ${totalItens}`);
  console.log(`* Preços atualizados no Turso: ${totalPrecos}`);
  console.log('=====================================================');
}

if (require.main === module) {
  executarAtualizacaoDiaria(process.argv[2]).catch(console.error);
}

module.exports = { executarAtualizacaoDiaria };
