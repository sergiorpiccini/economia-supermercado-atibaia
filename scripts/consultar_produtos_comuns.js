const db = require('../database');

async function main() {
  await db.initDb();

  const prodsMulti = await db.allQuery(`
    SELECT p.id, p.nome_padrao, p.unidade,
           COUNT(DISTINCT h.estabelecimento_id) as total_mercados,
           GROUP_CONCAT(DISTINCT COALESCE(e.nome_fantasia, e.nome) || ': R$ ' || ROUND(h.valor_unitario, 2)) as precos
    FROM produtos p
    JOIN historico_precos h ON p.id = h.produto_id
    JOIN estabelecimentos e ON h.estabelecimento_id = e.id
    GROUP BY p.id
    HAVING total_mercados > 1
    ORDER BY total_mercados DESC, p.nome_padrao ASC
    LIMIT 30
  `);

  console.log(`\n📦 Encontrados ${prodsMulti.length} produtos com preços em múltiplos mercados:\n`);
  prodsMulti.forEach(p => {
    console.log(`• [${p.nome_padrao}] (${p.unidade || 'UN'})`);
    console.log(`  └─> ${p.precos.split(',').join(' | ')}\n`);
  });
}

main().catch(console.error);
