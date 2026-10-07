/**
 * Módulo para Identificação e Resolução de Estabelecimentos (Nome Fantasia e Endereço)
 */

const DICIONARIO_SUPERMERCADOS = {
  // Nagumo Atibaia
  '00386708000475': {
    nomeFantasia: 'Nagumo (Lucas)',
    endereco: 'Av. Lucas Nogueira Garcez, 2827 - Vila Giglio, Atibaia - SP'
  },
  '00386708000122': {
    nomeFantasia: 'Nagumo (Centro)',
    endereco: 'Rua José Lucas, 100 - Centro, Atibaia - SP'
  },
  '45543915000181': {
    nomeFantasia: 'Nagumo (Supermercado)',
    endereco: 'Atibaia - SP'
  },

  // União Supermercados Atibaia
  '72995475001067': {
    nomeFantasia: 'União (Alvinópolis)',
    endereco: 'Av. Dona Gertrudes, 747 - Alvinópolis, Atibaia - SP'
  },
  '72995475000176': {
    nomeFantasia: 'União (Centro)',
    endereco: 'Rua José Pires, 55 - Centro, Atibaia - SP'
  },
  '72995475000923': {
    nomeFantasia: 'União (Jd. Imperial)',
    endereco: 'Av. Imperial, 650 - Jd. Imperial, Atibaia - SP'
  },

  // Outros Supermercados Conhecidos da Região
  '47508411000156': {
    nomeFantasia: 'Supermercado Big',
    endereco: 'Rua Thomé Franco, 450 - Centro, Atibaia - SP'
  },
  '50066141000108': {
    nomeFantasia: 'Covabra Supermercados',
    endereco: 'Av. Prof. Flávio Pires de Camargo, 600 - Caetetuba, Atibaia - SP'
  },
  '60772496000188': {
    nomeFantasia: 'Atacadão',
    endereco: 'Rod. Fernão Dias, km 38 - Atibaia - SP'
  }
};

// Resolve o Nome Fantasia e Endereço por CNPJ ou consulta na Receita Federal
async function resolverEstabelecimento(cnpjRaw, razaoSocial, enderecoSeHouver) {
  const cnpjLimpo = (cnpjRaw || '').replace(/[^\d]/g, '');
  
  if (cnpjLimpo && DICIONARIO_SUPERMERCADOS[cnpjLimpo]) {
    return {
      nomeFantasia: DICIONARIO_SUPERMERCADOS[cnpjLimpo].nomeFantasia,
      endereco: enderecoSeHouver || DICIONARIO_SUPERMERCADOS[cnpjLimpo].endereco,
      cnpj: cnpjLimpo
    };
  }

  // Fallback heurístico por razão social
  const razaoUpper = (razaoSocial || '').toUpperCase();
  if (razaoUpper.includes('COMERCIAL BRASIL')) {
    return {
      nomeFantasia: 'Nagumo (Lucas)',
      endereco: enderecoSeHouver || 'Av. Lucas Nogueira Garcez, 2827 - Atibaia - SP',
      cnpj: cnpjLimpo
    };
  }
  if (razaoUpper.includes('UNIAO SUPERMERCADO') || razaoUpper.includes('UNISUPER')) {
    return {
      nomeFantasia: 'União Supermercados',
      endereco: enderecoSeHouver || 'Atibaia - SP',
      cnpj: cnpjLimpo
    };
  }

  // Fallback consulta online Receita Federal para novos CNPJs
  if (cnpjLimpo && cnpjLimpo.length === 14) {
    try {
      const resp = await fetch(`https://minhareceita.org/${cnpjLimpo}`, { timeout: 3000 });
      if (resp.ok) {
        const data = await resp.json();
        const nomeRec = data.nome_fantasia || data.razao_social || razaoSocial;
        const endRec = `${data.descricao_tipo_de_logradouro || ''} ${data.logradouro || ''}, ${data.numero || ''} - ${data.bairro || ''}, ${data.municipio || ''} - ${data.uf || ''}`.trim();
        return {
          nomeFantasia: nomeRec,
          endereco: enderecoSeHouver || endRec,
          cnpj: cnpjLimpo
        };
      }
    } catch (e) {
      // Ignora erro de rede e usa fallback local
    }
  }

  return {
    nomeFantasia: razaoSocial || 'Supermercado',
    endereco: enderecoSeHouver || '',
    cnpj: cnpjLimpo
  };
}

module.exports = {
  DICIONARIO_SUPERMERCADOS,
  resolverEstabelecimento
};
