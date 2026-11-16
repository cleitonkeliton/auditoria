'use strict';

/*
 * Auditoria de computadores por tombamento.
 *
 * Os dados ficam salvos no celular (localStorage) e são enviados para a planilha
 * do Google Sheets ao tocar em sincronizar (ou automaticamente após salvar, se houver internet).
 * Cada registro tem um ID único; a planilha é atualizada pelo ID, então editar um
 * computador atualiza a mesma linha em vez de criar outra.
 *
 * Um computador fica num "local": o próprio setor (quando o setor não é dividido) ou um
 * subsetor. O campo subsetorId guarda o ID desse local.
 */

const CHAVE_DADOS = 'auditoria-dados-v1';
const CHAVE_CONFIG = 'auditoria-config-v1';

// ---------------------------------------------------------------------------
// Armazenamento local
// ---------------------------------------------------------------------------

function lerJSON(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch (e) {
    return padrao;
  }
}

function gravarJSON(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));
}

let config = Object.assign({ usuario: '', url: '', chave: '' }, lerJSON(CHAVE_CONFIG, {}));
let dados = Object.assign(
  { setores: {}, computadores: {}, ultimaSync: null, ultimoErro: null, planilhaUrl: '' },
  lerJSON(CHAVE_DADOS, {})
);

function salvarDados() {
  gravarJSON(CHAVE_DADOS, dados);
  atualizarBadge();
}

function salvarConfig() {
  gravarJSON(CHAVE_CONFIG, config);
}

function novoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function agora() {
  return new Date().toISOString();
}

// Setores sem pai são "setores"; com pai são "subsetores".
function setoresPrincipais() {
  return Object.values(dados.setores)
    .filter((s) => !s.excluido && !s.paiId)
    .sort(porNome);
}

function subsetoresDe(setorId) {
  return Object.values(dados.setores)
    .filter((s) => !s.excluido && s.paiId === setorId)
    .sort(porNome);
}

function computadoresDe(localId) {
  return Object.values(dados.computadores)
    .filter((c) => !c.excluido && c.subsetorId === localId)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

function todosComputadores() {
  return Object.values(dados.computadores).filter((c) => !c.excluido);
}

// Computadores direto no setor e nos subsetores dele.
function contarComputadoresSetor(setorId) {
  const locais = new Set([setorId].concat(subsetoresDe(setorId).map((s) => s.id)));
  return todosComputadores().filter((c) => locais.has(c.subsetorId)).length;
}

function porNome(a, b) {
  return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base', numeric: true });
}

// As etiquetas trazem o número com ponto ("756.322") ou com zeros à esquerda ("0008120441",
// que é o que o código de barras contém). O tombamento é guardado só com os dígitos e sem
// os zeros à esquerda, para o número lido pela câmera e o digitado ficarem iguais.
function normalizarTombamento(valor) {
  const texto = String(valor == null ? '' : valor).trim().toUpperCase();
  const digitos = texto.replace(/[\s.]/g, '');
  return /^\d+$/.test(digitos) ? digitos.replace(/^0+(?=\d)/, '') : texto;
}

function buscarPorTombamento(tombamento, ignorarId) {
  const alvo = normalizarTombamento(tombamento);
  if (!alvo) return null;
  return todosComputadores().find((c) => c.id !== ignorarId && normalizarTombamento(c.tombamento) === alvo) || null;
}

// Setor e subsetor de um local (subsetor vazio quando o computador está direto no setor).
function caminhoDoLocal(localId) {
  const local = dados.setores[localId];
  if (!local) return { setor: '', subsetor: '' };
  if (!local.paiId) return { setor: local.nome, subsetor: '' };
  const pai = dados.setores[local.paiId];
  return { setor: pai ? pai.nome : '', subsetor: local.nome };
}

function textoCaminho(caminho) {
  return [caminho.setor, caminho.subsetor].filter(Boolean).join(' › ');
}

function pendentes() {
  const s = Object.values(dados.setores).filter((x) => x.pendente).length;
  const c = Object.values(dados.computadores).filter((x) => x.pendente).length;
  return s + c;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

// Marca o registro para ir na próxima sincronização. A revisão identifica a versão enviada:
// se o registro mudar durante um envio, ele continua pendente para o envio seguinte.
function marcarPendente(registro) {
  registro.pendente = true;
  registro.rev = (registro.rev || 0) + 1;
}

function criarSetor(nome, paiId) {
  const id = novoId();
  const setor = {
    id,
    nome: nome.trim(),
    paiId: paiId || '',
    criadoPor: config.usuario,
    criadoEm: agora(),
    atualizadoEm: agora(),
  };
  marcarPendente(setor);
  dados.setores[id] = setor;
  salvarDados();
  return setor;
}

function renomearSetor(id, nome) {
  const s = dados.setores[id];
  s.nome = nome.trim();
  s.atualizadoEm = agora();
  marcarPendente(s);
  // O nome também aparece nas linhas dos subsetores e dos computadores, que são reenviadas.
  const subs = s.paiId ? [] : subsetoresDe(s.id);
  subs.forEach(marcarPendente);
  const locais = new Set([s.id].concat(subs.map((x) => x.id)));
  todosComputadores().filter((c) => locais.has(c.subsetorId)).forEach(marcarPendente);
  salvarDados();
}

function excluirSetor(id) {
  const s = dados.setores[id];
  s.excluido = true;
  s.atualizadoEm = agora();
  marcarPendente(s);
  salvarDados();
}

function salvarComputador(registro) {
  const existente = registro.id ? dados.computadores[registro.id] : null;
  const id = existente ? existente.id : novoId();
  const computador = Object.assign({}, existente || {
    id,
    usuario: config.usuario,
    criadoEm: agora(),
  }, {
    tombamento: normalizarTombamento(registro.tombamento),
    subsetorId: registro.subsetorId,
    localizacao: registro.localizacao.trim(),
    marca: registro.marca.trim(),
    modelo: registro.modelo.trim(),
    observacao: registro.observacao.trim(),
    atualizadoPor: config.usuario,
    atualizadoEm: agora(),
  });
  marcarPendente(computador);
  dados.computadores[id] = computador;
  salvarDados();
  return computador;
}

function excluirComputador(id) {
  const c = dados.computadores[id];
  c.excluido = true;
  c.atualizadoEm = agora();
  marcarPendente(c);
  salvarDados();
}

// Ao trocar de planilha, tudo o que está no celular é enviado de novo para a planilha nova.
function reenviarTudo() {
  Object.values(dados.setores).forEach(marcarPendente);
  Object.values(dados.computadores).forEach(marcarPendente);
  salvarDados();
}

// ---------------------------------------------------------------------------
// Sincronização com o Google Sheets (via Google Apps Script)
// ---------------------------------------------------------------------------

const MENSAGEM_SEM_INTERNET = 'Sem internet. Os dados continuam salvos no celular e vão para a planilha quando a conexão voltar.';
const MENSAGEM_SEM_CONEXAO = 'Não foi possível falar com a planilha. Confira a internet do celular. ' +
  'Se ela estiver funcionando, confira se o endereço da planilha termina em /exec e se a implantação ' +
  'do Apps Script está como "Quem pode acessar: Qualquer pessoa".';

let envioAtual = null;
let proximoEnvio = null;
let proximoEnvioSilencioso = true;

function configurado() {
  return Boolean(config.usuario && config.url && config.chave);
}

function paraEnvioSetor(s) {
  return {
    id: s.id,
    nome: s.nome,
    paiId: s.paiId || '',
    paiNome: s.paiId && dados.setores[s.paiId] ? dados.setores[s.paiId].nome : '',
    criadoPor: s.criadoPor || '',
    criadoEm: s.criadoEm || '',
    excluido: Boolean(s.excluido),
  };
}

function paraEnvioComputador(c) {
  const caminho = caminhoDoLocal(c.subsetorId);
  return {
    id: c.id,
    tombamento: c.tombamento,
    setor: caminho.setor,
    subsetor: caminho.subsetor,
    subsetorId: c.subsetorId,
    localizacao: c.localizacao || '',
    marca: c.marca || '',
    modelo: c.modelo || '',
    observacao: c.observacao || '',
    usuario: c.usuario || '',
    criadoEm: c.criadoEm || '',
    atualizadoPor: c.atualizadoPor || '',
    atualizadoEm: c.atualizadoEm || '',
    excluido: Boolean(c.excluido),
  };
}

function falha(tipo, mensagem) {
  const erro = new Error(mensagem);
  erro.tipo = tipo;
  return erro;
}

// A planilha respondeu algo que não é o JSON do script: explica o motivo provável.
function falhaDaResposta(status, texto) {
  if (status === 404) {
    return falha('planilha', 'Endereço da planilha não encontrado (erro 404). Confira a URL nas configurações: ela termina em /exec.');
  }
  if (/Script function not found|Função de script não encontrada/i.test(texto)) {
    return falha('planilha', 'O script da planilha está incompleto (sem a função doPost). Cole o código inteiro no Apps Script e faça uma nova versão da implantação.');
  }
  if (/accounts\.google\.com|ServiceLogin|Fazer login|Sign in/i.test(texto)) {
    return falha('planilha', 'A planilha pediu login. Na implantação do Apps Script, use "Executar como: Eu" e "Quem pode acessar: Qualquer pessoa".');
  }
  return falha('planilha', 'A planilha respondeu com uma página em vez de dados (código ' + status + '). ' +
    'Confira se o endereço termina em /exec e se a implantação está como "Quem pode acessar: Qualquer pessoa".');
}

// Envia as alterações e traz o que está na planilha. Se já houver um envio em andamento,
// faz mais um quando ele terminar, para levar também as alterações feitas nesse meio tempo.
// Devolve true quando a planilha confirmou o envio.
function sincronizar(opcoes) {
  const silencioso = Boolean(opcoes && opcoes.silencioso);
  if (!envioAtual) {
    envioAtual = executarSincronizacao(silencioso).finally(() => { envioAtual = null; });
    return envioAtual;
  }
  proximoEnvioSilencioso = proximoEnvioSilencioso && silencioso;
  if (!proximoEnvio) {
    proximoEnvio = envioAtual.then(() => {
      const silenciosoProximo = proximoEnvioSilencioso;
      proximoEnvio = null;
      proximoEnvioSilencioso = true;
      return sincronizar({ silencioso: silenciosoProximo });
    });
  }
  return proximoEnvio;
}

async function executarSincronizacao(silencioso) {
  if (!configurado()) {
    if (!silencioso) {
      mostrarToast('Configure a planilha antes de sincronizar', 'erro');
      location.hash = '#/config';
    }
    return false;
  }

  document.getElementById('btn-sync').classList.add('girando');

  const setoresEnviados = Object.values(dados.setores).filter((s) => s.pendente);
  const computadoresEnviados = Object.values(dados.computadores).filter((c) => c.pendente);
  const versaoSetor = new Map(setoresEnviados.map((s) => [s.id, s.rev]));
  const versaoComputador = new Map(computadoresEnviados.map((c) => [c.id, c.rev]));

  let sucesso = false;
  try {
    let resposta;
    try {
      resposta = await fetch(config.url, {
        method: 'POST',
        // text/plain evita a requisição de "preflight" (CORS), que o Apps Script não suporta.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          acao: 'sincronizar',
          chave: config.chave,
          usuario: config.usuario,
          setores: setoresEnviados.map(paraEnvioSetor),
          computadores: computadoresEnviados.map(paraEnvioComputador),
        }),
      });
    } catch (erroDeRede) {
      throw falha(navigator.onLine === false ? 'rede' : 'conexao',
        navigator.onLine === false ? MENSAGEM_SEM_INTERNET : MENSAGEM_SEM_CONEXAO);
    }
    const texto = await resposta.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (e) {
      throw falhaDaResposta(resposta.status, texto);
    }
    if (!json || !json.ok) throw falha('planilha', (json && json.erro) || 'Erro desconhecido na planilha.');

    aplicarRespostaServidor(json, versaoSetor, versaoComputador);
    dados.ultimaSync = agora();
    dados.ultimoErro = null;
    if (json.planilhaUrl) dados.planilhaUrl = json.planilhaUrl;
    salvarDados();
    sucesso = true;
    if (!silencioso) mostrarToast('Planilha sincronizada', 'ok');
  } catch (erro) {
    const tipo = erro && erro.tipo ? erro.tipo : 'app';
    const mensagem = erro && erro.message ? erro.message : String(erro);
    // Falta de internet é passageira; os outros erros ficam registrados para o aviso amarelo.
    if (tipo !== 'rede') {
      dados.ultimoErro = { tipo, mensagem, quando: agora() };
      salvarDados();
    }
    if (!silencioso) {
      mostrarToast(tipo === 'rede' ? mensagem : 'Não foi possível enviar para a planilha. Veja o motivo no aviso amarelo.', 'erro');
    }
  } finally {
    document.getElementById('btn-sync').classList.remove('girando');
    atualizarBadge();
    atualizarTelaDepoisDeSincronizar();
  }
  return sucesso;
}

function aplicarRespostaServidor(json, versaoSetor, versaoComputador) {
  // 1) Marca como enviados os registros que não mudaram durante o envio.
  versaoSetor.forEach((versao, id) => {
    const s = dados.setores[id];
    if (s && s.rev === versao) {
      if (s.excluido) delete dados.setores[id];
      else s.pendente = false;
    }
  });
  versaoComputador.forEach((versao, id) => {
    const c = dados.computadores[id];
    if (c && c.rev === versao) {
      if (c.excluido) delete dados.computadores[id];
      else c.pendente = false;
    }
  });

  // 2) Atualiza com o que está na planilha (inclui o que os outros usuários registraram).
  mesclar(dados.setores, json.setores || [], (s) => ({
    id: s.id,
    nome: s.nome,
    paiId: s.paiId || '',
    criadoPor: s.criadoPor || '',
    criadoEm: s.criadoEm || '',
    atualizadoEm: s.criadoEm || '',
    pendente: false,
  }));
  mesclar(dados.computadores, json.computadores || [], (c) => ({
    id: c.id,
    tombamento: String(c.tombamento == null ? '' : c.tombamento),
    subsetorId: c.subsetorId,
    localizacao: c.localizacao || '',
    marca: c.marca || '',
    modelo: c.modelo || '',
    observacao: c.observacao || '',
    usuario: c.usuario || '',
    criadoEm: c.criadoEm || '',
    atualizadoPor: c.atualizadoPor || '',
    atualizadoEm: c.atualizadoEm || '',
    pendente: false,
  }));
}

function mesclar(local, remotos, converter) {
  const idsRemotos = new Set();
  remotos.forEach((r) => {
    if (!r || !r.id) return;
    idsRemotos.add(r.id);
    const atual = local[r.id];
    if (!atual || !atual.pendente) local[r.id] = converter(r);
  });
  // Registros que já foram enviados e sumiram da planilha foram excluídos por alguém.
  Object.keys(local).forEach((id) => {
    if (!idsRemotos.has(id) && !local[id].pendente) delete local[id];
  });
}

function atualizarBadge() {
  const badge = document.getElementById('sync-badge');
  const n = pendentes();
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

// Mostra o resultado do envio sem atrapalhar quem está digitando: formulários e campos
// em uso não são redesenhados.
function atualizarTelaDepoisDeSincronizar() {
  const rota = rotaAtual()[0];
  const campo = document.activeElement;
  const digitando = campo && /^(INPUT|TEXTAREA|SELECT)$/.test(campo.tagName);
  const leitorAberto = !document.getElementById('scanner').hidden;
  if (digitando || leitorAberto || ['novo', 'computador', 'config'].includes(rota)) return;
  renderizar({ manterRolagem: true });
}

// ---------------------------------------------------------------------------
// Leitor de código de barras (ML Kit, do Google)
// ---------------------------------------------------------------------------

// As etiquetas de patrimônio usam Code 128; os outros formatos ficam por garantia.
const FORMATOS_CODIGO = ['CODE_128', 'CODE_39', 'CODE_93', 'CODABAR', 'ITF', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'QR_CODE', 'DATA_MATRIX'];
const RESOLUCAO_1920X1080 = 2;

let fecharLeitorAtual = null;

function ehAppNativo() {
  return Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function pluginLeitor() {
  return ehAppNativo() && window.capacitorBarcodeScanner ? window.capacitorBarcodeScanner.BarcodeScanner : null;
}

function pluginApp() {
  return ehAppNativo() && window.capacitorApp ? window.capacitorApp.App : null;
}

// Baixa em segundo plano a tela de leitura do Google (vem do Google Play Services).
async function prepararLeitorGoogle() {
  const leitor = pluginLeitor();
  if (!leitor || navigator.onLine === false) return;
  try {
    const { available } = await leitor.isGoogleBarcodeScannerModuleAvailable();
    if (!available) await leitor.installGoogleBarcodeScannerModule();
  } catch (e) {
    // Sem Google Play Services: fica a câmera do próprio app.
  }
}

async function leitorGoogleDisponivel(leitor) {
  try {
    return (await leitor.isGoogleBarcodeScannerModuleAvailable()).available === true;
  } catch (e) {
    return false;
  }
}

function valorDoCodigo(codigo) {
  return codigo ? String(codigo.rawValue || codigo.displayValue || '').trim() : '';
}

// Lê um código de barras e devolve o texto dele (ou null se o usuário cancelar).
async function lerCodigoDeBarras() {
  const leitor = pluginLeitor();
  if (!leitor) {
    mostrarToast('A leitura pela câmera funciona no app instalado no celular. Digite o número.', 'erro');
    return null;
  }
  // 1) Tela de leitura do Google, com foco e zoom automáticos.
  if (await leitorGoogleDisponivel(leitor)) {
    try {
      const { barcodes } = await leitor.scan({ formats: FORMATOS_CODIGO, autoZoom: true });
      return valorDoCodigo(barcodes && barcodes[0]) || null;
    } catch (erro) {
      if (/cancel/i.test(String(erro && erro.message))) return null;
      // Se a tela do Google falhar, usa a câmera do próprio app.
    }
  } else {
    prepararLeitorGoogle();
  }
  // 2) Câmera do próprio app, com o leitor do Google embutido (funciona sem internet).
  return lerComCameraDoApp(leitor);
}

async function permissaoDeCamera(leitor) {
  try {
    let { camera } = await leitor.checkPermissions();
    if (camera !== 'granted' && camera !== 'limited') ({ camera } = await leitor.requestPermissions());
    return camera === 'granted' || camera === 'limited';
  } catch (e) {
    return false;
  }
}

// Com mais de um código na imagem, fica o mais perto do centro (onde está a mira).
// As posições vêm em pixels da tela.
function maisPertoDoCentro(codigos) {
  if (codigos.length <= 1) return codigos[0];
  const escala = window.devicePixelRatio || 1;
  const centroX = (window.innerWidth * escala) / 2;
  const centroY = (window.innerHeight * escala) / 2;
  function distancia(codigo) {
    const pontos = codigo.cornerPoints;
    if (!pontos || !pontos.length) return Infinity;
    const x = pontos.reduce((soma, p) => soma + p[0], 0) / pontos.length;
    const y = pontos.reduce((soma, p) => soma + p[1], 0) / pontos.length;
    return Math.hypot(x - centroX, y - centroY);
  }
  return codigos.slice().sort((a, b) => distancia(a) - distancia(b))[0];
}

async function lerComCameraDoApp(leitor) {
  if (!(await permissaoDeCamera(leitor))) {
    mostrarToast('O app não tem permissão para usar a câmera. Libere em Configurações do Android › Apps › Auditoria › Permissões.', 'erro');
    return null;
  }
  const tela = document.getElementById('scanner');
  const botaoLanterna = document.getElementById('scanner-lanterna');
  const botaoFechar = document.getElementById('scanner-fechar');

  return new Promise((resolve) => {
    let terminou = false;
    let inicio = null;
    const ouvintes = [];

    async function encerrar(valor) {
      if (terminou) return;
      terminou = true;
      fecharLeitorAtual = null;
      window.removeEventListener('hashchange', aoNavegar);
      botaoFechar.onclick = null;
      botaoLanterna.onclick = null;
      tela.hidden = true;
      document.documentElement.classList.remove('leitor-ativo');
      // Espera a câmera terminar de abrir antes de fechar, para ela não ficar ligada.
      try { await inicio; } catch (e) { /* erro já tratado */ }
      try { await leitor.stopScan(); } catch (e) { /* já parada */ }
      for (const ouvinte of ouvintes) {
        try { await (await ouvinte).remove(); } catch (e) { /* já removido */ }
      }
      resolve(valor);
    }
    function aoNavegar() { encerrar(null); }

    fecharLeitorAtual = () => encerrar(null);
    window.addEventListener('hashchange', aoNavegar);
    botaoFechar.onclick = () => encerrar(null);
    botaoLanterna.hidden = true;
    botaoLanterna.onclick = () => { leitor.toggleTorch().catch(() => {}); };
    document.documentElement.classList.add('leitor-ativo');
    tela.hidden = false;

    // O leitor só avisa depois de ler o mesmo código em várias imagens seguidas.
    ouvintes.push(leitor.addListener('barcodesScanned', (evento) => {
      const valor = valorDoCodigo(maisPertoDoCentro((evento && evento.barcodes) || []));
      if (valor && !terminou) {
        if (navigator.vibrate) navigator.vibrate(120);
        encerrar(valor);
      }
    }));
    ouvintes.push(leitor.addListener('scanError', () => {
      if (terminou) return;
      mostrarToast('A câmera parou de funcionar. Digite o número do tombamento.', 'erro');
      encerrar(null);
    }));

    inicio = leitor.startScan({ formats: FORMATOS_CODIGO, resolution: RESOLUCAO_1920X1080 });
    inicio.then(async () => {
      try {
        const { available } = await leitor.isTorchAvailable();
        if (!terminou) botaoLanterna.hidden = !available;
      } catch (e) { /* sem lanterna */ }
    }, () => {
      if (terminou) return;
      mostrarToast('Não foi possível abrir a câmera. Digite o número do tombamento.', 'erro');
      encerrar(null);
    });
  });
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

const app = document.getElementById('app');
const elTitulo = document.getElementById('titulo');
const elSubtitulo = document.getElementById('subtitulo');
const btnVoltar = document.getElementById('btn-voltar');
let versaoApp = '';

function esc(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let temporizadorToast = null;
function mostrarToast(mensagem, tipo) {
  const el = document.getElementById('toast');
  el.textContent = mensagem;
  el.className = 'toast' + (tipo ? ' ' + tipo : '');
  el.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { el.hidden = true; }, tipo === 'erro' ? 6000 : 3500);
}

function cabecalho(titulo, subtitulo, voltar) {
  elTitulo.textContent = titulo;
  elSubtitulo.textContent = subtitulo || '';
  btnVoltar.hidden = !voltar;
}

function pedirNome(mensagem, valorInicial) {
  const valor = window.prompt(mensagem, valorInicial || '');
  if (valor == null) return null;
  const limpo = valor.trim();
  return limpo || null;
}

function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function plural(n, singular, pluralTexto) {
  return n + ' ' + (n === 1 ? singular : pluralTexto);
}

function contadorPCs(n) {
  return `<span class="item-contador">${n} PC${n === 1 ? '' : 's'}</span>`;
}

// Aviso amarelo quando há dados que não conseguiram ir para a planilha.
function avisoDeEnvio() {
  const n = pendentes();
  if (!dados.ultimoErro || n === 0) return '';
  return `<a class="banner" href="#/config">&#9888;&#65039; <b>${plural(n, 'alteração ainda não foi', 'alterações ainda não foram')}
    para a planilha.</b> Os dados estão salvos no celular. Toque aqui para ver o motivo.</a>`;
}

function linhaComputador(c, mostrarCaminho) {
  const detalhes = [
    [c.marca, c.modelo].filter(Boolean).join(' · '),
    c.localizacao,
    mostrarCaminho ? textoCaminho(caminhoDoLocal(c.subsetorId)) : '',
  ].filter(Boolean);
  return `
    <li class="item" data-ir="#/computador/${esc(c.id)}">
      <div class="item-corpo">
        <div class="item-titulo">${esc(c.tombamento)}</div>
        ${detalhes.map((d) => `<div class="item-detalhe">${esc(d)}</div>`).join('')}
        ${c.pendente ? '<div class="pendente">Aguardando envio</div>' : ''}
      </div>
      <span class="item-seta">&#8250;</span>
    </li>`;
}

// --- Tela: configurações -----------------------------------------------------

function telaConfig() {
  cabecalho('Configurações', '', configurado());
  const n = pendentes();
  const erro = dados.ultimoErro;

  app.innerHTML = `
    ${configurado() ? `
      <div class="card">
        <h2 class="card-titulo">Planilha</h2>
        ${erro ? `
          <div class="aviso"><b>Não foi possível enviar</b> (${esc(formatarData(erro.quando))}):<br>${esc(erro.mensagem)}</div>` : ''}
        <p class="info">
          ${n ? plural(n, 'alteração aguardando envio', 'alterações aguardando envio') + ' (salvas no celular).' : 'Tudo enviado para a planilha.'}<br>
          ${dados.ultimaSync ? 'Última sincronização: ' + esc(formatarData(dados.ultimaSync)) : 'Ainda não sincronizado.'}
        </p>
        <div class="botoes">
          <button type="button" class="btn" id="enviar-agora">Enviar agora</button>
          ${dados.planilhaUrl ? `<a class="btn btn-claro" href="${esc(dados.planilhaUrl)}">Abrir a planilha</a>` : ''}
        </div>
      </div>` : ''}
    <div class="card">
      <form id="form-config">
        <label for="cfg-usuario">Seu nome</label>
        <input id="cfg-usuario" required autocomplete="name" value="${esc(config.usuario)}" placeholder="Ex.: Cleiton">

        <label for="cfg-url">Endereço da planilha (URL do Apps Script)</label>
        <input id="cfg-url" required type="url" inputmode="url" value="${esc(config.url)}"
               placeholder="https://script.google.com/macros/s/.../exec">

        <label for="cfg-chave">Chave de acesso</label>
        <input id="cfg-chave" required value="${esc(config.chave)}" autocomplete="off" autocapitalize="off">

        <p class="info">O endereço e a chave são os mesmos para toda a equipe. Peça para quem configurou a planilha.</p>

        <div class="botoes">
          <button type="submit" class="btn">Salvar e testar</button>
        </div>
      </form>
    </div>
    <p class="info centro">
      ${plural(setoresPrincipais().length, 'setor', 'setores')} ·
      ${plural(todosComputadores().length, 'computador', 'computadores')}
      ${versaoApp ? '<br>Versão do app: ' + esc(versaoApp) : ''}
    </p>`;

  const botaoEnviar = document.getElementById('enviar-agora');
  if (botaoEnviar) {
    botaoEnviar.addEventListener('click', async () => {
      botaoEnviar.disabled = true;
      await sincronizar();
      renderizar({ manterRolagem: true });
    });
  }

  document.getElementById('form-config').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const urlAnterior = config.url;
    config.usuario = document.getElementById('cfg-usuario').value.trim();
    config.url = document.getElementById('cfg-url').value.trim();
    config.chave = document.getElementById('cfg-chave').value.trim();
    salvarConfig();
    if (urlAnterior && urlAnterior !== config.url) reenviarTudo();
    const botao = ev.target.querySelector('button[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Testando...';
    if (await sincronizar({ silencioso: true })) {
      mostrarToast('Planilha conectada', 'ok');
      location.hash = '#/';
    } else {
      mostrarToast('Não foi possível falar com a planilha. Veja o motivo acima.', 'erro');
      renderizar();
    }
  });
}

// --- Tela: lista de setores (início) ------------------------------------------

let termoBusca = '';

function telaInicio() {
  cabecalho('Auditoria', config.usuario ? 'Usuário: ' + config.usuario : '', false);
  const setores = setoresPrincipais();

  app.innerHTML = `
    ${avisoDeEnvio()}
    <div class="busca">
      <input id="busca" type="search" placeholder="Buscar tombamento, marca, local..." value="${esc(termoBusca)}">
    </div>
    <div id="resultado-busca"></div>
    <div id="lista-setores">
      ${setores.length ? `
        <div class="secao-titulo">Setores</div>
        <ul class="lista">
          ${setores.map((s) => {
            const subs = subsetoresDe(s.id).length;
            return `
              <li class="item" data-ir="#/setor/${esc(s.id)}">
                <div class="item-corpo">
                  <div class="item-titulo">${esc(s.nome)}</div>
                  <div class="item-detalhe">${subs ? plural(subs, 'subsetor', 'subsetores') : 'Sem subsetores'}</div>
                  ${s.pendente ? '<div class="pendente">Aguardando envio</div>' : ''}
                </div>
                ${contadorPCs(contarComputadoresSetor(s.id))}
                <span class="item-seta">&#8250;</span>
              </li>`;
          }).join('')}
        </ul>` : `
        <div class="vazio">Nenhum setor ainda.<br>Toque em <b>+ Novo setor</b> para começar.</div>`}
      <p class="info centro" style="margin-top:20px">
        <a href="#/config">Configurações</a>
        ${dados.planilhaUrl ? ` · <a href="${esc(dados.planilhaUrl)}">Abrir a planilha</a>` : ''}
      </p>
    </div>
    <button class="fab" id="novo-setor">+ Novo setor</button>`;

  const busca = document.getElementById('busca');
  busca.addEventListener('input', () => {
    termoBusca = busca.value;
    mostrarBusca();
  });
  mostrarBusca();

  document.getElementById('novo-setor').addEventListener('click', () => {
    const nome = pedirNome('Nome do setor:');
    if (!nome) return;
    const existe = setoresPrincipais().find((s) => s.nome.toLowerCase() === nome.toLowerCase());
    if (existe) {
      mostrarToast('Já existe um setor com esse nome', 'erro');
      location.hash = '#/setor/' + existe.id;
      return;
    }
    const s = criarSetor(nome, '');
    location.hash = '#/setor/' + s.id;
    sincronizar({ silencioso: true });
  });
}

function mostrarBusca() {
  const termo = termoBusca.trim().toLowerCase();
  const resultado = document.getElementById('resultado-busca');
  const lista = document.getElementById('lista-setores');
  if (!termo) {
    resultado.innerHTML = '';
    lista.hidden = false;
    return;
  }
  lista.hidden = true;
  const termoTombamento = normalizarTombamento(termo).toLowerCase();
  const encontrados = todosComputadores().filter((c) => {
    const caminho = caminhoDoLocal(c.subsetorId);
    return String(c.tombamento).toLowerCase().includes(termoTombamento) ||
      [c.tombamento, c.marca, c.modelo, c.localizacao, c.observacao, caminho.setor, caminho.subsetor]
        .some((v) => String(v || '').toLowerCase().includes(termo));
  }).slice(0, 100);
  resultado.innerHTML = encontrados.length
    ? `<div class="secao-titulo">${plural(encontrados.length, 'resultado', 'resultados')}</div>
       <ul class="lista">${encontrados.map((c) => linhaComputador(c, true)).join('')}</ul>`
    : '<div class="vazio">Nada encontrado.</div>';
}

// --- Tela: setor (computadores do setor e subsetores) -------------------------

function telaSetor(id) {
  const setor = dados.setores[id];
  if (!setor || setor.excluido) return irPara('#/');
  if (setor.paiId) return irPara('#/subsetor/' + id);
  const subs = subsetoresDe(id);
  const pcs = computadoresDe(id);
  cabecalho(setor.nome, 'Setor', true);

  app.innerHTML = `
    ${avisoDeEnvio()}
    ${pcs.length ? `
      <div class="secao-titulo">${plural(pcs.length, 'computador', 'computadores')} no setor</div>
      <ul class="lista">${pcs.map((c) => linhaComputador(c, false)).join('')}</ul>` : ''}
    ${subs.length ? `
      <div class="secao-titulo">Subsetores</div>
      <ul class="lista">
        ${subs.map((s) => `
          <li class="item" data-ir="#/subsetor/${esc(s.id)}">
            <div class="item-corpo">
              <div class="item-titulo">${esc(s.nome)}</div>
              ${s.pendente ? '<div class="pendente">Aguardando envio</div>' : ''}
            </div>
            ${contadorPCs(computadoresDe(s.id).length)}
            <span class="item-seta">&#8250;</span>
          </li>`).join('')}
      </ul>` : ''}
    ${!pcs.length && !subs.length ? `
      <div class="vazio">
        Setor vazio.<br>Toque em <b>+ Computador</b> para adicionar direto no setor.<br><br>
        Se o setor for dividido (salas, por exemplo), use <b>+ Subsetor</b>.
      </div>` : ''}
    <div class="botoes">
      <button class="btn btn-claro" id="novo-sub">+ Subsetor</button>
      <div class="botoes-linha">
        <button class="btn btn-claro" id="renomear">Renomear setor</button>
        <button class="btn btn-perigo" id="excluir">Excluir setor</button>
      </div>
    </div>
    <button class="fab" id="novo-pc">+ Computador</button>`;

  document.getElementById('novo-pc').addEventListener('click', () => {
    location.hash = '#/novo/' + id;
  });

  document.getElementById('novo-sub').addEventListener('click', () => {
    const nome = pedirNome('Nome do subsetor (ex.: Sala 101):');
    if (!nome) return;
    const existe = subsetoresDe(id).find((s) => s.nome.toLowerCase() === nome.toLowerCase());
    if (existe) {
      mostrarToast('Já existe um subsetor com esse nome', 'erro');
      location.hash = '#/subsetor/' + existe.id;
      return;
    }
    const s = criarSetor(nome, id);
    location.hash = '#/subsetor/' + s.id;
    sincronizar({ silencioso: true });
  });

  document.getElementById('renomear').addEventListener('click', () => {
    const nome = pedirNome('Novo nome do setor:', setor.nome);
    if (!nome || nome === setor.nome) return;
    renomearSetor(id, nome);
    renderizar({ manterRolagem: true });
    sincronizar({ silencioso: true });
  });

  document.getElementById('excluir').addEventListener('click', () => {
    if (subs.length || pcs.length) {
      mostrarToast('Para excluir o setor, primeiro exclua os computadores e subsetores dele', 'erro');
      return;
    }
    if (!window.confirm('Excluir o setor "' + setor.nome + '"?')) return;
    excluirSetor(id);
    irPara('#/');
    sincronizar({ silencioso: true });
  });
}

// --- Tela: subsetor (lista de computadores) -----------------------------------

function telaSubsetor(id) {
  const sub = dados.setores[id];
  if (!sub || sub.excluido) return irPara('#/');
  if (!sub.paiId) return irPara('#/setor/' + id);
  const setor = dados.setores[sub.paiId];
  const pcs = computadoresDe(id);
  cabecalho(sub.nome, setor ? setor.nome : '', true);

  app.innerHTML = `
    ${avisoDeEnvio()}
    ${pcs.length ? `
      <div class="secao-titulo">${plural(pcs.length, 'computador', 'computadores')}</div>
      <ul class="lista">${pcs.map((c) => linhaComputador(c, false)).join('')}</ul>` : `
      <div class="vazio">Nenhum computador neste subsetor.<br>Toque em <b>+ Computador</b>.</div>`}
    <div class="botoes botoes-linha">
      <button class="btn btn-claro" id="renomear">Renomear subsetor</button>
      <button class="btn btn-perigo" id="excluir">Excluir subsetor</button>
    </div>
    <button class="fab" id="novo-pc">+ Computador</button>`;

  document.getElementById('novo-pc').addEventListener('click', () => {
    location.hash = '#/novo/' + id;
  });

  document.getElementById('renomear').addEventListener('click', () => {
    const nome = pedirNome('Novo nome do subsetor:', sub.nome);
    if (!nome || nome === sub.nome) return;
    renomearSetor(id, nome);
    renderizar({ manterRolagem: true });
    sincronizar({ silencioso: true });
  });

  document.getElementById('excluir').addEventListener('click', () => {
    if (pcs.length) {
      mostrarToast('Exclua os computadores antes de excluir o subsetor', 'erro');
      return;
    }
    if (!window.confirm('Excluir o subsetor "' + sub.nome + '"?')) return;
    excluirSetor(id);
    irPara('#/setor/' + sub.paiId);
    sincronizar({ silencioso: true });
  });
}

// --- Tela: formulário do computador -------------------------------------------

const MODELOS_RAPIDOS = ['Mini', 'Desktop'];

// Guarda a última marca/modelo usados para agilizar o próximo cadastro.
let ultimoPreenchimento = { marca: '', modelo: '' };

function telaComputador(opcoes) {
  const editando = opcoes.id ? dados.computadores[opcoes.id] : null;
  if (opcoes.id && (!editando || editando.excluido)) return irPara('#/');
  const localId = editando ? editando.subsetorId : opcoes.localId;
  const local = dados.setores[localId];
  if (!local || local.excluido) return irPara('#/');

  cabecalho(editando ? 'Editar computador' : 'Novo computador', textoCaminho(caminhoDoLocal(localId)), true);

  const v = editando || { tombamento: '', localizacao: '', marca: ultimoPreenchimento.marca, modelo: ultimoPreenchimento.modelo, observacao: '' };

  app.innerHTML = `
    <div class="card">
      <form id="form-pc" novalidate>
        <label for="pc-tombamento">Tombamento</label>
        <div class="campo-com-botao">
          <input id="pc-tombamento" required autocomplete="off" autocapitalize="characters"
                 value="${esc(v.tombamento)}" placeholder="Leia o código ou digite">
          <button type="button" class="btn" id="ler-codigo" aria-label="Ler código de barras">&#128247; Ler</button>
        </div>
        <div id="dica-tombamento" class="dica"></div>
        <div id="aviso-duplicado"></div>

        <label for="pc-localizacao">Localização exata</label>
        <input id="pc-localizacao" value="${esc(v.localizacao)}" placeholder="Ex.: mesa 3, ao lado da janela">

        <label for="pc-marca">Marca</label>
        <input id="pc-marca" value="${esc(v.marca)}" placeholder="Ex.: Daten, Dell, Positivo" autocapitalize="words">

        <label for="pc-modelo">Modelo</label>
        <input id="pc-modelo" value="${esc(v.modelo)}" placeholder="Ex.: Mini, Desktop" autocapitalize="words">
        <div class="chips" id="chips-modelo">
          ${MODELOS_RAPIDOS.map((m) => `<button type="button" class="chip" data-modelo="${esc(m)}">${esc(m)}</button>`).join('')}
        </div>

        <label for="pc-observacao">Observação <span class="opcional">(se houver)</span></label>
        <textarea id="pc-observacao" placeholder="Ex.: sem etiqueta, monitor quebrado...">${esc(v.observacao)}</textarea>

        ${editando ? `
          <p class="info">
            Registrado por ${esc(editando.usuario || '—')} em ${esc(formatarData(editando.criadoEm))}
            ${editando.atualizadoPor && editando.atualizadoEm !== editando.criadoEm
              ? '<br>Alterado por ' + esc(editando.atualizadoPor) + ' em ' + esc(formatarData(editando.atualizadoEm)) : ''}
          </p>` : ''}

        <div class="botoes">
          ${editando ? `
            <button type="submit" class="btn" data-acao="salvar">Salvar alterações</button>
            <button type="button" class="btn btn-perigo" id="excluir-pc">Excluir computador</button>` : `
            <button type="submit" class="btn" data-acao="proximo">Salvar e adicionar outro</button>
            <button type="submit" class="btn btn-claro" data-acao="salvar">Salvar e voltar</button>`}
        </div>
      </form>
    </div>`;

  const campoTombamento = document.getElementById('pc-tombamento');
  const campoModelo = document.getElementById('pc-modelo');
  const dica = document.getElementById('dica-tombamento');
  const avisoDuplicado = document.getElementById('aviso-duplicado');

  function atualizarDica() {
    const digitado = campoTombamento.value.trim();
    const salvo = normalizarTombamento(digitado);
    if (salvo && !/^\d+$/.test(salvo)) {
      dica.innerHTML = '&#9888;&#65039; O código tem letras. Confira se é a etiqueta de patrimônio.';
    } else if (digitado && salvo !== digitado) {
      dica.innerHTML = 'Será salvo como <b>' + esc(salvo) + '</b>';
    } else {
      dica.innerHTML = '';
    }
  }

  function verificarDuplicado() {
    const dup = buscarPorTombamento(campoTombamento.value, editando && editando.id);
    if (!dup) {
      avisoDuplicado.innerHTML = '';
      return null;
    }
    avisoDuplicado.innerHTML = `<div class="aviso">
      Este tombamento já foi registrado em <b>${esc(textoCaminho(caminhoDoLocal(dup.subsetorId)))}</b>
      ${dup.usuario ? ' por ' + esc(dup.usuario) : ''}.
      <a href="#/computador/${esc(dup.id)}">Ver registro</a></div>`;
    return dup;
  }

  function atualizarChips() {
    const atual = campoModelo.value.trim().toLowerCase();
    document.querySelectorAll('#chips-modelo .chip').forEach((chip) => {
      chip.classList.toggle('ativo', chip.dataset.modelo.toLowerCase() === atual);
    });
  }

  campoTombamento.addEventListener('input', () => {
    atualizarDica();
    verificarDuplicado();
  });
  campoModelo.addEventListener('input', atualizarChips);
  document.querySelectorAll('#chips-modelo .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      campoModelo.value = chip.dataset.modelo;
      atualizarChips();
    });
  });
  atualizarDica();
  verificarDuplicado();
  atualizarChips();

  const botaoLer = document.getElementById('ler-codigo');
  botaoLer.addEventListener('click', async () => {
    botaoLer.disabled = true;
    try {
      const codigo = await lerCodigoDeBarras();
      // A tela pode ter mudado enquanto o leitor estava aberto.
      if (codigo && document.body.contains(campoTombamento)) {
        campoTombamento.value = normalizarTombamento(codigo);
        atualizarDica();
        verificarDuplicado();
        mostrarToast('Código lido: ' + campoTombamento.value, 'ok');
      }
    } finally {
      botaoLer.disabled = false;
    }
  });

  let acao = 'salvar';
  document.querySelectorAll('#form-pc button[type=submit]').forEach((b) => {
    b.addEventListener('click', () => { acao = b.dataset.acao; });
  });

  document.getElementById('form-pc').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!normalizarTombamento(campoTombamento.value)) {
      mostrarToast('Informe o tombamento', 'erro');
      campoTombamento.focus();
      return;
    }
    const dup = verificarDuplicado();
    if (dup && !window.confirm('Este tombamento já está registrado. Salvar mesmo assim?')) return;

    const salvo = salvarComputador({
      id: editando ? editando.id : null,
      tombamento: campoTombamento.value,
      subsetorId: localId,
      localizacao: document.getElementById('pc-localizacao').value,
      marca: document.getElementById('pc-marca').value,
      modelo: campoModelo.value,
      observacao: document.getElementById('pc-observacao').value,
    });
    ultimoPreenchimento = { marca: salvo.marca, modelo: salvo.modelo };
    mostrarToast('Computador ' + salvo.tombamento + ' salvo', 'ok');
    sincronizar({ silencioso: true });

    if (acao === 'proximo') renderizar();
    else history.back();
  });

  const botaoExcluir = document.getElementById('excluir-pc');
  if (botaoExcluir) {
    botaoExcluir.addEventListener('click', () => {
      if (!window.confirm('Excluir o computador ' + editando.tombamento + '?')) return;
      excluirComputador(editando.id);
      mostrarToast('Computador excluído', 'ok');
      sincronizar({ silencioso: true });
      history.back();
    });
  }
}

// ---------------------------------------------------------------------------
// Navegação (usa o "#" da URL para o botão voltar funcionar)
// ---------------------------------------------------------------------------

function rotaAtual() {
  return location.hash.replace(/^#\/?/, '').split('/');
}

function irPara(hash) {
  if (location.hash === hash) renderizar();
  else location.replace(hash);
}

function renderizar(opcoes) {
  const rota = rotaAtual();
  if (!(opcoes && opcoes.manterRolagem)) window.scrollTo(0, 0);

  if (!configurado() && rota[0] !== 'config') {
    location.replace('#/config');
    return;
  }

  switch (rota[0]) {
    case 'config': return telaConfig();
    case 'setor': return telaSetor(rota[1]);
    case 'subsetor': return telaSubsetor(rota[1]);
    case 'novo': return telaComputador({ localId: rota[1] });
    case 'computador': return telaComputador({ id: rota[1] });
    default: return telaInicio();
  }
}

function prepararAppNativo() {
  const App = pluginApp();
  if (App) {
    // Botão voltar do Android: fecha o leitor, volta uma tela ou, no início, sai do app.
    App.addListener('backButton', (evento) => {
      if (fecharLeitorAtual) {
        fecharLeitorAtual();
        return;
      }
      const rota = rotaAtual()[0];
      if (!rota || !configurado()) App.exitApp();
      else if (evento && evento.canGoBack) history.back();
      else location.replace('#/');
    });
    App.getInfo()
      .then((info) => { versaoApp = info.version; })
      .catch(() => {});
  }
  setTimeout(prepararLeitorGoogle, 1500);
}

app.addEventListener('click', (ev) => {
  const alvo = ev.target.closest('[data-ir]');
  if (alvo) location.hash = alvo.dataset.ir;
});

btnVoltar.addEventListener('click', () => history.back());
document.getElementById('btn-sync').addEventListener('click', () => sincronizar());
window.addEventListener('hashchange', () => renderizar());
window.addEventListener('online', () => {
  sincronizar({ silencioso: true });
  prepararLeitorGoogle();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sincronizar({ silencioso: true });
});

atualizarBadge();
renderizar();
prepararAppNativo();
sincronizar({ silencioso: true });
