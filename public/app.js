// Estado global da aplicação
let html5QrCode = null;
let lastExtractionResult = null;
let currentView = 'scanner';
let filtroComprasAtual = 'minhas'; // 'minhas' ou 'todas'

// Autenticação & Usuários
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
let authToken = localStorage.getItem('authToken') || '';

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  await inicializarUsuario();
});

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

// Inicializa usuário logado ou faz login inicial
async function inicializarUsuario() {
  const headerContainer = document.getElementById('user-header-container');
  if (!headerContainer) return;

  if (authToken) {
    try {
      const response = await fetch('/api/auth/me', { headers: getAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        currentUser = data.usuario;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      } else {
        executarLogout(false);
      }
    } catch (e) {
      console.warn("Erro ao checar usuário:", e);
    }
  }

  // Auto-login no primeiro acesso se ainda não tiver conta
  if (!currentUser) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@atibaia.com', senha: '123456' })
      });
      const data = await res.json();
      if (data.sucesso) {
        currentUser = data.usuario;
        authToken = data.token;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        localStorage.setItem('authToken', authToken);
      }
    } catch (err) {}
  }

  renderizarUserHeader();
}

function renderizarUserHeader() {
  const headerContainer = document.getElementById('user-header-container');
  if (!headerContainer) return;

  if (currentUser) {
    const primeiroNome = currentUser.nome ? currentUser.nome.split(' ')[0] : 'Usuário';
    const bairroTexto = currentUser.bairro ? ` • ${currentUser.bairro}` : '';
    headerContainer.innerHTML = `
      <button onclick="abrirModalAuth()" class="flex items-center gap-1.5 bg-emerald-700/90 hover:bg-emerald-800 text-white px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition border border-emerald-500/80 shadow-xs" title="Perfil / Trocar de Conta">
        <i data-lucide="user-check" class="w-3.5 h-3.5 text-emerald-200"></i>
        <span class="max-w-[130px] truncate">${escapeHtml(primeiroNome)}${escapeHtml(bairroTexto)}</span>
      </button>
    `;
  } else {
    headerContainer.innerHTML = `
      <button onclick="abrirModalAuth()" class="flex items-center gap-1 bg-white hover:bg-slate-100 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-xs">
        <i data-lucide="log-in" class="w-3.5 h-3.5"></i> Entrar
      </button>
    `;
  }
  lucide.createIcons();
}

// Modal de Autenticação
function abrirModalAuth() {
  document.getElementById('auth-login-erro').classList.add('hidden');
  document.getElementById('auth-cad-erro').classList.add('hidden');
  document.getElementById('auth-modal').classList.remove('hidden');
}

function fecharModalAuth() {
  document.getElementById('auth-modal').classList.add('hidden');
}

function alternarAbaAuth(aba) {
  const tabLogin = document.getElementById('auth-tab-login');
  const tabCad = document.getElementById('auth-tab-cadastro');
  const formLogin = document.getElementById('auth-form-login');
  const formCad = document.getElementById('auth-form-cadastro');

  if (aba === 'login') {
    tabLogin.className = "flex-1 py-2 rounded-lg bg-white text-emerald-700 font-bold shadow-xs transition";
    tabCad.className = "flex-1 py-2 rounded-lg text-slate-600 hover:text-slate-900 transition";
    formLogin.classList.remove('hidden');
    formCad.classList.add('hidden');
  } else {
    tabCad.className = "flex-1 py-2 rounded-lg bg-white text-emerald-700 font-bold shadow-xs transition";
    tabLogin.className = "flex-1 py-2 rounded-lg text-slate-600 hover:text-slate-900 transition";
    formCad.classList.remove('hidden');
    formLogin.classList.add('hidden');
  }
}

async function executarLogin() {
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value.trim();
  const erroDiv = document.getElementById('auth-login-erro');
  erroDiv.classList.add('hidden');

  if (!email || !senha) {
    erroDiv.textContent = "Informe seu e-mail e senha.";
    erroDiv.classList.remove('hidden');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);

    currentUser = data.usuario;
    authToken = data.token;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('authToken', authToken);

    fecharModalAuth();
    renderizarUserHeader();
    carregarComprasSalvas();
    carregarMetricas();
    alert(`Bem-vindo de volta, ${currentUser.nome}!`);
  } catch (err) {
    erroDiv.textContent = err.message;
    erroDiv.classList.remove('hidden');
  }
}

async function executarCadastro() {
  const nome = document.getElementById('cad-nome').value.trim();
  const email = document.getElementById('cad-email').value.trim();
  const bairro = document.getElementById('cad-bairro').value.trim();
  const senha = document.getElementById('cad-senha').value.trim();
  const erroDiv = document.getElementById('auth-cad-erro');
  erroDiv.classList.add('hidden');

  if (!nome || !email || !senha) {
    erroDiv.textContent = "Nome, e-mail e senha são obrigatórios.";
    erroDiv.classList.remove('hidden');
    return;
  }

  try {
    const response = await fetch('/api/auth/cadastro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, bairro, senha })
    });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);

    currentUser = data.usuario;
    authToken = data.token;
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('authToken', authToken);

    fecharModalAuth();
    renderizarUserHeader();
    carregarComprasSalvas();
    carregarMetricas();
    alert(`Conta criada com sucesso! Bem-vindo(a), ${currentUser.nome}!`);
  } catch (err) {
    erroDiv.textContent = err.message;
    erroDiv.classList.remove('hidden');
  }
}

function executarLogout(notificar = true) {
  currentUser = null;
  authToken = '';
  localStorage.removeItem('currentUser');
  localStorage.removeItem('authToken');
  fecharModalAuth();
  renderizarUserHeader();
  if (notificar) alert("Você saiu da sua conta.");
  carregarComprasSalvas();
  carregarMetricas();
}

// Alternar Filtro de Compras (Minhas Notas vs Todas da Comunidade)
function alternarFiltroCompras(filtro) {
  filtroComprasAtual = filtro;
  const btnMinhas = document.getElementById('btn-filtro-minhas');
  const btnTodas = document.getElementById('btn-filtro-todas');
  const sub = document.getElementById('compras-sub-filtro');

  if (filtro === 'minhas') {
    btnMinhas.className = "px-3 py-1.5 rounded-lg bg-white text-emerald-700 shadow-xs font-bold transition";
    btnTodas.className = "px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition";
    sub.textContent = "Notas fiscais escaneadas por você";
  } else {
    btnTodas.className = "px-3 py-1.5 rounded-lg bg-white text-emerald-700 shadow-xs font-bold transition";
    btnMinhas.className = "px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition";
    sub.textContent = "Feed de compras de toda a rede colaborativa de Atibaia";
  }
  carregarComprasSalvas();
}

// Navegação entre Telas Principais (Escanear / Minhas Compras / Preços & Economia)
function navigateView(view) {
  currentView = view;
  ['scanner', 'compras', 'historico'].forEach(v => {
    document.getElementById(`view-${v}`).classList.add('hidden');
    const tab = document.getElementById(`nav-${v}`);
    tab.classList.remove('font-bold', 'text-emerald-600', 'border-emerald-600');
    tab.classList.add('font-medium', 'text-slate-500', 'border-transparent');
  });

  document.getElementById(`view-${view}`).classList.remove('hidden');
  const activeTab = document.getElementById(`nav-${view}`);
  activeTab.classList.add('font-bold', 'text-emerald-600', 'border-emerald-600');
  activeTab.classList.remove('font-medium', 'text-slate-500', 'border-transparent');

  if (view === 'compras') {
    carregarComprasSalvas();
  } else if (view === 'historico') {
    carregarMetricas();
  }

  lucide.createIcons();
}

// Alternar Abas do Scanner (Foto / URL / Vídeo)
function switchScannerTab(tab) {
  ['file', 'manual', 'camera'].forEach(t => {
    document.getElementById(`content-${t}`).classList.add('hidden');
    const btn = document.getElementById(`tab-${t}`);
    btn.classList.remove('bg-white', 'text-emerald-700', 'shadow-sm', 'font-bold');
    btn.classList.add('text-slate-600');
  });

  document.getElementById(`content-${tab}`).classList.remove('hidden');
  const activeBtn = document.getElementById(`tab-${tab}`);
  activeBtn.classList.add('bg-white', 'text-emerald-700', 'shadow-sm', 'font-bold');
  activeBtn.classList.remove('text-slate-600');

  if (tab !== 'camera' && html5QrCode && html5QrCode.isScanning) {
    stopScanner();
  }
}

// Modal Conectar Celular
function toggleMobileModal() {
  const modal = document.getElementById('mobile-modal');
  modal.classList.toggle('hidden');
  lucide.createIcons();
}

// Scanner de Câmera em Tempo Real
async function startScanner() {
  try {
    document.getElementById('camera-placeholder').classList.add('hidden');
    document.getElementById('btn-start-camera').classList.add('hidden');
    document.getElementById('btn-stop-camera').classList.remove('hidden');

    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode("qr-reader");
    }

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      () => {}
    );
  } catch (err) {
    console.error("Erro ao acessar câmera:", err);
    showError("Não foi possível iniciar o vídeo.", "Utilize a aba 'Tirar Foto (Câmera)' para fotografar o cupom diretamente.");
    stopScanner();
  }
}

async function stopScanner() {
  if (html5QrCode && html5QrCode.isScanning) {
    await html5QrCode.stop();
  }
  document.getElementById('camera-placeholder').classList.remove('hidden');
  document.getElementById('btn-start-camera').classList.remove('hidden');
  document.getElementById('btn-stop-camera').classList.add('hidden');
}

function onScanSuccess(decodedText) {
  stopScanner();
  extrairDadosNfce(decodedText);
}

// Leitura de Foto do Cupom (Otimizado para iPhone / Safari)
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  hideError();
  showLoading('Processando foto e lendo QR Code...');

  try {
    const qrScanner = new Html5Qrcode("file-reader-container");
    
    // Tenta primeiro scan direto
    try {
      const decodedText = await qrScanner.scanFile(file, false);
      extrairDadosNfce(decodedText);
      return;
    } catch (e) {
      console.log("Tentando redimensionar foto do smartphone...");
    }

    // Se falhar na foto original de alta resolução, redimensiona via Canvas
    const imgBitmap = await createImageBitmap(file);
    const maxDim = 1200;
    let width = imgBitmap.width;
    let height = imgBitmap.height;

    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgBitmap, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const resizedFile = new File([blob], "resized.jpg", { type: "image/jpeg" });

    const decodedText = await qrScanner.scanFile(resizedFile, false);
    extrairDadosNfce(decodedText);

  } catch (err) {
    console.error("Erro ao ler QR Code:", err);
    hideLoading();
    showError("QR Code não identificado na foto.", "Dica: Aproxime a câmera do QR Code para que fique bem legível e tente novamente.");
  }
}

// URL Manual
function processManualUrl() {
  const urlInput = document.getElementById('manual-url-input');
  const url = urlInput.value.trim();

  if (!url) {
    showError("Campo obrigatório", "Por favor, digite ou cole a URL da NFC-e.");
    return;
  }

  extrairDadosNfce(url);
}

// Chama API para Extração
async function extrairDadosNfce(url) {
  hideError();
  document.getElementById('results-card').classList.add('hidden');
  showLoading('Consultando portal da SEFAZ e extraindo produtos...');

  try {
    const response = await fetch('/api/extrair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok || !data.sucesso) {
      throw new Error(data.erro || 'Falha ao processar nota fiscal.');
    }

    lastExtractionResult = data;
    renderResults(data);
  } catch (err) {
    console.error("Erro na extração:", err);
    showError("Erro na extração da Nota", err.message);
  } finally {
    hideLoading();
  }
}

// Renderiza dados extraídos na tela (Oficiais & Imutáveis)
function renderResults(data) {
  const nomeFantasia = data.estabelecimento.nomeFantasia || data.estabelecimento.nome || 'Supermercado';
  const razaoSocial = data.estabelecimento.nome && data.estabelecimento.nome !== nomeFantasia ? data.estabelecimento.nome : '';
  const endereco = data.estabelecimento.endereco || '';

  document.getElementById('res-mercado').textContent = nomeFantasia;
  
  let subInfo = '';
  if (razaoSocial) subInfo += `<span class="block text-slate-500 font-normal text-xs">Razão: ${escapeHtml(razaoSocial)}</span>`;
  if (endereco) subInfo += `<span class="flex items-center gap-1 text-slate-600 font-normal text-xs mt-0.5"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-emerald-600"></i> ${escapeHtml(endereco)}</span>`;
  
  document.getElementById('res-mercado-sub').innerHTML = subInfo;
  document.getElementById('res-cnpj').textContent = data.estabelecimento.cnpj ? `CNPJ: ${data.estabelecimento.cnpj}` : 'CNPJ não informado';
  document.getElementById('res-data').textContent = data.dataEmissao ? `Data: ${data.dataEmissao}` : `Data: ${new Date().toLocaleDateString('pt-BR')}`;
  document.getElementById('res-total').textContent = formatCurrency(data.valorTotalNota);
  document.getElementById('res-qtd-itens').textContent = `${data.totalItens} ${data.totalItens === 1 ? 'item oficial' : 'itens oficiais'}`;

  const btnSalvar = document.getElementById('btn-salvar-compra');
  btnSalvar.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5"></i> Salvar Compra`;
  btnSalvar.className = "w-full sm:w-auto px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2 transition active:scale-95";
  btnSalvar.disabled = false;

  const tbody = document.getElementById('res-itens-table');
  tbody.innerHTML = '';

  if (data.itens.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-6 text-center text-slate-500 italic bg-slate-50">
          Nenhum item tabular foi identificado automaticamente. Veja os dados brutos no debug abaixo.
        </td>
      </tr>
    `;
  } else {
    data.itens.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

      const packBadge = item.packInfo && item.packInfo.ehPack
        ? `<div class="mt-1 inline-flex items-center gap-1 bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md text-[11px] font-semibold">
             <span>${item.packInfo.descricaoResumidaPack}</span>
             ${item.packInfo.precoPorMedidaPadrao ? `<span class="text-amber-700 font-bold ml-1">(${item.packInfo.precoPorMedidaPadrao})</span>` : ''}
           </div>`
        : '';

      tr.innerHTML = `
        <td class="px-4 py-3.5 text-xs text-slate-400 font-mono">${index + 1}</td>
        <td class="px-4 py-3.5 font-medium text-slate-800">
          <div class="font-bold text-slate-900">${escapeHtml(item.nome)}</div>
          ${packBadge}
          ${item.codigo ? `<span class="block text-[11px] text-slate-400 font-mono mt-0.5">Cód: ${escapeHtml(item.codigo)}</span>` : ''}
        </td>
        <td class="px-4 py-3.5 text-center text-slate-600 whitespace-nowrap">
          <span class="inline-block bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg text-xs font-bold">${item.quantidade} ${item.unidade || 'UN'}</span>
        </td>
        <td class="px-4 py-3.5 text-right whitespace-nowrap">
          <div class="font-mono text-slate-700 font-semibold">${formatCurrency(item.valorUnitario)}</div>
          ${item.packInfo && item.packInfo.ehPack ? `<span class="text-[10px] text-emerald-700 font-bold block">${formatCurrency(item.packInfo.precoPorUnidadeFracionada)}/un</span>` : ''}
        </td>
        <td class="px-4 py-3.5 text-right font-bold text-slate-900 font-mono text-sm whitespace-nowrap">
          ${formatCurrency(item.valorTotal)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  const debugPre = document.getElementById('debug-json');
  debugPre.textContent = JSON.stringify(data, null, 2);

  document.getElementById('results-card').classList.remove('hidden');
  lucide.createIcons();
}

// Salva a compra atual vinculada ao Usuário no banco de dados SQLite
async function salvarCompraAtual() {
  if (!lastExtractionResult) return;

  const btnSalvar = document.getElementById('btn-salvar-compra');
  btnSalvar.disabled = true;
  btnSalvar.innerHTML = `<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> Salvando...`;

  try {
    const response = await fetch('/api/compras', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(lastExtractionResult)
    });

    const data = await response.json();
    if (!response.ok || !data.sucesso) {
      throw new Error(data.erro || 'Falha ao salvar compra.');
    }

    btnSalvar.className = "w-full sm:w-auto px-6 py-3.5 bg-emerald-800 text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2 transition";
    btnSalvar.innerHTML = `<i data-lucide="check" class="w-5 h-5"></i> Compra Salva com Sucesso!`;
    lucide.createIcons();

    setTimeout(() => {
      navigateView('compras');
    }, 1200);

  } catch (err) {
    console.error("Erro ao salvar compra:", err);
    alert(`Erro ao salvar: ${err.message}`);
    btnSalvar.disabled = false;
    btnSalvar.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5"></i> Salvar Compra`;
    lucide.createIcons();
  }
}

// Carrega a lista de compras salvas no SQLite (pessoal ou colaborativa)
async function carregarComprasSalvas() {
  const container = document.getElementById('compras-lista-container');
  container.innerHTML = `
    <div class="text-center py-8 text-slate-400">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2"></div>
      <p class="text-xs">Carregando compras...</p>
    </div>
  `;

  try {
    const endpoint = filtroComprasAtual === 'minhas' ? '/api/compras' : '/api/compras?todas=true';
    const response = await fetch(endpoint, { headers: getAuthHeaders() });
    const data = await response.json();

    if (!data.compras || data.compras.length === 0) {
      const msgVazia = filtroComprasAtual === 'minhas'
        ? 'Você ainda não escaneou nenhuma compra na sua conta.'
        : 'Nenhuma compra cadastrada por ninguém ainda.';

      container.innerHTML = `
        <div class="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-3">
          <i data-lucide="receipt" class="w-12 h-12 text-slate-300 mx-auto"></i>
          <h3 class="font-bold text-slate-700">Nenhuma compra encontrada</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">${msgVazia}</p>
          <button onclick="navigateView('scanner')" class="mt-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition">
            Escanear Nota
          </button>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    container.innerHTML = '';
    data.compras.forEach(compra => {
      const card = document.createElement('div');
      card.className = "bg-white rounded-2xl p-5 border border-slate-200 shadow-xs hover:shadow-md transition space-y-3";
      
      const nomeExibicao = compra.estabelecimento_fantasia || compra.estabelecimento_nome || 'Supermercado';
      const enderecoExibicao = compra.estabelecimento_endereco ? `<div class="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5"><i data-lucide="map-pin" class="w-3 h-3 text-emerald-600"></i> ${escapeHtml(compra.estabelecimento_endereco)}</div>` : '';

      const economiaBadge = compra.economia_estimada > 0
        ? `<span class="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1"><i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Economizou ${formatCurrency(compra.economia_estimada)}</span>`
        : '';

      const autorBadge = compra.usuario_nome
        ? `<span class="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
             <i data-lucide="user" class="w-3 h-3 text-emerald-600"></i> Enviado por <strong>${escapeHtml(compra.usuario_nome)}</strong> ${compra.usuario_bairro ? `(${escapeHtml(compra.usuario_bairro)})` : ''}
           </span>`
        : '';

      const botaoExcluir = (currentUser && compra.usuario_id === currentUser.id)
        ? `<button onclick="excluirCompra(${compra.id})" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition" title="Excluir Minha Compra">
             <i data-lucide="trash-2" class="w-4 h-4"></i>
           </button>`
        : '';

      card.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="text-[11px] font-semibold text-slate-400 uppercase">${compra.data_emissao || 'Data não informada'}</span>
              ${autorBadge}
            </div>
            <h3 class="text-base font-bold text-slate-900">${escapeHtml(nomeExibicao)}</h3>
            ${enderecoExibicao}
          </div>
          <div class="flex items-center gap-3">
            ${economiaBadge}
            <div class="text-right">
              <span class="text-xs text-slate-400">Total</span>
              <div class="text-lg font-black text-emerald-700">${formatCurrency(compra.valor_total)}</div>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between pt-1">
          <span class="text-xs text-slate-500 flex items-center gap-1.5">
            <i data-lucide="package" class="w-3.5 h-3.5 text-slate-400"></i> ${compra.total_itens} ${compra.total_itens === 1 ? 'item' : 'itens'}
          </span>
          <div class="flex items-center gap-2">
            <button onclick="abrirDetalhesCompra(${compra.id})" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 transition">
              <i data-lucide="eye" class="w-3.5 h-3.5"></i> Ver Itens
            </button>
            ${botaoExcluir}
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    lucide.createIcons();

  } catch (err) {
    console.error("Erro ao carregar compras:", err);
    container.innerHTML = `<div class="p-4 bg-rose-50 text-rose-700 rounded-xl text-xs">Erro ao carregar compras: ${err.message}</div>`;
  }
}

// Abre Modal com Itens da Compra
async function abrirDetalhesCompra(compraId) {
  try {
    const response = await fetch(`/api/compras/${compraId}`);
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);

    const { compra } = data;
    const nomeExibicao = compra.estabelecimento_fantasia || compra.estabelecimento_nome || 'Detalhes da Compra';
    document.getElementById('modal-compra-titulo').textContent = nomeExibicao;
    
    let subTexto = `${compra.data_emissao || ''} • ${compra.itens.length} itens`;
    if (compra.estabelecimento_endereco) {
      subTexto += ` • ${compra.estabelecimento_endereco}`;
    }
    document.getElementById('modal-compra-sub').textContent = subTexto;
    document.getElementById('modal-compra-total').textContent = `Total: ${formatCurrency(compra.valor_total)}`;

    const tbody = document.getElementById('modal-itens-table');
    tbody.innerHTML = '';

    compra.itens.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = "border-b border-slate-100";
      
      const packBadge = item.eh_pack
        ? `<div class="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-semibold inline-block mt-0.5">
             Pack c/ ${item.pack_qtd} un (${formatCurrency(item.preco_unitario_fracionado)}/un)
           </div>`
        : '';

      tr.innerHTML = `
        <td class="px-4 py-3 font-medium text-slate-800">
          <div>${escapeHtml(item.nome_original)}</div>
          ${packBadge}
        </td>
        <td class="px-4 py-3 text-center text-slate-600 text-xs font-bold">
          ${item.quantidade} ${item.unidade || 'UN'}
        </td>
        <td class="px-4 py-3 text-right text-slate-600 font-mono text-xs">
          ${formatCurrency(item.valor_unitario)}
        </td>
        <td class="px-4 py-3 text-right font-bold text-slate-900 font-mono text-xs">
          ${formatCurrency(item.valor_total)}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('detalhes-compra-modal').classList.remove('hidden');
    lucide.createIcons();

  } catch (err) {
    alert(`Erro ao abrir detalhes: ${err.message}`);
  }
}

function fecharModalDetalhes() {
  document.getElementById('detalhes-compra-modal').classList.add('hidden');
}

// Excluir Compra
async function excluirCompra(compraId) {
  if (!confirm("Deseja realmente excluir esta compra do seu histórico?")) return;

  try {
    const response = await fetch(`/api/compras/${compraId}`, { method: 'DELETE' });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);
    carregarComprasSalvas();
  } catch (err) {
    alert(`Erro ao excluir: ${err.message}`);
  }
}

// Carregar Dashboard de Métricas, Top Produtos e Cestas de Comparação
async function carregarMetricas() {
  try {
    const response = await fetch('/api/metricas', { headers: getAuthHeaders() });
    const data = await response.json();
    if (!data.sucesso) return;

    const { metricas } = data;
    document.getElementById('stat-economia').textContent = formatCurrency(metricas.totalEconomia);
    document.getElementById('stat-compras').textContent = metricas.totalCompras;
    document.getElementById('stat-produtos').textContent = metricas.totalProdutos;
    document.getElementById('stat-mercados').textContent = metricas.totalMercados;

    const topContainer = document.getElementById('top-produtos-container');
    topContainer.innerHTML = '';

    if (!metricas.topProdutos || metricas.topProdutos.length === 0) {
      topContainer.innerHTML = `<p class="col-span-3 text-xs text-slate-400 italic">Nenhum produto cadastrado ainda.</p>`;
    } else {
      metricas.topProdutos.forEach(prod => {
        const itemCard = document.createElement('div');
        itemCard.className = "p-3.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-emerald-50/50 transition cursor-pointer";
        itemCard.onclick = () => {
          document.getElementById('busca-produto-input').value = prod.nome_padrao;
          buscarHistoricoProduto(prod.id);
        };
        itemCard.innerHTML = `
          <h4 class="font-bold text-xs text-slate-800 line-clamp-1">${escapeHtml(prod.nome_padrao)}</h4>
          <div class="flex justify-between items-center mt-2 text-[11px] text-slate-500">
            <span>Comprado ${prod.vezes_comprado}x</span>
            <span class="font-bold text-emerald-700">${formatCurrency(prod.menor_preco)}</span>
          </div>
        `;
        topContainer.appendChild(itemCard);
      });
    }

    // Carrega também as Cestas de Comparação Personalizadas
    await carregarGruposComparacao();

  } catch (err) {
    console.error("Erro ao carregar métricas:", err);
  }
}

// ==================== CATÁLOGO COMPLETO DE PRODUTOS ====================
let catalogoProdutosCache = [];

async function abrirModalCatalogoProdutos() {
  const modal = document.getElementById('catalogo-produtos-modal');
  modal.classList.remove('hidden');
  const container = document.getElementById('catalogo-itens-container');
  container.innerHTML = `
    <div class="text-center py-10 text-slate-400">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2"></div>
      <p class="text-xs">Carregando catálogo completo...</p>
    </div>
  `;

  try {
    const response = await fetch('/api/produtos');
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);

    catalogoProdutosCache = data.produtos || [];
    document.getElementById('catalogo-filtro-input').value = '';
    renderizarCatalogo(catalogoProdutosCache);
  } catch (err) {
    container.innerHTML = `<div class="p-4 bg-rose-50 text-rose-700 text-xs rounded-xl">Erro ao carregar catálogo: ${err.message}</div>`;
  }
}

function fecharModalCatalogo() {
  document.getElementById('catalogo-produtos-modal').classList.add('hidden');
}

function filtrarCatalogoProdutos(filtro) {
  const termo = (filtro || '').toLowerCase().trim();
  if (!termo) {
    renderizarCatalogo(catalogoProdutosCache);
    return;
  }
  const filtrados = catalogoProdutosCache.filter(p => 
    (p.nome_padrao && p.nome_padrao.toLowerCase().includes(termo)) ||
    (p.codigo && p.codigo.includes(termo))
  );
  renderizarCatalogo(filtrados);
}

function renderizarCatalogo(produtos) {
  const container = document.getElementById('catalogo-itens-container');
  const sub = document.getElementById('catalogo-total-sub');
  const rodape = document.getElementById('catalogo-stats-rodape');

  sub.textContent = `${produtos.length} ${produtos.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
  rodape.textContent = `Exibindo ${produtos.length} de ${catalogoProdutosCache.length} produtos cadastrados`;

  if (produtos.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400">
        <i data-lucide="search-x" class="w-10 h-10 mx-auto mb-2 text-slate-300"></i>
        <p class="text-sm font-semibold text-slate-600">Nenhum produto encontrado</p>
        <p class="text-xs text-slate-400 mt-1">Tente pesquisar por outro termo ou limpe o filtro.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = '';
  produtos.forEach(prod => {
    const card = document.createElement('div');
    card.className = "p-4 bg-white border border-slate-200 hover:border-emerald-300 rounded-xl shadow-xs hover:shadow-sm transition space-y-2.5";

    const menorMercadoTexto = prod.melhor_mercado
      ? `<div class="text-[11px] text-emerald-800 flex items-center gap-1 font-medium bg-emerald-50 px-2 py-0.5 rounded-md w-fit">
           <i data-lucide="store" class="w-3 h-3 text-emerald-600"></i> Menor valor registrado no <strong>${escapeHtml(prod.melhor_mercado)}</strong>
         </div>`
      : '';

    card.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-bold text-sm text-slate-900">${escapeHtml(prod.nome_padrao)}</h4>
            <span class="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded uppercase">${escapeHtml(prod.unidade || 'UN')}</span>
            <span class="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.5 rounded">${prod.vezes_comprado}x comprado</span>
          </div>
          ${prod.codigo ? `<span class="text-[11px] text-slate-400 font-mono block mt-0.5">Cód: ${escapeHtml(prod.codigo)}</span>` : ''}
          ${menorMercadoTexto}
        </div>
        <div class="flex items-center gap-1.5 self-end sm:self-auto">
          <button onclick="abrirHistoricoDeProduto(${prod.id}, '${escapeHtml(prod.nome_padrao).replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 transition" title="Ver Histórico de Preços">
            <i data-lucide="trending-up" class="w-3.5 h-3.5"></i> Histórico
          </button>
          <button onclick="abrirModalAdicionarProduto(${prod.id}, '${escapeHtml(prod.nome_padrao).replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition shadow-xs" title="Adicionar à Cesta de Comparação">
            <i data-lucide="layers" class="w-3.5 h-3.5"></i> + Cesta
          </button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg text-center border border-slate-100">
        <div>
          <span class="text-[10px] text-slate-400 uppercase font-semibold block">Menor Preço</span>
          <span class="text-xs font-black text-emerald-700">${prod.menor_preco > 0 ? formatCurrency(prod.menor_preco) : '--'}</span>
        </div>
        <div>
          <span class="text-[10px] text-slate-400 uppercase font-semibold block">Preço Médio</span>
          <span class="text-xs font-bold text-slate-700">${prod.preco_medio > 0 ? formatCurrency(prod.preco_medio) : '--'}</span>
        </div>
        <div>
          <span class="text-[10px] text-slate-400 uppercase font-semibold block">Último Preço</span>
          <span class="text-xs font-bold text-slate-700">${prod.ultimo_preco > 0 ? formatCurrency(prod.ultimo_preco) : '--'}</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

function abrirHistoricoDeProduto(prodId, nomePadrao) {
  fecharModalCatalogo();
  document.getElementById('busca-produto-input').value = nomePadrao;
  buscarHistoricoProduto(prodId);
  window.scrollTo({ top: document.getElementById('busca-produto-input').offsetTop - 80, behavior: 'smooth' });
}


// ==================== GRUPOS / CESTAS DE COMPARAÇÃO DE MARCAS ====================
let produtoSelecionadoParaGrupo = null;

async function carregarGruposComparacao() {
  const container = document.getElementById('grupos-comparacao-container');
  if (!container) return;

  try {
    const response = await fetch('/api/grupos');
    const data = await response.json();
    if (!data.sucesso) return;

    const grupos = data.grupos || [];

    if (grupos.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200 p-4 space-y-2">
          <i data-lucide="layers" class="w-8 h-8 text-slate-300 mx-auto"></i>
          <p class="text-xs font-bold text-slate-700">Nenhuma Cesta de Comparação Criada</p>
          <p class="text-[11px] text-slate-500 max-w-sm mx-auto">Crie cestas como "Sabonetes do Dia a Dia" ou "Queijo Mussarela" para comparar marcas concorrentes e encontrar o melhor preço em Atibaia.</p>
          <button onclick="abrirModalCriarGrupo()" class="mt-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition">
            + Criar Primeira Cesta
          </button>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    container.innerHTML = '';
    grupos.forEach(grupo => {
      const card = document.createElement('div');
      card.className = "bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-3";

      // Vencedor (mais barato da cesta)
      let vencedorHtml = '';
      if (grupo.vencedor) {
        vencedorHtml = `
          <div class="bg-emerald-100/70 border border-emerald-200/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-lg">🏆</span>
              <div>
                <span class="text-[10px] uppercase tracking-wider font-bold text-emerald-800 block">Opção Mais Barata na Cesta</span>
                <span class="font-black text-xs text-slate-900">${escapeHtml(grupo.vencedor.nome_padrao)}</span>
                <span class="text-[11px] text-emerald-800 block">no <strong>${escapeHtml(grupo.vencedor.melhorMercado || grupo.vencedor.ultimoMercado)}</strong> ${grupo.vencedor.melhorEndereco ? `(${escapeHtml(grupo.vencedor.melhorEndereco)})` : ''}</span>
              </div>
            </div>
            <div class="text-right self-end sm:self-auto">
              <span class="text-[10px] text-emerald-700 font-semibold block">Menor Valor</span>
              <span class="text-base font-black text-emerald-800">${formatCurrency(grupo.vencedor.menorPreco || grupo.vencedor.ultimoPreco)}</span>
            </div>
          </div>
        `;
      } else {
        vencedorHtml = `
          <div class="p-3 bg-white rounded-lg border border-slate-200 text-center text-xs text-slate-400 italic">
            Nenhum produto adicionado a esta cesta ainda.
          </div>
        `;
      }

      // Linhas dos produtos adicionados
      let produtosLinhas = '';
      if (grupo.produtos && grupo.produtos.length > 0) {
        produtosLinhas = grupo.produtos.map(p => {
          const ehVencedor = grupo.vencedor && grupo.vencedor.id === p.id;
          return `
            <div class="flex items-center justify-between p-2.5 bg-white rounded-lg border ${ehVencedor ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'} text-xs gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-bold text-slate-800 truncate flex items-center gap-1.5">
                  ${ehVencedor ? '⭐' : ''} ${escapeHtml(p.nome_padrao)}
                </div>
                <div class="text-[10px] text-slate-500 mt-0.5">
                  Menor: <strong class="text-emerald-700">${p.menorPreco > 0 ? formatCurrency(p.menorPreco) : '--'}</strong> no ${escapeHtml(p.melhorMercado || 'Mercado')}
                </div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <button onclick="abrirHistoricoDeProduto(${p.id}, '${escapeHtml(p.nome_padrao).replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded-md transition" title="Ver Histórico">
                  <i data-lucide="trending-up" class="w-3.5 h-3.5"></i>
                </button>
                <button onclick="removerProdutoDoGrupo(${grupo.id}, ${p.id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition" title="Remover da Cesta">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <h4 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <i data-lucide="shopping-basket" class="w-4 h-4 text-emerald-600"></i>
              ${escapeHtml(grupo.nome_grupo)}
            </h4>
            ${grupo.descricao ? `<p class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(grupo.descricao)}</p>` : ''}
          </div>
          <div class="flex items-center gap-1">
            <button onclick="abrirModalCatalogoProdutos()" class="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-lg transition flex items-center gap-1">
              <i data-lucide="plus" class="w-3 h-3"></i> Adicionar Itens
            </button>
            <button onclick="excluirGrupo(${grupo.id})" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition" title="Excluir Cesta">
              <i data-lucide="trash" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        ${vencedorHtml}

        ${grupo.produtos && grupo.produtos.length > 0 ? `
          <div class="space-y-1.5 pt-1">
            <span class="text-[10px] font-bold text-slate-500 uppercase block">Marcas & Produtos nesta cesta (${grupo.produtos.length}):</span>
            <div class="space-y-1.5">
              ${produtosLinhas}
            </div>
          </div>
        ` : ''}
      `;

      container.appendChild(card);
    });

    lucide.createIcons();

  } catch (err) {
    console.error("Erro ao carregar grupos:", err);
  }
}

// Modal Criar Grupo
function abrirModalCriarGrupo() {
  document.getElementById('novo-grupo-nome').value = '';
  document.getElementById('novo-grupo-desc').value = '';
  document.getElementById('criar-grupo-modal').classList.remove('hidden');
}

function fecharModalCriarGrupo() {
  document.getElementById('criar-grupo-modal').classList.add('hidden');
}

async function salvarNovoGrupo() {
  const nome = document.getElementById('novo-grupo-nome').value.trim();
  const desc = document.getElementById('novo-grupo-desc').value.trim();

  if (!nome) {
    alert("Por favor, informe o nome da cesta.");
    return;
  }

  try {
    const response = await fetch('/api/grupos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, descricao: desc })
    });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);

    fecharModalCriarGrupo();
    await carregarGruposComparacao();
  } catch (err) {
    alert(`Erro ao criar cesta: ${err.message}`);
  }
}

async function excluirGrupo(grupoId) {
  if (!confirm("Deseja realmente excluir esta cesta de comparação? (Nenhum produto oficial será apagado)")) return;

  try {
    const response = await fetch(`/api/grupos/${grupoId}`, { method: 'DELETE' });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);
    await carregarGruposComparacao();
  } catch (err) {
    alert(`Erro ao excluir: ${err.message}`);
  }
}

// Modal Adicionar Produto a um Grupo
async function abrirModalAdicionarProduto(produtoId, nomeProduto) {
  produtoSelecionadoParaGrupo = { id: produtoId, nome: nomeProduto };
  document.getElementById('add-modal-produto-nome').textContent = nomeProduto;
  const listaContainer = document.getElementById('add-modal-grupos-lista');
  listaContainer.innerHTML = `<div class="text-center py-4 text-xs text-slate-400">Carregando cestas...</div>`;
  document.getElementById('add-produto-grupo-modal').classList.remove('hidden');

  try {
    const response = await fetch('/api/grupos');
    const data = await response.json();
    const grupos = data.grupos || [];

    if (grupos.length === 0) {
      listaContainer.innerHTML = `
        <div class="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-500">
          Nenhuma cesta criada ainda. Crie uma cesta primeiro clicando no botão abaixo.
        </div>
      `;
      return;
    }

    listaContainer.innerHTML = '';
    grupos.forEach(g => {
      const btn = document.createElement('button');
      btn.className = "w-full text-left p-3 rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition flex items-center justify-between group";
      btn.onclick = () => adicionarProdutoAoGrupo(g.id, produtoId);
      btn.innerHTML = `
        <div>
          <div class="font-bold text-xs text-slate-900 group-hover:text-emerald-800">${escapeHtml(g.nome_grupo)}</div>
          <div class="text-[10px] text-slate-400">${g.total_produtos} produtos cadastrados</div>
        </div>
        <i data-lucide="plus" class="w-4 h-4 text-slate-300 group-hover:text-emerald-600 transition"></i>
      `;
      listaContainer.appendChild(btn);
    });

    lucide.createIcons();

  } catch (err) {
    listaContainer.innerHTML = `<div class="text-xs text-rose-600">Erro: ${err.message}</div>`;
  }
}

function fecharModalAddProdutoGrupo() {
  document.getElementById('add-produto-grupo-modal').classList.add('hidden');
  produtoSelecionadoParaGrupo = null;
}

async function adicionarProdutoAoGrupo(grupoId, produtoId) {
  try {
    const response = await fetch(`/api/grupos/${grupoId}/produtos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtoId })
    });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);

    fecharModalAddProdutoGrupo();
    alert("Produto adicionado à cesta com sucesso!");
    await carregarGruposComparacao();
  } catch (err) {
    alert(`Erro ao adicionar produto: ${err.message}`);
  }
}

async function removerProdutoDoGrupo(grupoId, produtoId) {
  if (!confirm("Remover este produto da cesta de comparação?")) return;

  try {
    const response = await fetch(`/api/grupos/${grupoId}/produtos/${produtoId}`, { method: 'DELETE' });
    const data = await response.json();
    if (!data.sucesso) throw new Error(data.erro);
    await carregarGruposComparacao();
  } catch (err) {
    alert(`Erro ao remover: ${err.message}`);
  }
}

// ==================== HISTÓRICO DE PREÇO COM GRÁFICO DE LINHA DO TEMPO ====================
let graficoHistoricoInstancia = null;

const CORES_MERCADOS = [
  { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)', name: 'blue' },
  { border: '#059669', bg: 'rgba(5, 150, 105, 0.15)', name: 'emerald' },
  { border: '#dc2626', bg: 'rgba(220, 38, 38, 0.15)', name: 'red' },
  { border: '#d97706', bg: 'rgba(217, 119, 6, 0.15)', name: 'amber' },
  { border: '#7c3aed', bg: 'rgba(124, 58, 237, 0.15)', name: 'purple' },
  { border: '#db2777', bg: 'rgba(219, 39, 119, 0.15)', name: 'pink' },
  { border: '#0891b2', bg: 'rgba(8, 145, 178, 0.15)', name: 'cyan' }
];

// Buscar Histórico de Preço de um Produto
async function buscarHistoricoProduto(prodIdOuTermo) {
  const termo = prodIdOuTermo || document.getElementById('busca-produto-input').value.trim();
  if (!termo) return;

  const resContainer = document.getElementById('busca-produto-resultado');
  resContainer.innerHTML = `<p class="text-xs text-slate-400">Consultando histórico do produto...</p>`;
  resContainer.classList.remove('hidden');

  try {
    const response = await fetch(`/api/produtos/${encodeURIComponent(termo)}/historico`);
    const data = await response.json();

    if (!response.ok || !data.sucesso) {
      resContainer.innerHTML = `<p class="text-xs text-rose-600">Produto não encontrado no histórico.</p>`;
      return;
    }

    const { produto, estatisticas, historico } = data;

    // Mapeia supermercados únicos e atribui uma cor para cada um
    const mercadosUnicos = [...new Set(historico.map(h => h.estabelecimento_nome))];
    const mapaCoresMercados = {};
    mercadosUnicos.forEach((mercado, idx) => {
      mapaCoresMercados[mercado] = CORES_MERCADOS[idx % CORES_MERCADOS.length];
    });

    let historicoLinhas = '';
    historico.forEach(h => {
      const precoItem = h.preco_fracionado || h.valor_unitario;
      const ehMenor = precoItem === estatisticas.menorPreco;
      const diffPct = estatisticas.menorPreco > 0 && !ehMenor
        ? `+${(((precoItem - estatisticas.menorPreco) / estatisticas.menorPreco) * 100).toFixed(1)}%`
        : '';

      const badgePreco = ehMenor
        ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded ml-1">Menor Preço</span>`
        : (diffPct ? `<span class="text-rose-600 text-[10px] font-semibold ml-1">(${diffPct})</span>` : '');

      const corMercado = mapaCoresMercados[h.estabelecimento_nome] || CORES_MERCADOS[0];

      historicoLinhas += `
        <tr class="border-b border-slate-100 text-xs hover:bg-slate-50">
          <td class="py-2.5 px-3 text-slate-500 whitespace-nowrap">${h.data_registro}</td>
          <td class="py-2.5 px-3">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${corMercado.border}"></span>
              <span class="font-bold text-slate-900">${escapeHtml(h.estabelecimento_nome)}</span>
            </div>
            ${h.estabelecimento_endereco ? `<div class="text-[10px] text-slate-400 ml-4">${escapeHtml(h.estabelecimento_endereco)}</div>` : ''}
          </td>
          <td class="py-2.5 px-3 text-right whitespace-nowrap">
            <span class="font-bold text-slate-900 font-mono text-xs">${formatCurrency(precoItem)}</span>
            ${badgePreco}
          </td>
        </tr>
      `;
    });

    resContainer.innerHTML = `
      <div class="bg-emerald-50/60 border border-emerald-100 p-4 sm:p-5 rounded-2xl space-y-4">
        <!-- Cabeçalho do Produto -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-100/80 pb-3">
          <div>
            <span class="text-[10px] uppercase tracking-wider text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded">Histórico & Comparativo</span>
            <h4 class="font-black text-base sm:text-lg text-slate-900 mt-1">${escapeHtml(produto.nome_padrao)}</h4>
            <span class="text-[11px] text-slate-500">Unidade de Medida: <strong>${escapeHtml(produto.unidade || 'UN')}</strong></span>
          </div>
          <div class="flex items-center gap-2 self-start sm:self-auto">
            <button onclick="abrirModalAdicionarProduto(${produto.id}, '${escapeHtml(produto.nome_padrao).replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center gap-1.5">
              <i data-lucide="layers" class="w-3.5 h-3.5"></i> + Cesta
            </button>
            <span class="text-[11px] bg-white border border-emerald-200 text-emerald-900 font-semibold px-2.5 py-1 rounded-xl shadow-xs">${estatisticas.totalRegistros} compras registradas</span>
          </div>
        </div>
        
        <!-- Cards de Estatísticas -->
        <div class="grid grid-cols-3 gap-2 sm:gap-3 text-center bg-white p-3.5 rounded-xl border border-emerald-100 shadow-xs">
          <div>
            <span class="text-[10px] text-slate-400 uppercase font-semibold block">Menor Preço</span>
            <div class="text-sm sm:text-base font-black text-emerald-600 mt-0.5">${formatCurrency(estatisticas.menorPreco)}</div>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 uppercase font-semibold block">Preço Médio</span>
            <div class="text-sm sm:text-base font-black text-slate-700 mt-0.5">${formatCurrency(estatisticas.precoMedio)}</div>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 uppercase font-semibold block">Maior Preço</span>
            <div class="text-sm sm:text-base font-black text-rose-600 mt-0.5">${formatCurrency(estatisticas.maiorPreco)}</div>
          </div>
        </div>

        <!-- GRÁFICO INTERATIVO DE LINHA DO TEMPO POR MERCADO -->
        <div class="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div class="flex items-center gap-2">
              <i data-lucide="line-chart" class="w-4 h-4 text-emerald-600"></i>
              <span class="text-xs font-bold text-slate-800 uppercase tracking-wide">Linha do Tempo de Preços por Mercado</span>
            </div>
            <span class="text-[10px] text-slate-400">Linhas coloridas representam cada supermercado</span>
          </div>

          <!-- Container do Canvas do Chart.js -->
          <div class="relative w-full h-64 sm:h-72">
            <canvas id="grafico-historico-canvas"></canvas>
          </div>
        </div>

        <!-- TABELA DE REGISTROS CRONOLÓGICOS -->
        <div>
          <span class="text-xs font-bold text-slate-700 block mb-1.5 flex items-center gap-1.5">
            <i data-lucide="list" class="w-3.5 h-3.5 text-slate-500"></i> Detalhamento de Compras Registradas:
          </span>
          <div class="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-400 font-semibold border-b border-slate-200">
                <tr>
                  <th class="py-2 px-3">Data</th>
                  <th class="py-2 px-3">Supermercado</th>
                  <th class="py-2 px-3 text-right">Preço Unitário</th>
                </tr>
              </thead>
              <tbody>
                ${historicoLinhas}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    lucide.createIcons();

    // Renderiza o gráfico via Chart.js
    renderizarGraficoHistoricoChart(historico, mercadosUnicos, mapaCoresMercados);

  } catch (err) {
    console.error("Erro ao buscar histórico:", err);
    resContainer.innerHTML = `<p class="text-xs text-rose-600">Erro: ${err.message}</p>`;
  }
}

// Renderizador do Gráfico de Linha do Tempo (Chart.js)
function renderizarGraficoHistoricoChart(historico, mercadosUnicos, mapaCoresMercados) {
  const canvas = document.getElementById('grafico-historico-canvas');
  if (!canvas) return;

  if (graficoHistoricoInstancia) {
    graficoHistoricoInstancia.destroy();
    graficoHistoricoInstancia = null;
  }

  // Ordena os registros em ordem cronológica crescente (do mais antigo para o mais recente)
  const parseDataBR = (str) => {
    if (!str) return new Date(0);
    // Exemplo: "30/09/2026 11:56:00" ou "2026-10-07..."
    const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    if (match) {
      return new Date(match[3], match[2] - 1, match[1], match[4] || 0, match[5] || 0);
    }
    return new Date(str);
  };

  const historicoOrdenado = [...historico].sort((a, b) => parseDataBR(a.data_registro) - parseDataBR(b.data_registro));

  // Gera a lista de datas únicas para o eixo X
  const formatarDataResumida = (str) => {
    if (!str) return '';
    const match = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return `${match[1]}/${match[2]}`;
    return str.substring(0, 10);
  };

  // Coleta todas as datas únicas ordenadas
  const labelsDatas = [];
  const datasChave = [];
  historicoOrdenado.forEach(h => {
    const dRes = formatarDataResumida(h.data_registro);
    if (!datasChave.includes(h.data_registro)) {
      datasChave.push(h.data_registro);
      labelsDatas.push(dRes || h.data_registro);
    }
  });

  // Constrói os datasets para cada supermercado
  const datasets = mercadosUnicos.map(mercado => {
    const cor = mapaCoresMercados[mercado] || CORES_MERCADOS[0];
    
    // Mapeia os preços desse mercado em cada ponto do eixo X
    const dataPoints = datasChave.map(dataKey => {
      const reg = historicoOrdenado.find(h => h.estabelecimento_nome === mercado && h.data_registro === dataKey);
      if (reg) {
        return Number(reg.preco_fracionado || reg.valor_unitario);
      }
      return null; // Sem compra neste mercado nesta data
    });

    return {
      label: mercado,
      data: dataPoints,
      borderColor: cor.border,
      backgroundColor: cor.bg,
      pointBackgroundColor: cor.border,
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 9,
      borderWidth: 3,
      tension: 0.3, // Curva suave
      spanGaps: true, // Conecta linhas através das datas
      fill: false
    };
  });

  const ctx = canvas.getContext('2d');
  graficoHistoricoInstancia = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labelsDatas,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            padding: 15,
            font: {
              size: 11,
              weight: 'bold',
              family: 'ui-sans-serif, system-ui, sans-serif'
            },
            color: '#334155'
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { size: 12, weight: 'bold' },
          bodyFont: { size: 11 },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              const valor = context.parsed.y;
              if (valor !== null && valor !== undefined) {
                return ` ${context.dataset.label}: R$ ${valor.toFixed(2).replace('.', ',')}`;
              }
              return null;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: { size: 10, weight: '600' },
            color: '#64748b'
          }
        },
        y: {
          grid: {
            color: '#f1f5f9'
          },
          ticks: {
            font: { size: 10, weight: '600' },
            color: '#64748b',
            callback: function(value) {
              return 'R$ ' + value.toFixed(2).replace('.', ',');
            }
          }
        }
      }
    }
  });
}

// Helpers
function showLoading(msg) {
  document.getElementById('status-message').textContent = msg;
  document.getElementById('status-card').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('status-card').classList.add('hidden');
}

function showError(title, desc) {
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-desc').textContent = desc;
  document.getElementById('error-card').classList.remove('hidden');
  lucide.createIcons();
}

function hideError() {
  document.getElementById('error-card').classList.add('hidden');
}

function toggleDebug() {
  document.getElementById('debug-json').classList.toggle('hidden');
}

function copiarJson() {
  if (!lastExtractionResult) return;
  navigator.clipboard.writeText(JSON.stringify(lastExtractionResult, null, 2))
    .then(() => alert('JSON copiado!'))
    .catch(() => alert('Falha ao copiar JSON.'));
}

function formatCurrency(val) {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
