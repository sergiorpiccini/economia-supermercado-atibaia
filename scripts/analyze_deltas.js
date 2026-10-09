/**
 * ANALISADOR DE DELTAS E VARIAÇÕES DE PREÇO (PoC - ETAPA 2)
 * Compara as coletas de ontem (Dia 1) com as de hoje (Dia 2).
 * Gera estatísticas de flutuação, promoções e novos produtos.
 */

const fs = require('fs');
const path = require('path');

const DIA_1 = process.argv[2] || '2026-10-07';
const DIA_2 = process.argv[3] || '2026-10-08';

const DIR_1 = path.join(__dirname, '..', 'data', 'scrapes_poc', DIA_1);
const DIR_2 = path.join(__dirname, '..', 'data', 'scrapes_poc', DIA_2);

function carregarJson(dir, arquivo) {
  const p = path.join(dir, arquivo);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function analisarMercado(nomeMercado, produtosDia1, produtosDia2) {
  const map1 = new Map();
  produtosDia1.forEach(p => map1.set(p.id_loja_origem || p.nome, p));

  const map2 = new Map();
  produtosDia2.forEach(p => map2.set(p.id_loja_origem || p.nome, p));

  const reducoes = [];
  const aumentos = [];
  const inalterados = [];
  const novosProdutos = [];
  const removidos = [];

  // Analisar produtos do Dia 2 contra Dia 1
  for (const [id, p2] of map2.entries()) {
    if (map1.has(id)) {
      const p1 = map1.get(id);
      const pr1 = p1.preco_varejo;
      const pr2 = p2.preco_varejo;

      if (pr1 !== null && pr2 !== null) {
        const diff = pr2 - pr1;
        const diffPerc = ((diff / pr1) * 100).toFixed(1);

        if (diff < -0.009) {
          reducoes.push({
            id,
            nome: p2.nome,
            marca: p2.marca,
            precoAnterior: pr1,
            precoAtual: pr2,
            diferenca: diff,
            percentual: `${diffPerc}%`
          });
        } else if (diff > 0.009) {
          aumentos.push({
            id,
            nome: p2.nome,
            marca: p2.marca,
            precoAnterior: pr1,
            precoAtual: pr2,
            diferenca: diff,
            percentual: `+${diffPerc}%`
          });
        } else {
          inalterados.push({
            id,
            nome: p2.nome,
            marca: p2.marca,
            preco: pr2
          });
        }
      } else {
        inalterados.push({ id, nome: p2.nome, marca: p2.marca, preco: pr2 });
      }
    } else {
      novosProdutos.push({
        id,
        nome: p2.nome,
        marca: p2.marca,
        precoAtual: p2.preco_varejo
      });
    }
  }

  // Identificar removidos (estavam no Dia 1 e não no Dia 2)
  for (const [id, p1] of map1.entries()) {
    if (!map2.has(id)) {
      removidos.push({
        id,
        nome: p1.nome,
        marca: p1.marca,
        precoAnterior: p1.preco_varejo
      });
    }
  }

  return {
    mercado: nomeMercado,
    totalDia1: produtosDia1.length,
    totalDia2: produtosDia2.length,
    totalReducoes: reducoes.length,
    totalAumentos: aumentos.length,
    totalInalterados: inalterados.length,
    totalNovos: novosProdutos.length,
    totalRemovidos: removidos.length,
    amostraReducoes: reducoes.slice(0, 10),
    amostraAumentos: aumentos.slice(0, 10),
    amostraNovos: novosProdutos.slice(0, 10)
  };
}

async function runAnalise() {
  console.log(`\n=============================================================================`);
  console.log(`📊 ANALISADOR DE VARIAÇÕES (DELTAS) ENTRE RODADAS`);
  console.log(`Comparando: [Dia 1: ${DIA_1}]  VS  [Dia 2: ${DIA_2}]`);
  console.log(`=============================================================================\n`);

  if (!fs.existsSync(DIR_1)) {
    console.error(`❌ Diretório do Dia 1 não encontrado: ${DIR_1}`);
    return;
  }
  if (!fs.existsSync(DIR_2)) {
    console.error(`❌ Diretório do Dia 2 não encontrado: ${DIR_2}`);
    return;
  }

  const nagumo1 = carregarJson(DIR_1, 'nagumo_atibaia_raw.json');
  const nagumo2 = carregarJson(DIR_2, 'nagumo_atibaia_raw.json');

  const atacadao1 = carregarJson(DIR_1, 'atacadao_atibaia_raw.json');
  const atacadao2 = carregarJson(DIR_2, 'atacadao_atibaia_raw.json');

  const pda1 = carregarJson(DIR_1, 'paodeacucar_atibaia_raw.json');
  const pda2 = carregarJson(DIR_2, 'paodeacucar_atibaia_raw.json');

  const analiseNagumo = analisarMercado('Nagumo (Loja 032 Atibaia)', nagumo1, nagumo2);
  const analiseAtacadao = analisarMercado('Atacadão (Fernão Dias Atibaia)', atacadao1, atacadao2);
  const analisePda = analisarMercado('Pão de Açúcar (Lucas Garcez)', pda1, pda2);

  const consolidados = [analiseNagumo, analiseAtacadao, analisePda];

  console.log(`\n📈 QUADRO CONSOLIDADO DE FLUTUAÇÕES:`);
  console.table(consolidados.map(c => ({
    Estabelecimento: c.mercado,
    'Dia 1 (Itens)': c.totalDia1,
    'Dia 2 (Itens)': c.totalDia2,
    'Quedas (R$)': c.totalReducoes,
    'Altas (R$)': c.totalAumentos,
    Inalterados: c.totalInalterados,
    'Novos Itens': c.totalNovos,
    'Fora de Estoque': c.totalRemovidos
  })));

  // Exibir amostras de flutuação se houver
  for (const c of consolidados) {
    if (c.totalReducoes > 0) {
      console.log(`\n🟢 [${c.mercado}] Destaques de Redução de Preço:`);
      console.table(c.amostraReducoes.map(r => ({
        Produto: r.nome.slice(0, 45),
        Marca: r.marca,
        'Antes (R$)': `R$ ${r.precoAnterior.toFixed(2)}`,
        'Agora (R$)': `R$ ${r.precoAtual.toFixed(2)}`,
        Variação: r.percentual
      })));
    }
    if (c.totalAumentos > 0) {
      console.log(`\n🔴 [${c.mercado}] Destaques de Aumento de Preço:`);
      console.table(c.amostraAumentos.map(a => ({
        Produto: a.nome.slice(0, 45),
        Marca: a.marca,
        'Antes (R$)': `R$ ${a.precoAnterior.toFixed(2)}`,
        'Agora (R$)': `R$ ${a.precoAtual.toFixed(2)}`,
        Variação: a.percentual
      })));
    }
    if (c.totalNovos > 0) {
      console.log(`\n✨ [${c.mercado}] Amostra de Novos Produtos Detectados:`);
      console.table(c.amostraNovos.slice(0, 5).map(n => ({
        Produto: n.nome.slice(0, 45),
        Marca: n.marca,
        'Preço (R$)': n.precoAtual ? `R$ ${n.precoAtual.toFixed(2)}` : 'N/D'
      })));
    }
  }

  // Salvar relatório consolidado
  const relatorioPath = path.join(DIR_2, 'relatorio_delta_comparativo.json');
  fs.writeFileSync(relatorioPath, JSON.stringify(consolidados, null, 2), 'utf-8');
  console.log(`\n💾 Relatório de variação salvo em: ${relatorioPath}\n`);
}

runAnalise();
