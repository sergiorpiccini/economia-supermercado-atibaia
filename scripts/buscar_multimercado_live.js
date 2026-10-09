const axios = require('axios');

async function main() {
  const termos = ['arroz', 'feijao', 'leite', 'cafe', 'oleo', 'acucar', 'sabonete', 'detergente', 'manteiga', 'margarina', 'azeite', 'cerveja', 'refrigerante', 'farinha', 'macarrao'];
  
  console.log('🔍 Buscando produtos cadastrados em múltiplos mercados na produção (Render/Turso)...\n');

  for (const t of termos) {
    try {
      const res = await axios.get(`https://economia-supermercado-atibaia.onrender.com/api/produtos?q=${encodeURIComponent(t)}`);
      const prods = res.data.produtos || [];
      
      for (const p of prods.slice(0, 5)) {
        const histRes = await axios.get(`https://economia-supermercado-atibaia.onrender.com/api/produtos/${p.id}/historico`);
        const hData = histRes.data;
        if (hData && hData.historico && hData.historico.length > 0) {
          const mercados = [...new Set(hData.historico.map(h => h.estabelecimento_nome))];
          if (mercados.length > 1) {
            console.log(`✅ PRODUTO MULTI-MERCADO ENCONTRADO:`);
            console.log(`   Nome: "${p.nome_padrao}"`);
            console.log(`   Mercados (${mercados.length}): ${mercados.join(' vs ')}`);
            hData.historico.forEach(h => {
              console.log(`   - ${h.estabelecimento_nome}: R$ ${h.preco_fracionado || h.valor_unitario} (${h.data_registro})`);
            });
            console.log('');
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }
}

main().catch(console.error);
