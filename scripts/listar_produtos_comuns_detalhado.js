const axios = require('axios');

async function main() {
  const res = await axios.get('https://economia-supermercado-atibaia.onrender.com/api/produtos');
  const prods = res.data.produtos || [];
  console.log(`Total de produtos: ${prods.length}`);

  // Itens com mesmo EAN ou mesmo nome
  const porEan = {};
  const porNome = {};

  prods.forEach(p => {
    if (p.codigo && p.codigo.length > 6) {
      if (!porEan[p.codigo]) porEan[p.codigo] = [];
      porEan[p.codigo].push(p);
    }
  });

  console.log('\n--- Produtos com EANs coincidentes ---');
  let count = 0;
  for (const [ean, list] of Object.entries(porEan)) {
    if (list.length > 1) {
      count++;
      console.log(`EAN ${ean}:`);
      list.forEach(p => console.log(`  - ID ${p.id}: ${p.nome_padrao}`));
    }
  }
  console.log(`Total coincidentes por EAN: ${count}`);

  // Testar busca por termos comuns do dia a dia
  const termos = ['Arroz', 'Feijão', 'Óleo', 'Leite', 'Café', 'Sabonete', 'Manteiga', 'Detergente', 'Açúcar', 'Macarrão', 'Cerveja', 'Coca-Cola', 'Papel Higiênico'];
  console.log('\n--- Sugestões de Produtos e Variações ---');
  for (const t of termos) {
    const matches = prods.filter(p => p.nome_padrao.toLowerCase().includes(t.toLowerCase())).slice(0, 3);
    if (matches.length > 0) {
      console.log(`\n📌 Categoria: ${t}`);
      matches.forEach(m => {
        console.log(`   • "${m.nome_padrao}" (Menor: R$ ${m.menor_preco || '--'} | Média: R$ ${m.preco_medio || '--'})`);
      });
    }
  }
}

main().catch(console.error);
