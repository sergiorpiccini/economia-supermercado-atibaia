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

// Inicializa usuário logado e controla visibilidade do Gatekeeper
async function inicializarUsuario() {
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

  aplicarEstadoAutenticacao();
}

function aplicarEstadoAutenticacao() {
  const gatekeeper = document.getElementById('view-auth-gatekeeper');
  const mainApp = document.getElementById('main-app-content');

  if (currentUser) {
    if (gatekeeper) gatekeeper.classList.add('hidden');
    if (mainApp) mainApp.classList.remove('hidden');
    renderizarUserHeader();
    carregarComprasSalvas();
    carregarMetricas();
  } else {
    if (gatekeeper) gatekeeper.classList.remove('hidden');
    if (mainApp) mainApp.classList.add('hidden');
    renderizarUserHeader();
  }
  lucide.createIcons();
}

function renderizarUserHeader() {
  const headerContainer = document.getElementById('user-header-container');
  if (!headerContainer) return;

  if (currentUser) {
    const primeiroNome = currentUser.nome ? currentUser.nome.split(' ')[0] : 'Usuário';
    const bairroTexto = currentUser.bairro ? ` • ${currentUser.bairro}` : '';
    headerContainer.innerHTML = `
      <div class="flex items-center gap-1">
        <button onclick="abrirModalAuth()" class="flex items-center gap-1.5 bg-emerald-700/90 hover:bg-emerald-800 text-white px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition border border-emerald-500/80 shadow-xs" title="Minha Conta">
          <i data-lucide="user-check" class="w-3.5 h-3.5 text-emerald-200"></i>
          <span class="max-w-[110px] truncate">${escapeHtml(primeiroNome)}${escapeHtml(bairroTexto)}</span>
        </button>
        <button onclick="executarLogout()" class="p-1.5 bg-emerald-700/80 hover:bg-rose-700 text-white rounded-xl text-xs transition border border-emerald-500/60 shadow-xs cursor-pointer" title="Sair da Conta">
          <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;
  } else {
    headerContainer.innerHTML = `
      <button onclick="focarLoginGatekeeper()" class="flex items-center gap-1.5 bg-white hover:bg-slate-100 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer">
        <i data-lucide="log-in" class="w-3.5 h-3.5"></i> Entrar
      </button>
    `;
  }
  lucide.createIcons();
}

// Alternar abas no Gatekeeper da tela inicial
function alternarGatekeeperTab(aba) {
  const tabLogin = document.getElementById('gatekeeper-tab-login');
  const tabCad = document.getElementById('gatekeeper-tab-cadastro');
  const formLogin = document.getElementById('gatekeeper-form-login');
  const formCad = document.getElementById('gatekeeper-form-cadastro');

  if (aba === 'login') {
    tabLogin.className = "flex-1 py-2.5 rounded-xl bg-white text-emerald-700 shadow-xs font-bold transition";
    tabCad.className = "flex-1 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 transition";
    formLogin.classList.remove('hidden');
    formCad.classList.add('hidden');
  } else {
    tabCad.className = "flex-1 py-2.5 rounded-xl bg-white text-emerald-700 shadow-xs font-bold transition";
    tabLogin.className = "flex-1 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 transition";
    formCad.classList.remove('hidden');
    formLogin.classList.add('hidden');
  }
}

function focarLoginGatekeeper() {
  const gatekeeper = document.getElementById('view-auth-gatekeeper');
  if (gatekeeper) {
    gatekeeper.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('gate-login-email')?.focus();
  }
}

// Login pelo Gatekeeper da Tela Inicial
async function executarLoginGatekeeper() {
  const email = document.getElementById('gate-login-email').value.trim();
  const senha = document.getElementById('gate-login-senha').value.trim();
  const erroDiv = document.getElementById('gate-login-erro');
  erroDiv.classList.add('hidden');

  if (!email || !senha) {
    erroDiv.textContent = "Por favor, informe seu e-mail e sua senha.";
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

    aplicarEstadoAutenticacao();
  } catch (err) {
    erroDiv.textContent = err.message || "Erro ao efetuar login.";
    erroDiv.classList.remove('hidden');
  }
}

// Cadastro pelo Gatekeeper da Tela Inicial
async function executarCadastroGatekeeper() {
  const nome = document.getElementById('gate-cad-nome').value.trim();
  const email = document.getElementById('gate-cad-email').value.trim();
  const bairro = document.getElementById('gate-cad-bairro').value.trim();
  const senha = document.getElementById('gate-cad-senha').value.trim();
  const erroDiv = document.getElementById('gate-cad-erro');
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

    aplicarEstadoAutenticacao();
  } catch (err) {
    erroDiv.textContent = err.message || "Erro ao criar conta.";
    erroDiv.classList.remove('hidden');
  }
}

// Modal de Autenticação (quando logado para ver perfil ou trocar senha)
function abrirModalAuth() {
  const sessaoAtiva = document.getElementById('auth-sessao-ativa');
  const naoLogado = document.getElementById('auth-nao-logado-container');
  const titulo = document.getElementById('auth-modal-titulo');
  const sub = document.getElementById('auth-modal-sub');

  document.getElementById('auth-login-erro')?.classList.add('hidden');
  document.getElementById('auth-cad-erro')?.classList.add('hidden');

  if (currentUser) {
    sessaoAtiva.classList.remove('hidden');
    naoLogado.classList.add('hidden');
    titulo.textContent = 'Minha Conta';
    sub.textContent = 'Sessão conectada neste dispositivo';

    document.getElementById('auth-usuario-nome').textContent = currentUser.nome;
    document.getElementById('auth-usuario-email').textContent = currentUser.email;
    document.getElementById('auth-usuario-bairro').textContent = currentUser.bairro || 'Atibaia - SP';
  } else {
    sessaoAtiva.classList.add('hidden');
    naoLogado.classList.remove('hidden');
    titulo.textContent = 'Entrar ou Criar Conta';
    sub.textContent = 'Acesse para guardar suas notas fiscais';
    alternarAbaAuth('login');
  }

  document.getElementById('auth-modal').classList.remove('hidden');
  lucide.createIcons();
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
    aplicarEstadoAutenticacao();
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
    aplicarEstadoAutenticacao();
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
  aplicarEstadoAutenticacao();
  if (notificar) alert("Você saiu da sua conta.");
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

// Navegação entre Telas Principais (Escanear / Otimizador Lista / Minhas Compras / Preços)
function navigateView(view) {
  currentView = view;
  ['scanner', 'lista', 'compras', 'historico'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
    const tab = document.getElementById(`nav-${v}`);
    if (tab) {
      tab.classList.remove('font-bold', 'text-emerald-600', 'border-emerald-600');
      tab.classList.add('font-medium', 'text-slate-500', 'border-transparent');
    }
  });

  const activeViewEl = document.getElementById(`view-${view}`);
  if (activeViewEl) activeViewEl.classList.remove('hidden');

  const activeTab = document.getElementById(`nav-${view}`);
  if (activeTab) {
    activeTab.classList.add('font-bold', 'text-emerald-600', 'border-emerald-600');
    activeTab.classList.remove('font-medium', 'text-slate-500', 'border-transparent');
  }

  if (view === 'lista') {
    carregarListasUsuario();
  } else if (view === 'compras') {
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

  if (!currentUser) {
    alert("Por favor, entre ou crie sua conta para salvar esta compra no seu perfil!");
    abrirModalAuth();
    return;
  }

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

  if (filtroComprasAtual === 'minhas' && !currentUser) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-3">
        <div class="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
          <i data-lucide="lock" class="w-6 h-6"></i>
        </div>
        <h3 class="font-bold text-slate-800 text-base">Minhas Compras Privadas</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto">Crie sua conta ou faça login para guardar suas notas fiscais de forma privada e acompanhar seus gastos pessoais.</p>
        <button onclick="abrirModalAuth()" class="mt-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition">
          Criar Conta ou Entrar
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = `
    <div class="text-center py-8 text-slate-400">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2"></div>
      <p class="text-xs">Carregando compras...</p>
    </div>
  `;

  try {
    const response = await fetch('/api/compras', { headers: getAuthHeaders() });
    const data = await response.json();

    if (!data.compras || data.compras.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl p-8 border border-slate-200 text-center space-y-3">
          <i data-lucide="receipt" class="w-12 h-12 text-slate-300 mx-auto"></i>
          <h3 class="font-bold text-slate-700">Nenhuma compra cadastrada</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">Você ainda não escaneou nenhuma nota fiscal na sua conta.</p>
          <button onclick="navigateView('scanner')" class="mt-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition">
            Escanear Minha Primeira Nota
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

      const botaoExcluir = `
        <button onclick="excluirCompra(${compra.id})" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition" title="Excluir Minha Compra">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      `;

      card.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="text-[11px] font-semibold text-slate-400 uppercase">${compra.data_emissao || 'Data não informada'}</span>
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

    // Banner de Economia da Compra
    const banner = document.getElementById('modal-compra-economia-banner');
    if (compra.economia_estimada > 0) {
      banner.classList.remove('hidden');
      document.getElementById('modal-compra-economia-texto').textContent = `Você economizou nesta compra comprando itens com preço abaixo da média de Atibaia!`;
      document.getElementById('modal-compra-economia-badge').textContent = `Economia: ${formatCurrency(compra.economia_estimada)}`;
    } else {
      banner.classList.add('hidden');
    }

    const tbody = document.getElementById('modal-itens-table');
    tbody.innerHTML = '';

    compra.itens.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = "border-b border-slate-100 hover:bg-slate-50/70 transition";
      
      const packBadge = item.eh_pack
        ? `<div class="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-semibold inline-block mt-0.5">
             Pack c/ ${item.pack_qtd} un (${formatCurrency(item.preco_unitario_fracionado)}/un)
           </div>`
        : '';

      let economiaBadge = '';
      if (item.comparacao) {
        if (item.comparacao.statusEconomia === 'abaixo_media') {
          economiaBadge = `
            <div class="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md inline-flex">
              <i data-lucide="sparkles" class="w-3 h-3 text-emerald-600"></i>
              <span>Economizou ${formatCurrency(item.comparacao.economiaItem)} (-${item.comparacao.pctEconomia}% vs média da cidade ${formatCurrency(item.comparacao.precoMedio)})</span>
            </div>
          `;
        } else if (item.comparacao.statusEconomia === 'acima_media') {
          economiaBadge = `
            <div class="mt-1 text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md inline-block">
              Média em Atibaia: ${formatCurrency(item.comparacao.precoMedio)}
            </div>
          `;
        }
      }

      tr.innerHTML = `
        <td class="px-4 py-3.5 font-medium text-slate-800">
          <div class="font-bold text-slate-900">${escapeHtml(item.nome_original)}</div>
          ${packBadge}
          ${economiaBadge}
        </td>
        <td class="px-4 py-3.5 text-center text-slate-600 text-xs font-bold whitespace-nowrap">
          ${item.quantidade} ${item.unidade || 'UN'}
        </td>
        <td class="px-4 py-3.5 text-right text-slate-600 font-mono text-xs whitespace-nowrap">
          ${formatCurrency(item.valor_unitario)}
          ${item.eh_pack ? `<span class="block text-[10px] text-slate-400 font-sans">${formatCurrency(item.preco_unitario_fracionado)}/un</span>` : ''}
        </td>
        <td class="px-4 py-3.5 text-right font-bold text-slate-900 font-mono text-xs whitespace-nowrap">
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

// Modal do Extrato Detalhado de Economia (Item por Item)
async function abrirModalExtratoEconomia() {
  const modal = document.getElementById('extrato-economia-modal');
  const container = document.getElementById('extrato-itens-container');
  modal.classList.remove('hidden');
  lucide.createIcons();

  container.innerHTML = `
    <div class="text-center py-8 text-slate-400">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2"></div>
      <p class="text-xs">Carregando extrato de economia...</p>
    </div>
  `;

  try {
    const response = await fetch('/api/economia/extrato', { headers: getAuthHeaders() });
    const data = await response.json();

    if (!data.sucesso || !data.extrato || data.extrato.length === 0) {
      document.getElementById('extrato-total-destaque').textContent = 'R$ 0,00';
      document.getElementById('extrato-itens-sub').textContent = 'Nenhuma compra abaixo da média ainda';
      container.innerHTML = `
        <div class="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
          <i data-lucide="receipt" class="w-10 h-10 text-slate-300 mx-auto"></i>
          <h4 class="font-bold text-slate-700 text-sm">Nenhum item abaixo da média encontrado ainda</h4>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">Conforme você e outros usuários escanearem notas de mercados diferentes, o sistema identificará onde você pagou mais barato que a média e listará aqui!</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    document.getElementById('extrato-total-destaque').textContent = formatCurrency(data.totalEconomia);
    document.getElementById('extrato-itens-sub').textContent = `Calculado em ${data.totalItensComEconomia} ${data.totalItensComEconomia === 1 ? 'item que você pagou' : 'itens que você pagou'} abaixo da média`;

    container.innerHTML = '';
    data.extrato.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = "bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-emerald-300 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3";
      
      card.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-bold text-slate-900">${escapeHtml(item.produtoNome)}</span>
            <span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">${escapeHtml(item.mercadoNome)}</span>
            <span class="text-[10px] text-slate-400">${item.dataEmissao || ''}</span>
          </div>
          <div class="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
            <span>Comprado: <strong>${item.quantidade} ${item.unidade}</strong></span>
            <span>Preço pago: <strong class="text-slate-800">${formatCurrency(item.precoPago)}</strong></span>
            <span>Média da cidade: <strong class="text-slate-600">${formatCurrency(item.precoMedio)}</strong></span>
          </div>
        </div>
        <div class="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
          <span class="text-xs text-slate-400 sm:hidden">Você economizou:</span>
          <div class="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-xs font-black shadow-xs">
            <i data-lucide="arrow-down-right" class="w-3.5 h-3.5 text-emerald-700"></i>
            <span>+ ${formatCurrency(item.economiaTotalItem)}</span>
            <span class="text-[10px] font-medium text-emerald-600">(-${item.pctEconomia}%)</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    lucide.createIcons();

  } catch (err) {
    container.innerHTML = `<div class="p-4 bg-rose-50 text-rose-700 rounded-xl text-xs">Erro ao carregar extrato: ${err.message}</div>`;
  }
}

function fecharModalExtratoEconomia() {
  document.getElementById('extrato-economia-modal').classList.add('hidden');
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
        itemCard.className = "p-3.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-emerald-50/50 transition cursor-pointer flex flex-col justify-between gap-2";
        itemCard.onclick = () => {
          document.getElementById('busca-produto-input').value = prod.nome_padrao;
          buscarHistoricoProduto(prod.id);
        };
        itemCard.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <h4 class="font-bold text-xs text-slate-800 line-clamp-2 flex-1">${escapeHtml(prod.nome_padrao)}</h4>
            <button onclick="event.stopPropagation(); adicionarProdutoRapidoNaLista(${prod.id}, '${escapeHtml(prod.nome_padrao).replace(/'/g, "\\'")}')" class="px-2 py-1 bg-emerald-100 hover:bg-emerald-600 hover:text-white text-emerald-800 rounded-lg transition shrink-0 flex items-center gap-1 font-bold text-[10px] shadow-2xs" title="Adicionar à Lista de Compras">
              <i data-lucide="plus" class="w-3 h-3"></i> + Lista
            </button>
          </div>
          <div class="flex justify-between items-center text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
            <span>Comprado ${prod.vezes_comprado}x</span>
            <span class="font-bold text-emerald-700">${formatCurrency(prod.menor_preco)}</span>
          </div>
        `;
        topContainer.appendChild(itemCard);
      });
      lucide.createIcons();
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

let timeoutFiltroCatalogo = null;
function filtrarCatalogoProdutos(filtro) {
  clearTimeout(timeoutFiltroCatalogo);
  const termo = (filtro || '').toLowerCase().trim();
  if (!termo) {
    renderizarCatalogo(catalogoProdutosCache);
    return;
  }
  
  // Filtro rápido no cache local
  const filtrados = catalogoProdutosCache.filter(p => 
    (p.nome_padrao && p.nome_padrao.toLowerCase().includes(termo)) ||
    (p.codigo && p.codigo.includes(termo))
  );
  renderizarCatalogo(filtrados);

  // Busca também na API com debounce para garantir todos os registros do banco de dados
  timeoutFiltroCatalogo = setTimeout(async () => {
    try {
      const response = await fetch(`/api/produtos?q=${encodeURIComponent(termo)}`);
      const data = await response.json();
      if (data.sucesso && data.produtos) {
        renderizarCatalogo(data.produtos);
      }
    } catch (err) {
      console.error("Erro na busca remota do catálogo:", err);
    }
  }, 200);
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
        <div class="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
          <button onclick="adicionarProdutoRapidoNaLista(${prod.id}, '${escapeHtml(prod.nome_padrao).replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition" title="Adicionar à Lista de Compras">
            <i data-lucide="shopping-cart" class="w-3.5 h-3.5 text-emerald-600"></i> + Lista
          </button>
          <button onclick="abrirHistoricoDeProduto(${prod.id}, '${escapeHtml(prod.nome_padrao).replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 transition" title="Ver Histórico de Preços">
            <i data-lucide="trending-up" class="w-3.5 h-3.5"></i> Histórico
          </button>
          <button onclick="abrirModalAdicionarProduto(${prod.id}, '${escapeHtml(prod.nome_padrao).replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition shadow-xs" title="Adicionar à Cesta de Comparação">
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
  const dropdown = document.getElementById('dropdown-busca-historico');
  if (dropdown) dropdown.classList.add('hidden');
  buscarHistoricoProduto(prodId);
  window.scrollTo({ top: document.getElementById('busca-produto-input').offsetTop - 80, behavior: 'smooth' });
}


// ==================== GRUPOS / CESTAS DE COMPARAÇÃO DE MARCAS ====================
let produtoSelecionadoParaGrupo = null;
const timeoutsBuscaCesta = {};

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

      // Vencedor (mais barato da cesta com medida equivalente)
      let vencedorHtml = '';
      if (grupo.vencedor) {
        const v = grupo.vencedor;
        const precoDisplay = formatCurrency(v.menorPreco || v.ultimoPreco);
        const normBadge = v.textoNormalizado ? `<span class="inline-block bg-emerald-200/80 text-emerald-900 text-[10px] font-bold px-1.5 py-0.5 rounded ml-1">${escapeHtml(v.textoNormalizado)}</span>` : '';
        const packVencedor = (v.ehPack && v.valorOriginalPack && v.qtdPack > 1)
          ? `<span class="text-[10px] text-emerald-700 block font-medium mt-0.5">📦 Pack com ${v.qtdPack} un por ${formatCurrency(v.valorOriginalPack)}</span>`
          : '';
        vencedorHtml = `
          <div class="bg-emerald-100/70 border border-emerald-200/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-lg">🏆</span>
              <div>
                <span class="text-[10px] uppercase tracking-wider font-bold text-emerald-800 block">Opção Mais Econômica na Cesta</span>
                <span class="font-black text-xs text-slate-900">${escapeHtml(v.nome_padrao)}</span>
                <span class="text-[11px] text-emerald-800 block">no <strong>${escapeHtml(v.melhorMercado || v.ultimoMercado)}</strong> ${v.melhorEndereco ? `(${escapeHtml(v.melhorEndereco)})` : ''}</span>
                ${packVencedor}
              </div>
            </div>
            <div class="text-right self-end sm:self-auto">
              <span class="text-[10px] text-emerald-700 font-semibold block">Menor Valor</span>
              <div class="flex items-center justify-end gap-1 flex-wrap">
                <span class="text-base font-black text-emerald-800">${precoDisplay}</span>
                ${normBadge}
              </div>
            </div>
          </div>
        `;
      } else if (grupo.produtos && grupo.produtos.length > 0) {
        vencedorHtml = `
          <div class="p-3 bg-amber-50 rounded-lg border border-amber-200 text-center text-xs text-amber-800">
            Aguardando registro de preços para as ${grupo.produtos.length} marcas adicionadas nesta cesta.
          </div>
        `;
      } else {
        vencedorHtml = `
          <div class="p-3 bg-white rounded-lg border border-slate-200 text-center text-xs text-slate-400 italic">
            Nenhum produto adicionado a esta cesta ainda. Digite o nome do produto abaixo para adicionar.
          </div>
        `;
      }

      // Linhas dos produtos adicionados
      let produtosLinhas = '';
      if (grupo.produtos && grupo.produtos.length > 0) {
        produtosLinhas = grupo.produtos.map(p => {
          const ehVencedor = grupo.vencedor && grupo.vencedor.id === p.id;
          const precoItem = p.menorPreco > 0 ? formatCurrency(p.menorPreco) : '--';
          const normTexto = p.textoNormalizado ? ` <span class="text-emerald-700 font-semibold">(${escapeHtml(p.textoNormalizado)})</span>` : '';
          const packObs = (p.ehPack && p.valorOriginalPack && p.qtdPack > 1) 
            ? `<span class="text-[10px] text-slate-400 block font-normal">📦 Pack c/ ${p.qtdPack} un por ${formatCurrency(p.valorOriginalPack)}</span>` 
            : '';
          const btnExcluir = grupo.tipo_cesta === 'dinamica'
            ? `<button onclick="bloquearMarcaCesta(${grupo.id}, ${p.id}, '${escapeHtml(p.nome_padrao).replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition" title="Bloquear Marca (Adicionar à Lista Negra)">
                <i data-lucide="ban" class="w-3.5 h-3.5"></i>
              </button>`
            : `<button onclick="removerProdutoDoGrupo(${grupo.id}, ${p.id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition" title="Remover da Cesta">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>`;

          return `
            <div class="flex items-center justify-between p-2.5 bg-white rounded-lg border ${ehVencedor ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'} text-xs gap-2">
              <div class="flex-1 min-w-0">
                <div class="font-bold text-slate-800 truncate flex items-center gap-1.5">
                  ${ehVencedor ? '⭐' : ''} ${escapeHtml(p.nome_padrao)}
                </div>
                <div class="text-[10px] text-slate-500 mt-0.5">
                  Menor: <strong class="text-emerald-700">${precoItem}</strong>${normTexto} no ${escapeHtml(p.melhorMercado || 'Mercado')}
                  ${packObs}
                </div>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <button onclick="abrirHistoricoDeProduto(${p.id}, '${escapeHtml(p.nome_padrao).replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded-md transition" title="Ver Histórico">
                  <i data-lucide="trending-up" class="w-3.5 h-3.5"></i>
                </button>
                ${btnExcluir}
              </div>
            </div>
          `;
        }).join('');
      }

      // Bloco de Lista Negra / Marcas Bloqueadas
      let bloqueadosHtml = '';
      if (grupo.produtos_bloqueados && grupo.produtos_bloqueados.length > 0) {
        bloqueadosHtml = `
          <div class="mt-2 pt-2 border-t border-slate-200/80">
            <button onclick="alternarListaNegraCesta(${grupo.id})" class="text-[11px] font-bold text-slate-500 hover:text-rose-700 flex items-center justify-between w-full p-2 bg-slate-100/70 hover:bg-rose-50/50 rounded-lg transition cursor-pointer">
              <span class="flex items-center gap-1.5 text-rose-700">
                <i data-lucide="ban" class="w-3.5 h-3.5"></i>
                Lista Negra / Marcas Bloqueadas (${grupo.produtos_bloqueados.length})
              </span>
              <i data-lucide="chevron-down" id="icone-lista-negra-${grupo.id}" class="w-3.5 h-3.5 transition-transform"></i>
            </button>
            <div id="lista-negra-container-${grupo.id}" class="hidden space-y-1.5 pt-2">
              ${grupo.produtos_bloqueados.map(b => `
                <div class="flex items-center justify-between p-2 bg-rose-50/60 rounded-lg border border-rose-100 text-xs gap-2">
                  <div class="min-w-0 flex-1">
                    <span class="font-medium text-slate-700 line-through truncate block">${escapeHtml(b.nome_padrao)}</span>
                    <span class="text-[10px] text-rose-600 font-semibold">Bloqueado nesta cesta</span>
                  </div>
                  <button onclick="desbloquearMarcaCesta(${grupo.id}, ${b.id}, '${escapeHtml(b.nome_padrao).replace(/'/g, "\\'")}')" class="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded text-[11px] font-bold transition flex items-center gap-1 shrink-0 shadow-2xs">
                    <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Reativar
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      const badgeTipo = grupo.tipo_cesta === 'dinamica'
        ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1" title="Atualizada automaticamente com qualquer nova promoção ou marca em Atibaia">
             <i data-lucide="zap" class="w-3 h-3"></i> Dinâmica
           </span>`
        : `<span class="text-[10px] bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
             <i data-lucide="pin" class="w-3 h-3"></i> Fixa
           </span>`;

      card.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <i data-lucide="shopping-basket" class="w-4 h-4 text-emerald-600"></i>
                ${escapeHtml(grupo.nome_grupo)}
              </h4>
              ${badgeTipo}
            </div>
            ${grupo.descricao ? `<p class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(grupo.descricao)}</p>` : ''}
          </div>
          <div class="flex items-center gap-1">
            <button onclick="abrirModalCatalogoProdutos()" class="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-lg transition flex items-center gap-1" title="Ver catálogo geral">
              <i data-lucide="package-search" class="w-3 h-3"></i> Catálogo
            </button>
            <button onclick="excluirGrupo(${grupo.id})" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition" title="Excluir Cesta">
              <i data-lucide="trash" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>

        ${vencedorHtml}

        ${grupo.produtos && grupo.produtos.length > 0 ? `
          <div class="pt-1">
            <button onclick="alternarAcordeaoCesta(${grupo.id})" id="btn-acordeao-cesta-${grupo.id}" class="w-full py-2 px-3 bg-white hover:bg-slate-100/80 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-between transition cursor-pointer shadow-2xs">
              <span class="flex items-center gap-1.5">
                <i data-lucide="layers" class="w-3.5 h-3.5 text-emerald-600"></i>
                Ver todas as ${grupo.produtos.length} marcas candidatas
              </span>
              <i data-lucide="chevron-down" id="icone-acordeao-cesta-${grupo.id}" class="w-4 h-4 text-slate-400 transition-transform"></i>
            </button>
            <div id="cesta-lista-marcas-${grupo.id}" class="hidden space-y-1.5 pt-2">
              ${produtosLinhas}
              ${bloqueadosHtml}
            </div>
          </div>
        ` : bloqueadosHtml}

        <!-- Busca Rápida Inline para Adicionar Produtos na Cesta -->
        <div class="relative pt-2 border-t border-slate-200/80">
          <div class="relative">
            <i data-lucide="search" class="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5"></i>
            <input type="text" 
                   id="cesta-busca-input-${grupo.id}" 
                   oninput="buscarProdutosParaCesta(${grupo.id}, this.value)" 
                   placeholder="🔍 Adicionar outra marca específica nesta cesta..." 
                   class="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none transition shadow-2xs" 
                   autocomplete="off" />
          </div>
          <div id="cesta-dropdown-${grupo.id}" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto z-30 divide-y divide-slate-100">
          </div>
        </div>
      `;

      container.appendChild(card);
    });

    lucide.createIcons();

  } catch (err) {
    console.error("Erro ao carregar grupos:", err);
  }
}

// Alternar Lista Negra da Cesta
function alternarListaNegraCesta(grupoId) {
  const container = document.getElementById(`lista-negra-container-${grupoId}`);
  const icone = document.getElementById(`icone-lista-negra-${grupoId}`);
  if (!container) return;
  const estaOculto = container.classList.contains('hidden');
  if (estaOculto) {
    container.classList.remove('hidden');
    if (icone) icone.classList.add('rotate-180');
  } else {
    container.classList.add('hidden');
    if (icone) icone.classList.remove('rotate-180');
  }
}

// Bloquear marca / Adicionar à Lista Negra
async function bloquearMarcaCesta(grupoId, produtoId, nomeProduto) {
  if (!confirm(`Deseja adicionar "${nomeProduto}" à Lista Negra desta cesta? Ela não será mais sugerida como menor preço.`)) return;
  try {
    const res = await fetch(`/api/grupos/${grupoId}/bloquear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtoId })
    });
    const data = await res.json();
    if (data.sucesso) {
      mostrarNotificacaoToast(`🚫 Marca adicionada à Lista Negra.`);
      await carregarGruposComparacao();
    } else {
      alert('Erro: ' + data.erro);
    }
  } catch (err) {
    alert('Erro de conexão ao bloquear marca.');
  }
}

// Desbloquear marca / Reativar na Cesta
async function desbloquearMarcaCesta(grupoId, produtoId, nomeProduto) {
  try {
    const res = await fetch(`/api/grupos/${grupoId}/desbloquear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtoId })
    });
    const data = await res.json();
    if (data.sucesso) {
      mostrarNotificacaoToast(`✅ Marca reativada na cesta.`);
      await carregarGruposComparacao();
    } else {
      alert('Erro: ' + data.erro);
    }
  } catch (err) {
    alert('Erro de conexão ao desbloquear marca.');
  }
}

// Alternar acordeão de marcas da Cesta
function alternarAcordeaoCesta(grupoId) {
  const container = document.getElementById(`cesta-lista-marcas-${grupoId}`);
  const icone = document.getElementById(`icone-acordeao-cesta-${grupoId}`);
  if (!container) return;
  const estaOculto = container.classList.contains('hidden');
  if (estaOculto) {
    container.classList.remove('hidden');
    if (icone) icone.classList.add('rotate-180');
  } else {
    container.classList.add('hidden');
    if (icone) icone.classList.remove('rotate-180');
  }
}

// Busca rápida autocomplete inline para adicionar produto direto na cesta
function buscarProdutosParaCesta(grupoId, termo) {
  clearTimeout(timeoutsBuscaCesta[grupoId]);
  const dropdown = document.getElementById(`cesta-dropdown-${grupoId}`);
  if (!dropdown) return;
  const q = (termo || '').trim();

  if (q.length < 2) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  dropdown.innerHTML = `
    <div class="p-2.5 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <div class="animate-spin rounded-full h-3 w-3 border-b-2 border-emerald-600"></div>
      <span>Buscando produtos...</span>
    </div>
  `;
  dropdown.classList.remove('hidden');

  timeoutsBuscaCesta[grupoId] = setTimeout(async () => {
    try {
      const res = await fetch(`/api/produtos/autocomplete?q=${encodeURIComponent(q)}&limite=30`);
      const data = await res.json();
      if (!data.sucesso || !data.produtos || data.produtos.length === 0) {
        dropdown.innerHTML = `
          <div class="p-2.5 text-center text-xs text-slate-500">
            Nenhum produto encontrado com "${escapeHtml(q)}".
          </div>
        `;
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = data.produtos.map(p => {
        const norm = p.texto_normalizado ? ` (${p.texto_normalizado})` : '';
        const menor = p.menor_preco ? `Menor: R$ ${Number(p.menor_preco).toFixed(2).replace('.', ',')}${norm}` : '';
        const medio = p.preco_medio ? `Média: R$ ${Number(p.preco_medio).toFixed(2).replace('.', ',')}` : '';
        const precosTexto = [menor, medio].filter(Boolean).join(' • ');

        return `
          <div class="p-2.5 hover:bg-emerald-50/70 transition flex items-center justify-between gap-2 border-b border-slate-100 last:border-b-0">
            <div class="min-w-0 flex-1">
              <p class="font-bold text-slate-900 text-xs truncate">${escapeHtml(p.nome_padrao)}</p>
              <p class="text-[10px] text-slate-500 truncate">${escapeHtml(precosTexto || 'Preço registrado em Atibaia')}</p>
            </div>
            <button onclick="adicionarProdutoAoGrupo(${grupoId}, ${p.id})" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shrink-0 shadow-2xs">
              <i data-lucide="plus" class="w-3 h-3"></i> + Cesta
            </button>
          </div>
        `;
      }).join('');

      dropdown.classList.remove('hidden');
      lucide.createIcons();
    } catch (err) {
      console.error('Erro na busca de produtos para cesta:', err);
    }
  }, 100);
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
    // Limpa input e dropdown da cesta se existirem
    const inputCesta = document.getElementById(`cesta-busca-input-${grupoId}`);
    if (inputCesta) inputCesta.value = '';
    const dropdownCesta = document.getElementById(`cesta-dropdown-${grupoId}`);
    if (dropdownCesta) dropdownCesta.classList.add('hidden');

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
let timeoutBuscaHistorico = null;

const CORES_MERCADOS = [
  { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)', name: 'blue' },
  { border: '#059669', bg: 'rgba(5, 150, 105, 0.15)', name: 'emerald' },
  { border: '#dc2626', bg: 'rgba(220, 38, 38, 0.15)', name: 'red' },
  { border: '#d97706', bg: 'rgba(217, 119, 6, 0.15)', name: 'amber' },
  { border: '#7c3aed', bg: 'rgba(124, 58, 237, 0.15)', name: 'purple' },
  { border: '#db2777', bg: 'rgba(219, 39, 119, 0.15)', name: 'pink' },
  { border: '#0891b2', bg: 'rgba(8, 145, 178, 0.15)', name: 'cyan' }
];

// Busca autocomplete em tempo real para a barra de histórico de preços
function buscarAutocompleteHistorico(termo) {
  clearTimeout(timeoutBuscaHistorico);
  const dropdown = document.getElementById('dropdown-busca-historico');
  if (!dropdown) return;
  const q = (termo || '').trim();

  if (q.length < 2) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  dropdown.innerHTML = `
    <div class="p-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <div class="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-emerald-600"></div>
      <span>Buscando "${escapeHtml(q)}"...</span>
    </div>
  `;
  dropdown.classList.remove('hidden');

  timeoutBuscaHistorico = setTimeout(async () => {
    try {
      const res = await fetch(`/api/produtos/autocomplete?q=${encodeURIComponent(q)}&limite=30`);
      const data = await res.json();
      if (!data.sucesso || !data.produtos || data.produtos.length === 0) {
        dropdown.innerHTML = `
          <div class="p-3 text-center text-xs text-slate-500">
            Nenhum produto encontrado com "${escapeHtml(q)}".
          </div>
        `;
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = data.produtos.map(p => {
        const norm = p.texto_normalizado ? ` (${p.texto_normalizado})` : '';
        const menor = p.menor_preco ? `Menor: R$ ${Number(p.menor_preco).toFixed(2).replace('.', ',')}${norm}` : '';
        const medio = p.preco_medio ? `Média: R$ ${Number(p.preco_medio).toFixed(2).replace('.', ',')}` : '';
        const precosTexto = [menor, medio].filter(Boolean).join(' • ');

        return `
          <div onclick="selecionarProdutoHistorico(${p.id}, '${escapeHtml(p.nome_padrao).replace(/'/g, "\\'")}')" class="p-3 hover:bg-emerald-50/70 cursor-pointer transition flex items-center justify-between gap-2 group">
            <div class="min-w-0 flex-1">
              <p class="font-bold text-slate-900 text-xs truncate group-hover:text-emerald-700">${escapeHtml(p.nome_padrao)}</p>
              <p class="text-[11px] text-slate-500 truncate">${escapeHtml(precosTexto || 'Preço registrado em Atibaia')}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded uppercase">
                ${escapeHtml(p.unidade || 'UN')}
              </span>
              <span class="text-xs text-emerald-600 font-semibold group-hover:translate-x-0.5 transition">&rarr;</span>
            </div>
          </div>
        `;
      }).join('');

      dropdown.classList.remove('hidden');
    } catch (err) {
      console.error('Erro na busca autocomplete de histórico:', err);
    }
  }, 100);
}

function selecionarProdutoHistorico(prodId, nomePadrao) {
  const input = document.getElementById('busca-produto-input');
  if (input) input.value = nomePadrao;
  const dropdown = document.getElementById('dropdown-busca-historico');
  if (dropdown) dropdown.classList.add('hidden');
  buscarHistoricoProduto(prodId);
}

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

// ========================================================
// 📋 LISTA DE COMPRAS INTELIGENTE & OTIMIZADOR DE PREÇOS
// ========================================================

let listasUsuario = [];
let listaAtivaId = null;
let listaAtivaDados = null;
let produtoSelecionadoParaAdicao = null;
let abaOtimizadorAtual = 'monomercado';
let timeoutBuscaLista = null;
let analiseOtimizacaoAtual = null;

// Carregar listas do usuário
async function carregarListasUsuario() {
  try {
    const res = await fetch('/api/listas', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.sucesso) return;

    listasUsuario = data.listas || [];
    const select = document.getElementById('select-listas-usuario');
    if (!select) return;

    if (listasUsuario.length === 0) {
      select.innerHTML = `<option value="">Nenhuma lista criada</option>`;
      return;
    }

    select.innerHTML = listasUsuario.map(l => `
      <option value="${l.id}" ${l.id === listaAtivaId ? 'selected' : ''}>
        ${escapeHtml(l.nome_lista)} (${l.total_itens} ${l.total_itens === 1 ? 'item' : 'itens'})
      </option>
    `).join('');

    if (!listaAtivaId || !listasUsuario.some(l => l.id == listaAtivaId)) {
      listaAtivaId = listasUsuario[0].id;
      select.value = listaAtivaId;
    }

    await carregarDetalhesLista(listaAtivaId);
  } catch (err) {
    console.error('Erro ao carregar listas:', err);
  }
}

// Selecionar lista ativa
function selecionarListaAtiva(id) {
  listaAtivaId = parseInt(id);
  carregarDetalhesLista(listaAtivaId);
}

// Abrir e fechar modal de nova lista
function abrirModalNovaLista() {
  const modal = document.getElementById('nova-lista-modal');
  const input = document.getElementById('nova-lista-nome-input');
  if (modal) modal.classList.remove('hidden');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  lucide.createIcons();
}

function fecharModalNovaLista() {
  const modal = document.getElementById('nova-lista-modal');
  if (modal) modal.classList.add('hidden');
}

// Salvar nova lista
async function salvarNovaLista() {
  const input = document.getElementById('nova-lista-nome-input');
  const nome = (input ? input.value : '').trim();
  if (!nome) {
    alert('Informe o nome da nova lista.');
    return;
  }

  try {
    const res = await fetch('/api/listas', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ nome })
    });
    const data = await res.json();
    if (data.sucesso) {
      fecharModalNovaLista();
      listaAtivaId = data.lista.id;
      await carregarListasUsuario();
    } else {
      alert('Erro ao criar lista: ' + data.erro);
    }
  } catch (err) {
    alert('Erro de conexão ao criar lista.');
  }
}

// Excluir lista atual
async function excluirListaAtual() {
  if (!listaAtivaId) return;
  const listaObj = listasUsuario.find(l => l.id == listaAtivaId);
  const nome = listaObj ? listaObj.nome_lista : 'esta lista';
  if (!confirm(`Tem certeza que deseja excluir a lista "${nome}"?`)) return;

  try {
    const res = await fetch(`/api/listas/${listaAtivaId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.sucesso) {
      listaAtivaId = null;
      await carregarListasUsuario();
    }
  } catch (err) {
    alert('Erro ao excluir lista.');
  }
}

// Carregar detalhes dos itens da lista
async function carregarDetalhesLista(listaId) {
  if (!listaId) return;
  const container = document.getElementById('lista-itens-container');
  const totalBadge = document.getElementById('lista-qtd-total');
  const progressoBadge = document.getElementById('lista-progresso-badge');

  if (container) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-2"></div>
        <p class="text-xs">Carregando itens da lista...</p>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/listas/${listaId}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.sucesso) return;

    listaAtivaDados = data.lista;
    const itens = listaAtivaDados.itens || [];

    if (totalBadge) totalBadge.textContent = itens.length;
    const comprados = itens.filter(i => i.comprado == 1).length;
    if (progressoBadge) {
      progressoBadge.textContent = `${comprados} de ${itens.length} comprados`;
      if (comprados === itens.length && itens.length > 0) {
        progressoBadge.className = "text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md";
      } else {
        progressoBadge.className = "text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md";
      }
    }

    if (itens.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-400 space-y-2">
          <i data-lucide="shopping-basket" class="w-10 h-10 mx-auto text-slate-300"></i>
          <p class="text-sm font-semibold text-slate-600">Sua lista está vazia</p>
          <p class="text-xs text-slate-400 max-w-xs mx-auto">Use a barra acima para buscar produtos em Atibaia e adicionar à sua lista.</p>
        </div>
      `;
      lucide.createIcons();
      document.getElementById('box-otimizador-cesta')?.classList.add('hidden');
      return;
    }

    document.getElementById('box-otimizador-cesta')?.classList.remove('hidden');

    container.innerHTML = itens.map(item => {
      const ehComprado = item.comprado == 1;
      const ehCesta = !!item.eh_cesta;

      let tituloItem = '';
      let subtituloItem = '';

      if (ehCesta) {
        const nomeLimpo = item.nome_padrao.replace('[Cesta Flexível] ', '');
        tituloItem = `
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1">
              <i data-lucide="layers" class="w-3 h-3"></i> Cesta Flexível
            </span>
            <span class="font-bold text-slate-900 text-sm ${ehComprado ? 'line-through text-slate-500' : ''}">${escapeHtml(nomeLimpo)}</span>
          </div>
        `;
        const menorRef = item.menor_preco_cidade ? `Menor em Atibaia: R$ ${Number(item.menor_preco_cidade).toFixed(2).replace('.', ',')}` : 'Preço dinâmico';
        subtituloItem = `${item.total_opcoes_cesta || 0} marcas equivalentes • ${menorRef} (escolhe o mais barato por mercado)`;
      } else {
        tituloItem = `
          <p class="font-bold text-slate-900 text-sm truncate ${ehComprado ? 'line-through text-slate-500' : ''}">
            ${escapeHtml(item.nome_padrao)}
          </p>
        `;
        const refMedio = item.preco_medio_cidade ? `Média Atibaia: R$ ${Number(item.preco_medio_cidade).toFixed(2).replace('.', ',')}` : 'Preço sob consulta';
        const refMenor = item.menor_preco_cidade ? ` • Menor: R$ ${Number(item.menor_preco_cidade).toFixed(2).replace('.', ',')}` : '';
        subtituloItem = `${refMedio}${refMenor}`;
      }

      return `
        <div class="p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition ${ehComprado ? 'opacity-60 bg-slate-50/50' : ''}">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <input type="checkbox" ${ehComprado ? 'checked' : ''} onchange="alternarCompradoItemLista(${item.item_id}, ${ehComprado})" class="w-5 h-5 rounded-lg text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer" />
            <div class="min-w-0 flex-1">
              ${tituloItem}
              <p class="text-xs text-slate-500 truncate mt-0.5">
                ${escapeHtml(subtituloItem)}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- Controle de Quantidade -->
            <div class="flex items-center border border-slate-200 rounded-lg bg-white shadow-2xs overflow-hidden">
              <button onclick="alterarQtdItemLista(${item.item_id}, ${Math.max(0.1, item.quantidade - 1)})" class="px-2 py-1 text-slate-500 hover:bg-slate-100 text-xs font-bold transition">-</button>
              <span class="px-2 text-xs font-bold text-slate-800 min-w-[28px] text-center">${item.quantidade} <span class="text-[10px] font-normal text-slate-500">${escapeHtml(item.unidade || 'UN')}</span></span>
              <button onclick="alterarQtdItemLista(${item.item_id}, ${item.quantidade + 1})" class="px-2 py-1 text-slate-500 hover:bg-slate-100 text-xs font-bold transition">+</button>
            </div>

            <button onclick="removerItemLista(${item.item_id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Remover item">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();

    // Dispara a otimização de preços
    await carregarOtimizacaoLista(listaId);
  } catch (err) {
    console.error('Erro ao carregar detalhes da lista:', err);
  }
}

// Busca autocomplete de produtos para adicionar na lista (Ultra-rápido)
function buscarProdutosParaLista(termo) {
  clearTimeout(timeoutBuscaLista);
  const dropdown = document.getElementById('dropdown-busca-lista');
  const q = (termo || '').trim();

  if (q.length < 2) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  // Feedback instantâneo
  dropdown.innerHTML = `
    <div class="p-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <div class="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-emerald-600"></div>
      <span>Buscando "${escapeHtml(q)}"...</span>
    </div>
  `;
  dropdown.classList.remove('hidden');

  timeoutBuscaLista = setTimeout(async () => {
    try {
      const res = await fetch(`/api/produtos/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.sucesso || !data.produtos || data.produtos.length === 0) {
        dropdown.innerHTML = `
          <div class="p-3 text-center text-xs text-slate-500">
            Nenhum produto encontrado com "${escapeHtml(q)}".
          </div>
        `;
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = data.produtos.map(p => {
        const norm = p.texto_normalizado ? ` (${p.texto_normalizado})` : '';
        const menor = p.menor_preco ? `Menor: R$ ${Number(p.menor_preco).toFixed(2).replace('.', ',')}${norm}` : '';
        const medio = p.preco_medio ? `Média: R$ ${Number(p.preco_medio).toFixed(2).replace('.', ',')}` : '';
        const precosTexto = [menor, medio].filter(Boolean).join(' • ');

        return `
          <div onclick='selecionarProdutoParaLista(${JSON.stringify(p).replace(/'/g, "&apos;")})' class="p-3 hover:bg-emerald-50/60 cursor-pointer transition flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="font-bold text-slate-900 text-xs truncate">${escapeHtml(p.nome_padrao)}</p>
              <p class="text-[11px] text-slate-500 truncate">${escapeHtml(precosTexto || 'Preço nos mercados de Atibaia')}</p>
            </div>
            <span class="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-md shrink-0">
              ${escapeHtml(p.unidade || 'UN')}
            </span>
          </div>
        `;
      }).join('');

      dropdown.classList.remove('hidden');
    } catch (err) {
      console.error('Erro na busca de produtos:', err);
    }
  }, 100);
}

// Selecionar produto no dropdown
function selecionarProdutoParaLista(p) {
  produtoSelecionadoParaAdicao = p;
  document.getElementById('dropdown-busca-lista')?.classList.add('hidden');
  const box = document.getElementById('box-produto-selecionado-lista');
  const nomeEl = document.getElementById('sel-produto-nome');
  const refEl = document.getElementById('sel-produto-ref');
  const qtdInput = document.getElementById('input-qtd-adicao');

  if (nomeEl) nomeEl.textContent = p.nome_padrao;
  if (refEl) {
    const menor = p.menor_preco ? `Menor: R$ ${Number(p.menor_preco).toFixed(2).replace('.', ',')}` : '';
    const medio = p.preco_medio ? `Média: R$ ${Number(p.preco_medio).toFixed(2).replace('.', ',')}` : '';
    refEl.textContent = [menor, medio].filter(Boolean).join(' | ') || 'Preço registrado em Atibaia';
  }
  if (qtdInput) qtdInput.value = 1;
  if (box) box.classList.remove('hidden');
}

// Ajustar quantidade
function ajustarQtdAdicao(delta) {
  const input = document.getElementById('input-qtd-adicao');
  if (!input) return;
  let val = parseFloat(input.value) || 1;
  val = Math.max(0.1, Number((val + delta).toFixed(2)));
  input.value = val;
}

// Confirmar adição de produto avulso à lista
async function confirmarAdicaoItemLista() {
  if (!listaAtivaId || !produtoSelecionadoParaAdicao) return;
  const inputQtd = document.getElementById('input-qtd-adicao');
  const qtd = parseFloat(inputQtd ? inputQtd.value : 1) || 1;

  try {
    const res = await fetch(`/api/listas/${listaAtivaId}/itens`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        produto_id: produtoSelecionadoParaAdicao.id,
        quantidade: qtd
      })
    });
    const data = await res.json();
    if (data.sucesso) {
      produtoSelecionadoParaAdicao = null;
      document.getElementById('box-produto-selecionado-lista')?.classList.add('hidden');
      const inputBusca = document.getElementById('input-busca-lista');
      if (inputBusca) inputBusca.value = '';
      await carregarDetalhesLista(listaAtivaId);
    } else {
      alert('Erro ao adicionar produto: ' + data.erro);
    }
  } catch (err) {
    alert('Erro de conexão ao adicionar produto.');
  }
}

// ==================== MODAL: ADICIONAR CESTA FLEXÍVEL À LISTA ====================
async function abrirModalAddCestaNaLista() {
  if (!listaAtivaId) {
    alert("Selecione ou crie uma lista de compras primeiro.");
    return;
  }
  const modal = document.getElementById('modal-add-cesta-lista');
  const select = document.getElementById('select-cesta-flexivel');
  if (!modal || !select) return;

  select.innerHTML = `<option value="">Carregando cestas...</option>`;
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/grupos');
    const data = await res.json();
    const grupos = data.grupos || [];

    if (grupos.length === 0) {
      select.innerHTML = `<option value="">Nenhuma cesta criada ainda. Crie uma na aba Preços.</option>`;
      return;
    }

    select.innerHTML = grupos.map(g => `
      <option value="${g.id}">
        ${escapeHtml(g.nome_grupo)} (${g.total_produtos} marcas cadastradas)
      </option>
    `).join('');

    lucide.createIcons();
  } catch (err) {
    select.innerHTML = `<option value="">Erro ao carregar cestas</option>`;
  }
}

function fecharModalAddCestaNaLista() {
  document.getElementById('modal-add-cesta-lista')?.classList.add('hidden');
}

async function confirmarAdicaoCestaNaLista() {
  if (!listaAtivaId) return;
  const select = document.getElementById('select-cesta-flexivel');
  const inputQtd = document.getElementById('input-qtd-cesta-flexivel');
  const grupoId = parseInt(select ? select.value : 0);
  const qtd = parseFloat(inputQtd ? inputQtd.value : 1) || 1;

  if (!grupoId) {
    alert("Por favor, selecione uma cesta de comparação.");
    return;
  }

  try {
    const res = await fetch(`/api/listas/${listaAtivaId}/itens`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        grupo_id: grupoId,
        quantidade: qtd
      })
    });
    const data = await res.json();
    if (data.sucesso) {
      fecharModalAddCestaNaLista();
      mostrarNotificacaoToast("🧺 Cesta Flexível adicionada à sua lista!");
      await carregarDetalhesLista(listaAtivaId);
    } else {
      alert("Erro ao adicionar cesta: " + data.erro);
    }
  } catch (err) {
    alert("Erro de conexão ao adicionar cesta flexível.");
  }
}

// ==================== MODAL: CRIAÇÃO / ADIÇÃO RÁPIDA EM MASSA NA CESTA ====================
let timeoutMassaBusca = null;
let produtosEncontradosMassa = [];
let grupoIdMassaDestino = null;

function abrirModalCestaMassa(grupoId = null) {
  grupoIdMassaDestino = grupoId;
  const modal = document.getElementById('modal-cesta-massa');
  const boxNome = document.getElementById('box-massa-nome-cesta');
  const inputNome = document.getElementById('massa-cesta-nome');
  const inputBusca = document.getElementById('massa-busca-termo');
  const container = document.getElementById('massa-itens-container');

  if (inputNome) inputNome.value = '';
  if (inputBusca) inputBusca.value = '';
  produtosEncontradosMassa = [];
  atualizarContadorSelecaoMassa();

  if (boxNome) {
    if (grupoId) {
      boxNome.classList.add('hidden');
    } else {
      boxNome.classList.remove('hidden');
    }
  }

  if (container) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400 text-xs">
        Digite uma palavra-chave acima (ex: <strong>Arroz</strong>, <strong>Sabonete</strong>, <strong>Leite</strong>) para buscar e selecionar todas as marcas equivalentes em 1 clique.
      </div>
    `;
  }

  modal?.classList.remove('hidden');
  lucide.createIcons();
  if (!grupoId && inputNome) setTimeout(() => inputNome.focus(), 100);
  else if (inputBusca) setTimeout(() => inputBusca.focus(), 100);
}

function fecharModalCestaMassa() {
  document.getElementById('modal-cesta-massa')?.classList.add('hidden');
  grupoIdMassaDestino = null;
  produtosEncontradosMassa = [];
}

function buscarProdutosParaCestaMassa(termo) {
  clearTimeout(timeoutMassaBusca);
  const q = (termo || '').trim();
  const container = document.getElementById('massa-itens-container');
  if (!container) return;

  if (q.length < 2) {
    container.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs">Digite pelo menos 2 letras para buscar...</div>`;
    produtosEncontradosMassa = [];
    atualizarContadorSelecaoMassa();
    return;
  }

  container.innerHTML = `
    <div class="p-6 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
      <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600"></div>
      <span>Localizando todos os produtos com "${escapeHtml(q)}"...</span>
    </div>
  `;

  timeoutMassaBusca = setTimeout(async () => {
    try {
      const res = await fetch(`/api/produtos/autocomplete?q=${encodeURIComponent(q)}&limite=100`);
      const data = await res.json();
      produtosEncontradosMassa = (data.sucesso && data.produtos) ? data.produtos : [];

      if (produtosEncontradosMassa.length === 0) {
        container.innerHTML = `<div class="p-8 text-center text-slate-500 text-xs">Nenhum produto encontrado com "${escapeHtml(q)}".</div>`;
        atualizarContadorSelecaoMassa();
        return;
      }

      // Preenche a lista com todos os itens marcados por padrão para agilidade!
      container.innerHTML = produtosEncontradosMassa.map(p => {
        const norm = p.texto_normalizado ? ` (${p.texto_normalizado})` : '';
        const menor = p.menor_preco ? `Menor: R$ ${Number(p.menor_preco).toFixed(2).replace('.', ',')}${norm}` : '';
        const medio = p.preco_medio ? `Média: R$ ${Number(p.preco_medio).toFixed(2).replace('.', ',')}` : '';
        const precosTexto = [menor, medio].filter(Boolean).join(' • ');

        return `
          <label class="p-3 bg-white hover:bg-emerald-50/50 rounded-xl border border-slate-200 transition flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="massa-chk-item" value="${p.id}" checked onchange="atualizarContadorSelecaoMassa()" class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer" />
            <div class="flex-1 min-w-0">
              <p class="font-bold text-slate-900 text-xs truncate">${escapeHtml(p.nome_padrao)}</p>
              <p class="text-[10px] text-slate-500 truncate">${escapeHtml(precosTexto || 'Preço registrado em Atibaia')}</p>
            </div>
            <span class="text-[10px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded uppercase">
              ${escapeHtml(p.unidade || 'UN')}
            </span>
          </label>
        `;
      }).join('');

      atualizarContadorSelecaoMassa();
      lucide.createIcons();
    } catch (err) {
      container.innerHTML = `<div class="p-4 text-rose-600 text-xs">Erro na busca: ${err.message}</div>`;
    }
  }, 150);
}

function alternarSelecaoTodosCestaMassa(selecionar) {
  const checkboxes = document.querySelectorAll('input[name="massa-chk-item"]');
  checkboxes.forEach(chk => {
    chk.checked = !!selecionar;
  });
  atualizarContadorSelecaoMassa();
}

function atualizarContadorSelecaoMassa() {
  const totalEl = document.getElementById('massa-total-encontrados');
  const qtdEl = document.getElementById('massa-qtd-selecionados');
  const checkboxes = document.querySelectorAll('input[name="massa-chk-item"]');
  const selecionados = Array.from(checkboxes).filter(c => c.checked).length;

  if (totalEl) totalEl.textContent = checkboxes.length;
  if (qtdEl) qtdEl.textContent = selecionados;
}

async function salvarCestaMassa() {
  const checkboxes = document.querySelectorAll('input[name="massa-chk-item"]:checked');
  const produtoIds = Array.from(checkboxes).map(c => parseInt(c.value));

  if (produtoIds.length === 0) {
    alert("Por favor, selecione pelo menos um produto.");
    return;
  }

  try {
    let grupoId = grupoIdMassaDestino;

    if (!grupoId) {
      const inputNome = document.getElementById('massa-cesta-nome');
      const nome = (inputNome ? inputNome.value : '').trim();
      if (!nome) {
        alert("Por favor, informe o nome da Cesta de Comparação (ex: Cesta de Sabonetes, Arroz 5kg...).");
        inputNome?.focus();
        return;
      }

      // Cria a cesta primeiro
      const resGrupo = await fetch('/api/grupos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          descricao: `Criada com ${produtoIds.length} marcas equivalentes`
        })
      });
      const dataGrupo = await resGrupo.json();
      if (!dataGrupo.sucesso) throw new Error(dataGrupo.erro);
      grupoId = dataGrupo.grupo.id;
    }

    // Adiciona todos os produtos em massa (Bulk)
    const resBulk = await fetch(`/api/grupos/${grupoId}/produtos/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produtoIds })
    });
    const dataBulk = await resBulk.json();
    if (!dataBulk.sucesso) throw new Error(dataBulk.erro);

    fecharModalCestaMassa();
    mostrarNotificacaoToast(`✨ Cesta criada com sucesso com ${produtoIds.length} marcas!`);
    await carregarGruposComparacao();
  } catch (err) {
    alert(`Erro ao salvar cesta: ${err.message}`);
  }
}

// Alternar status comprado
async function alternarCompradoItemLista(itemId, compradoAtual) {
  try {
    await fetch(`/api/listas/itens/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ comprado: !compradoAtual })
    });
    await carregarDetalhesLista(listaAtivaId);
  } catch (err) {
    console.error('Erro ao atualizar item:', err);
  }
}

// Alterar quantidade de um item já na lista
async function alterarQtdItemLista(itemId, novaQtd) {
  try {
    await fetch(`/api/listas/itens/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ quantidade: novaQtd })
    });
    await carregarDetalhesLista(listaAtivaId);
  } catch (err) {
    console.error('Erro ao alterar quantidade:', err);
  }
}

// Remover item da lista
async function removerItemLista(itemId) {
  try {
    await fetch(`/api/listas/itens/${itemId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    await carregarDetalhesLista(listaAtivaId);
  } catch (err) {
    console.error('Erro ao remover item:', err);
  }
}

// OTIMIZADOR DE PREÇOS EM TEMPO REAL
async function carregarOtimizacaoLista(listaId) {
  if (!listaId) return;
  try {
    const res = await fetch(`/api/listas/${listaId}/otimizacao`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.sucesso) return;

    analiseOtimizacaoAtual = data.analise;
    renderizarOtimizacao(analiseOtimizacaoAtual);
  } catch (err) {
    console.error('Erro ao carregar otimização de preços:', err);
  }
}

function alternarAbaOtimizador(aba) {
  abaOtimizadorAtual = aba;
  ['monomercado', 'dividido', 'matriz'].forEach(a => {
    const btn = document.getElementById(`tab-otim-${a}`);
    const cont = document.getElementById(`otim-conteudo-${a}`);
    if (a === aba) {
      if (btn) btn.className = "px-3 py-1.5 rounded-lg bg-white text-emerald-700 shadow-xs font-bold transition";
      if (cont) cont.classList.remove('hidden');
    } else {
      if (btn) btn.className = "px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition";
      if (cont) cont.classList.add('hidden');
    }
  });
  lucide.createIcons();
}

// Alternar visualização de itens do mercado no ranking do Radar da Economia
function alternarDetalhesMercadoRanking(mercadoId) {
  const drawer = document.getElementById(`detalhes-ranking-mercado-${mercadoId}`);
  const icon = document.getElementById(`icone-ranking-mercado-${mercadoId}`);
  if (!drawer) return;
  const isHidden = drawer.classList.contains('hidden');
  if (isHidden) {
    drawer.classList.remove('hidden');
    if (icon) icon.classList.add('rotate-180');
  } else {
    drawer.classList.add('hidden');
    if (icon) icon.classList.remove('rotate-180');
  }
}

// Renderiza todas as visões do otimizador
function renderizarOtimizacao(analise) {
  if (!analise || analise.totalItens === 0) return;

  // 1. Cenário Monomercado (Ranking)
  const rankingContainer = document.getElementById('ranking-mercados-container');
  if (rankingContainer) {
    if (!analise.rankingMercados || analise.rankingMercados.length === 0) {
      rankingContainer.innerHTML = `<div class="p-6 text-center text-xs text-slate-500 col-span-2">Nenhum preço recente registrado para os itens desta lista.</div>`;
    } else {
      rankingContainer.innerHTML = analise.rankingMercados.map((m, idx) => {
        const ehMelhor = idx === 0 && m.pctDisponibilidade >= 50;
        const selo = idx === 0 ? '🥇 Menor Preço' : (idx === 1 ? '🥈 2º Lugar' : (idx === 2 ? '🥉 3º Lugar' : ''));
        const corCard = ehMelhor ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20' : 'border-slate-200 bg-white';
        const corTotal = ehMelhor ? 'text-emerald-700' : 'text-slate-900';

        const itensDisponiveis = (m.detalhesItens || []).filter(d => d.disponivel);
        const itensFaltantes = (m.detalhesItens || []).filter(d => !d.disponivel);

        return `
          <div class="rounded-2xl border ${corCard} shadow-xs transition overflow-hidden">
            <div onclick="alternarDetalhesMercadoRanking(${m.mercadoId})" class="p-4 cursor-pointer hover:bg-slate-50/60 transition flex flex-col justify-between gap-3">
              <div class="space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-bold text-slate-900 text-sm truncate">${escapeHtml(m.mercadoNome)}</span>
                  ${selo ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${ehMelhor ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}">${selo}</span>` : ''}
                </div>
                <p class="text-[11px] text-slate-500 truncate">${escapeHtml(m.endereco || 'Atibaia/SP')}</p>
              </div>

              <div class="pt-2 border-t border-slate-100/80 flex items-end justify-between">
                <div>
                  <span class="text-[11px] text-slate-500 block">Total da Cesta</span>
                  <span class="text-xl font-black ${corTotal}">R$ ${m.totalCesta.toFixed(2).replace('.', ',')}</span>
                </div>
                <div class="text-right flex items-center gap-1.5">
                  <div>
                    <span class="text-xs font-semibold ${m.pctDisponibilidade === 100 ? 'text-emerald-700' : 'text-amber-700'} block">
                      ${m.itensEncontrados} de ${m.totalItensLista} itens
                    </span>
                    <span class="text-[10px] text-slate-400">(${m.pctDisponibilidade}% disponível)</span>
                  </div>
                  <i id="icone-ranking-mercado-${m.mercadoId}" data-lucide="chevron-down" class="w-4 h-4 text-slate-400 transition-transform duration-200"></i>
                </div>
              </div>
            </div>

            <!-- Drawer com Detalhes dos Itens do Mercado -->
            <div id="detalhes-ranking-mercado-${m.mercadoId}" class="hidden border-t border-slate-200 bg-slate-50/80 p-3 space-y-2">
              <div class="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                <span>Itens em ${escapeHtml(m.mercadoNome)}</span>
                <span class="text-slate-400 font-normal text-[10px]">${m.itensEncontrados} de ${m.totalItensLista} encontrados</span>
              </div>

              <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                ${itensDisponiveis.map(it => {
                  const bannerKit = (it.ehPack && it.qtdPack > 1) ? `
                    <div class="p-2 bg-amber-50/90 border border-amber-200/80 rounded-lg text-[11px] text-amber-900 space-y-1">
                      <div class="flex items-start gap-1">
                        <span>💡</span>
                        <span>Preço unitário de <strong>R$ ${it.precoUnitario.toFixed(2).replace('.', ',')}</strong> referente ao <strong>Kit com ${it.qtdPack} un por R$ ${(it.valorOriginalPack || (it.precoUnitario * it.qtdPack)).toFixed(2).replace('.', ',')}</strong></span>
                      </div>
                      ${it.itemId && it.quantidade !== it.qtdPack ? `
                        <div class="pt-0.5">
                          <button onclick="alterarQtdItemLista(${it.itemId}, ${it.qtdPack})" class="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[10px] font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer">
                            <i data-lucide="plus-circle" class="w-3 h-3"></i> Ajustar lista para ${it.qtdPack} un (Levar Kit completo)
                          </button>
                        </div>
                      ` : ''}
                    </div>
                  ` : '';

                  return `
                    <div class="p-2 bg-white rounded-xl border border-slate-200/80 space-y-1.5 text-xs shadow-2xs">
                      <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0 flex-1">
                          <div class="font-bold text-slate-900 truncate">${escapeHtml(it.produtoEscolhidoNome || it.nome)}</div>
                          <div class="text-[10px] text-slate-500">${it.quantidade} un x R$ ${it.precoUnitario.toFixed(2).replace('.', ',')}</div>
                        </div>
                        <span class="font-bold text-slate-900 shrink-0">R$ ${it.subtotal.toFixed(2).replace('.', ',')}</span>
                      </div>
                      ${bannerKit}
                    </div>
                  `;
                }).join('')}

                ${itensFaltantes.map(it => `
                  <div class="p-2 bg-rose-50/50 rounded-xl border border-rose-100/80 flex items-center justify-between gap-2 text-xs opacity-75">
                    <div class="min-w-0 flex-1">
                      <div class="font-medium text-slate-700 truncate">${escapeHtml(it.nome)}</div>
                      <div class="text-[10px] text-rose-600">Sem preço recente registrado</div>
                    </div>
                    <span class="text-[9px] font-bold text-rose-600 bg-rose-100/70 px-1.5 py-0.5 rounded">Faltante</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. Cenário Dividido Inteligente
  const bannerDividido = document.getElementById('cenario-dividido-banner');
  const gruposDividido = document.getElementById('cenario-dividido-grupos');

  if (bannerDividido && gruposDividido) {
    const div = analise.cenarioDividido;
    if (!div || div.gruposMercado.length === 0) {
      bannerDividido.innerHTML = `<p class="text-xs">Não foi possível calcular o cenário dividido.</p>`;
      gruposDividido.innerHTML = '';
    } else {
      const economiaTexto = div.economiaVsMelhorUnico > 0
        ? `🔥 <strong>Economia Extra: R$ ${div.economiaVsMelhorUnico.toFixed(2).replace('.', ',')} (${div.pctEconomiaExtra}%)</strong> comparado a comprar tudo em um só lugar!`
        : `💡 Comprando pelo menor preço de cada item em Atibaia.`;

      bannerDividido.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span class="text-xs text-emerald-100 font-semibold uppercase tracking-wider">Combinação de Menor Preço Absoluto</span>
            <div class="text-2xl sm:text-3xl font-black mt-0.5">R$ ${div.totalOtimizado.toFixed(2).replace('.', ',')}</div>
            <p class="text-xs text-emerald-100 mt-1">${economiaTexto}</p>
          </div>
          <div class="bg-emerald-800/80 px-4 py-2.5 rounded-xl border border-emerald-500/50 text-xs">
            🛒 <strong>${div.totalMercadosEnvolvidos} ${div.totalMercadosEnvolvidos === 1 ? 'Supermercado' : 'Supermercados'}</strong> para visitar
          </div>
        </div>
      `;

      gruposDividido.innerHTML = div.gruposMercado.map(g => `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div class="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs">🛒</span>
              <div>
                <h4 class="font-bold text-slate-900 text-xs sm:text-sm">${escapeHtml(g.mercadoNome)}</h4>
                <p class="text-[10px] text-slate-500 truncate">${escapeHtml(g.endereco || 'Atibaia/SP')}</p>
              </div>
            </div>
            <span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
              Subtotal: R$ ${g.subtotal.toFixed(2).replace('.', ',')}
            </span>
          </div>

          <div class="divide-y divide-slate-100 p-2">
            ${g.itens.map(it => {
              const normTag = it.textoNormalizado ? ` <span class="text-emerald-700 font-semibold">(${escapeHtml(it.textoNormalizado)})</span>` : '';
              const bannerKitDiv = (it.ehPack && it.qtdPack > 1) ? `
                <div class="p-2 bg-amber-50/90 border border-amber-200/80 rounded-lg text-[11px] text-amber-900 space-y-1 mt-1">
                  <div class="flex items-start gap-1">
                    <span>💡</span>
                    <span>Preço unitário de <strong>R$ ${it.precoUnitario.toFixed(2).replace('.', ',')}</strong> referente ao <strong>Kit com ${it.qtdPack} un por R$ ${(it.valorOriginalPack || (it.precoUnitario * it.qtdPack)).toFixed(2).replace('.', ',')}</strong></span>
                  </div>
                  ${it.itemId && it.quantidade !== it.qtdPack ? `
                    <div class="pt-0.5">
                      <button onclick="alterarQtdItemLista(${it.itemId}, ${it.qtdPack})" class="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[10px] font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer">
                        <i data-lucide="plus-circle" class="w-3 h-3"></i> Ajustar lista para ${it.qtdPack} un (Levar Kit completo)
                      </button>
                    </div>
                  ` : ''}
                </div>
              ` : '';

              return `
                <div class="p-2.5 space-y-1 hover:bg-slate-50 transition text-xs">
                  <div class="flex items-center justify-between">
                    <div class="min-w-0 flex-1">
                      <p class="font-semibold text-slate-800 truncate">${escapeHtml(it.nome)}</p>
                      <p class="text-[11px] text-slate-500">${it.quantidade} ${escapeHtml(it.unidade || 'UN')} x R$ ${it.precoUnitario.toFixed(2).replace('.', ',')}${normTag}</p>
                    </div>
                    <span class="font-bold text-slate-900 ml-2">R$ ${it.subtotal.toFixed(2).replace('.', ',')}</span>
                  </div>
                  ${bannerKitDiv}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('');
    }
  }

  // 3. Matriz Comparativa de Preços
  const thead = document.getElementById('matriz-precos-thead');
  const tbody = document.getElementById('matriz-precos-tbody');

  if (thead && tbody && analise.comparativoItens) {
    const mercadosIds = analise.rankingMercados.map(m => m.mercadoId);
    const mercadosNomes = analise.rankingMercados.map(m => m.mercadoNome);

    thead.innerHTML = `
      <tr>
        <th class="px-3 py-2.5">Item / Cesta</th>
        <th class="px-3 py-2.5 text-center">Qtd</th>
        ${mercadosNomes.map(nm => `<th class="px-3 py-2.5 text-right whitespace-nowrap">${escapeHtml(nm)}</th>`).join('')}
        <th class="px-3 py-2.5 text-right">Média Atibaia</th>
      </tr>
    `;

    tbody.innerHTML = analise.comparativoItens.map(it => {
      const precoMedioFmt = it.precoMedio ? `R$ ${it.precoMedio.toFixed(2).replace('.', ',')}` : '--';
      const normLinha = (it.melhorTextoNormalizado || it.textoNormalizado) ? `<span class="block text-[10px] text-emerald-700 font-semibold truncate">${escapeHtml(it.melhorTextoNormalizado || it.textoNormalizado)}</span>` : '';

      const colunasMercados = mercadosIds.map(mId => {
        const dadoPreco = it.precosPorMercado[mId];
        if (!dadoPreco) {
          return `<td class="px-3 py-2 text-right text-slate-300 font-mono text-[11px]">--</td>`;
        }
        const ehMenor = dadoPreco.precoUnitario === it.menorPreco;
        const cellClass = ehMenor ? 'bg-emerald-50 text-emerald-800 font-bold' : 'text-slate-700';
        const subtituloEscolhido = dadoPreco.produtoEscolhidoNome
          ? `<span class="block text-[9px] font-normal text-slate-500 truncate max-w-[120px]" title="${escapeHtml(dadoPreco.produtoEscolhidoNome)}">${escapeHtml(dadoPreco.produtoEscolhidoNome)}</span>`
          : '';
        const normCell = dadoPreco.textoNormalizado ? `<span class="block text-[9px] text-emerald-700 font-semibold">${escapeHtml(dadoPreco.textoNormalizado)}</span>` : '';
        const packCell = (dadoPreco.ehPack && dadoPreco.qtdPack > 1)
          ? `<span class="block text-[9px] text-amber-700 font-semibold">📦 Kit ${dadoPreco.qtdPack} un</span>`
          : '';

        return `
          <td class="px-3 py-2 text-right whitespace-nowrap ${cellClass}">
            <div>R$ ${dadoPreco.precoUnitario.toFixed(2).replace('.', ',')}${ehMenor ? ' ⭐' : ''}</div>
            ${normCell}
            ${packCell}
            ${subtituloEscolhido}
          </td>
        `;
      }).join('');

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="px-3 py-2 font-medium text-slate-900 max-w-[170px] truncate" title="${escapeHtml(it.nome)}">
            ${escapeHtml(it.nome)}
            ${normLinha}
          </td>
          <td class="px-3 py-2 text-center text-slate-500">${it.quantidade}</td>
          ${colunasMercados}
          <td class="px-3 py-2 text-right font-semibold text-slate-500 whitespace-nowrap">${precoMedioFmt}</td>
        </tr>
      `;
    }).join('');
  }

  lucide.createIcons();
}

// ========================================================
// ⚡ AÇÕES RÁPIDAS: ADICIONAR E GERAR LISTAS INTELIGENTES
// ========================================================

// Adiciona rapidamente um produto à lista de compras ativa
async function adicionarProdutoRapidoNaLista(produtoId, nomeProduto = 'Produto') {
  try {
    if (!listaAtivaId) {
      if (listasUsuario.length === 0) {
        const resLista = await fetch('/api/listas', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ nome: 'Minha Lista de Compras' })
        });
        const dataLista = await resLista.json();
        if (dataLista.sucesso) {
          listaAtivaId = dataLista.lista.id;
        }
      } else {
        listaAtivaId = listasUsuario[0].id;
      }
    }

    if (!listaAtivaId) {
      alert('Selecione ou crie uma lista de compras primeiro.');
      return;
    }

    const res = await fetch(`/api/listas/${listaAtivaId}/itens`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        produto_id: produtoId,
        quantidade: 1
      })
    });
    const data = await res.json();
    if (data.sucesso) {
      mostrarNotificacaoToast(`🛒 "${nomeProduto}" adicionado à sua lista de compras!`);
      if (currentView === 'lista') {
        await carregarDetalhesLista(listaAtivaId);
      }
    } else {
      alert('Erro ao adicionar produto: ' + data.erro);
    }
  } catch (err) {
    console.error('Erro ao adicionar produto rápido:', err);
  }
}

// Gera uma lista automática com os produtos mais comprados
async function gerarListaComMaisComprados() {
  try {
    const nomePadrao = `Meus Itens Frequentes (${new Date().toLocaleDateString('pt-BR')})`;
    const res = await fetch('/api/listas/gerar-frequentes', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ nome: nomePadrao })
    });
    const data = await res.json();
    if (data.sucesso) {
      listaAtivaId = data.lista.id;
      navigateView('lista');
      await carregarListasUsuario();
      mostrarNotificacaoToast(`✨ Lista criada com ${data.lista.total_itens} itens frequentes!`);
    } else {
      alert('Erro ao gerar lista: ' + data.erro);
    }
  } catch (err) {
    alert('Erro ao gerar lista com itens frequentes.');
  }
}

// Toast de Notificação Rápida
function mostrarNotificacaoToast(msg) {
  let toast = document.getElementById('app-toast-notificacao');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast-notificacao';
    toast.className = 'fixed bottom-6 right-6 z-50 bg-slate-900/95 text-white text-xs font-semibold px-4 py-3 rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur flex items-center gap-2 transform transition-all duration-300 translate-y-20 opacity-0 pointer-events-none';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400 shrink-0"></i> <span>${escapeHtml(msg)}</span>`;
  lucide.createIcons();

  toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
  }, 3200);
}

// Fechar dropdowns de autocomplete ao clicar fora
document.addEventListener('click', (e) => {
  // Dropdown de histórico
  const dropHist = document.getElementById('dropdown-busca-historico');
  const inputHist = document.getElementById('busca-produto-input');
  if (dropHist && !dropHist.contains(e.target) && e.target !== inputHist) {
    dropHist.classList.add('hidden');
  }

  // Dropdown de lista
  const dropLista = document.getElementById('dropdown-busca-lista');
  const inputLista = document.getElementById('input-busca-lista');
  if (dropLista && !dropLista.contains(e.target) && e.target !== inputLista) {
    dropLista.classList.add('hidden');
  }

  // Dropdowns de cestas
  document.querySelectorAll('[id^="cesta-dropdown-"]').forEach(drop => {
    const grupoId = drop.id.replace('cesta-dropdown-', '');
    const inputCesta = document.getElementById(`cesta-busca-input-${grupoId}`);
    if (!drop.contains(e.target) && e.target !== inputCesta) {
      drop.classList.add('hidden');
    }
  });
});

