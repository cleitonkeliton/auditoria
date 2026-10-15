'use strict';

/*
 * Auditoria de computadores por tombamento.
 *
 * Os dados ficam salvos no celular (localStorage) e são enviados para a planilha
 * do Google Sheets ao tocar em sincronizar (ou automaticamente após salvar, se houver internet).
 * Cada registro tem um ID único; a planilha é atualizada pelo ID, então editar um
 * computador atualiza a mesma linha em vez de criar outra.
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

let config = lerJSON(CHAVE_CONFIG, { usuario: '', url: '', chave: '' });
let dados = lerJSON(CHAVE_DADOS, { setores: {}, computadores: {}, ultimaSync: null });

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

function computadoresDe(subsetorId) {
  return Object.values(dados.computadores)
    .filter((c) => !c.excluido && c.subsetorId === subsetorId)
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

function todosComputadores() {
  return Object.values(dados.computadores).filter((c) => !c.excluido);
}

function contarComputadoresSetor(setorId) {
  const subs = new Set(subsetoresDe(setorId).map((s) => s.id));
  return todosComputadores().filter((c) => subs.has(c.subsetorId)).length;
}

function porNome(a, b) {
  return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base', numeric: true });
}

function normalizarTombamento(valor) {
  return String(valor || '').trim().toUpperCase();
}

function buscarPorTombamento(tombamento, ignorarId) {
  const alvo = normalizarTombamento(tombamento);
  if (!alvo) return null;
  return todosComputadores().find((c) => c.id !== ignorarId && normalizarTombamento(c.tombamento) === alvo) || null;
}

function caminhoDoSubsetor(subsetorId) {
  const sub = dados.setores[subsetorId];
  if (!sub) return { setor: '', subsetor: '' };
  const pai = dados.setores[sub.paiId];
  return { setor: pai ? pai.nome : '', subsetor: sub.nome };
}

function pendentes() {
  const s = Object.values(dados.setores).filter((x) => x.pendente).length;
  const c = Object.values(dados.computadores).filter((x) => x.pendente).length;
  return s + c;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

function criarSetor(nome, paiId) {
  const id = novoId();
  dados.setores[id] = {
    id,
    nome: nome.trim(),
    paiId: paiId || '',
    criadoPor: config.usuario,
    criadoEm: agora(),
    atualizadoEm: agora(),
    pendente: true,
  };
  salvarDados();
  return dados.setores[id];
}

function renomearSetor(id, nome) {
  const s = dados.setores[id];
  s.nome = nome.trim();
  s.atualizadoEm = agora();
  s.pendente = true;
  // O nome do setor/subsetor aparece nas linhas dos subsetores e computadores, então elas também são reenviadas.
  const subs = s.paiId ? [s.id] : subsetoresDe(s.id).map((x) => x.id);
  subs.forEach((subId) => { dados.setores[subId].pendente = true; });
  todosComputadores()
    .filter((c) => subs.includes(c.subsetorId))
    .forEach((c) => { c.pendente = true; });
  salvarDados();
}

function excluirSetor(id) {
  const s = dados.setores[id];
  s.excluido = true;
  s.atualizadoEm = agora();
  s.pendente = true;
  salvarDados();
}

function salvarComputador(registro) {
  const existente = registro.id ? dados.computadores[registro.id] : null;
  const id = existente ? existente.id : novoId();
  dados.computadores[id] = Object.assign({}, existente || {
    id,
    usuario: config.usuario,
    criadoEm: agora(),
  }, {
    tombamento: registro.tombamento.trim(),
    subsetorId: registro.subsetorId,
    localizacao: registro.localizacao.trim(),
    marca: registro.marca.trim(),
    modelo: registro.modelo.trim(),
    observacao: registro.observacao.trim(),
    atualizadoPor: config.usuario,
    atualizadoEm: agora(),
    pendente: true,
  });
  salvarDados();
  return dados.computadores[id];
}

function excluirComputador(id) {
  const c = dados.computadores[id];
  c.excluido = true;
  c.atualizadoEm = agora();
  c.pendente = true;
  salvarDados();
}

// ---------------------------------------------------------------------------
// Sincronização com o Google Sheets (via Google Apps Script)
// ---------------------------------------------------------------------------

let sincronizando = false;

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
  const caminho = caminhoDoSubsetor(c.subsetorId);
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

async function sincronizar(opcoes) {
  const silencioso = opcoes && opcoes.silencioso;
  if (sincronizando) return;
  if (!configurado()) {
    if (!silencioso) {
      mostrarToast('Configure a planilha antes de sincronizar', 'erro');
      location.hash = '#/config';
    }
    return;
  }

  sincronizando = true;
  document.getElementById('btn-sync').classList.add('girando');

  // Guarda a versão enviada de cada registro: se ele for editado durante o envio,
  // continua pendente para ir na próxima sincronização.
  const setoresEnviados = Object.values(dados.setores).filter((s) => s.pendente);
  const computadoresEnviados = Object.values(dados.computadores).filter((c) => c.pendente);
  const versaoSetor = new Map(setoresEnviados.map((s) => [s.id, s.atualizadoEm]));
  const versaoComputador = new Map(computadoresEnviados.map((c) => [c.id, c.atualizadoEm]));

  try {
    const resposta = await fetch(config.url, {
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
    const texto = await resposta.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (e) {
      throw new Error('Resposta inválida da planilha. Confira o endereço (URL) nas configurações.');
    }
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido na planilha');

    aplicarRespostaServidor(json, versaoSetor, versaoComputador);
    dados.ultimaSync = agora();
    salvarDados();
    if (!silencioso) mostrarToast('Planilha sincronizada', 'ok');
    renderizar();
  } catch (erro) {
    const msg = erro && erro.message ? erro.message : String(erro);
    if (!silencioso) {
      const semRede = /fetch|network|rede|Failed/i.test(msg);
      mostrarToast(semRede ? 'Sem conexão. Os dados continuam salvos no celular.' : msg, 'erro');
    }
  } finally {
    sincronizando = false;
    document.getElementById('btn-sync').classList.remove('girando');
    atualizarBadge();
  }
}

function aplicarRespostaServidor(json, versaoSetor, versaoComputador) {
  // 1) Marca como enviados os registros que não mudaram durante o envio.
  versaoSetor.forEach((versao, id) => {
    const s = dados.setores[id];
    if (s && s.atualizadoEm === versao) {
      if (s.excluido) delete dados.setores[id];
      else s.pendente = false;
    }
  });
  versaoComputador.forEach((versao, id) => {
    const c = dados.computadores[id];
    if (c && c.atualizadoEm === versao) {
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

// ---------------------------------------------------------------------------
// Leitor de código de barras (câmera)
// ---------------------------------------------------------------------------

let leitor = null;

function criarLeitor() {
  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.CODE_128,
    Z.BarcodeFormat.CODE_39,
    Z.BarcodeFormat.CODE_93,
    Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.EAN_13,
    Z.BarcodeFormat.EAN_8,
    Z.BarcodeFormat.ITF,
    Z.BarcodeFormat.UPC_A,
    Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.QR_CODE,
    Z.BarcodeFormat.DATA_MATRIX,
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  return new Z.BrowserMultiFormatReader(hints, 150);
}

function abrirScanner() {
  return new Promise((resolve) => {
    if (!window.ZXing || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mostrarToast('Câmera indisponível. Digite o número do tombamento.', 'erro');
      resolve(null);
      return;
    }
    const tela = document.getElementById('scanner');
    const video = document.getElementById('scanner-video');
    const botaoFechar = document.getElementById('scanner-fechar');
    let terminou = false;

    function encerrar(valor) {
      if (terminou) return;
      terminou = true;
      try { leitor && leitor.reset(); } catch (e) { /* ignora */ }
      tela.hidden = true;
      botaoFechar.onclick = null;
      window.removeEventListener('hashchange', aoNavegar);
      resolve(valor);
    }
    function aoNavegar() { encerrar(null); }

    botaoFechar.onclick = () => encerrar(null);
    window.addEventListener('hashchange', aoNavegar);
    tela.hidden = false;

    leitor = leitor || criarLeitor();
    leitor
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        video,
        (resultado) => {
          if (resultado && !terminou) {
            if (navigator.vibrate) navigator.vibrate(120);
            encerrar(resultado.getText());
          }
        }
      )
      .catch((erro) => {
        const negado = erro && /Permission|NotAllowed/i.test(erro.name + ' ' + erro.message);
        mostrarToast(negado
          ? 'Permita o uso da câmera nas configurações do Android para ler o código.'
          : 'Não foi possível abrir a câmera. Digite o número do tombamento.', 'erro');
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
  temporizadorToast = setTimeout(() => { el.hidden = true; }, 3500);
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

function linhaComputador(c, mostrarCaminho) {
  const caminho = caminhoDoSubsetor(c.subsetorId);
  const detalhes = [
    [c.marca, c.modelo].filter(Boolean).join(' · '),
    c.localizacao,
    mostrarCaminho ? [caminho.setor, caminho.subsetor].filter(Boolean).join(' › ') : '',
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
  app.innerHTML = `
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
    <div class="card">
      <div class="info">
        ${plural(setoresPrincipais().length, 'setor', 'setores')} ·
        ${plural(todosComputadores().length, 'computador', 'computadores')} ·
        ${plural(pendentes(), 'alteração aguardando envio', 'alterações aguardando envio')}<br>
        ${dados.ultimaSync ? 'Última sincronização: ' + esc(formatarData(dados.ultimaSync)) : 'Ainda não sincronizado'}
      </div>
    </div>`;

  document.getElementById('form-config').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    config.usuario = document.getElementById('cfg-usuario').value.trim();
    config.url = document.getElementById('cfg-url').value.trim();
    config.chave = document.getElementById('cfg-chave').value.trim();
    salvarConfig();
    location.hash = '#/';
    await sincronizar();
  });
}

// --- Tela: lista de setores (início) ------------------------------------------

let termoBusca = '';

function telaInicio() {
  cabecalho('Auditoria', config.usuario ? 'Usuário: ' + config.usuario : '', false);
  const setores = setoresPrincipais();

  app.innerHTML = `
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
            const pcs = contarComputadoresSetor(s.id);
            return `
              <li class="item" data-ir="#/setor/${esc(s.id)}">
                <div class="item-corpo">
                  <div class="item-titulo">${esc(s.nome)}</div>
                  <div class="item-detalhe">${plural(subs, 'subsetor', 'subsetores')}</div>
                  ${s.pendente ? '<div class="pendente">Aguardando envio</div>' : ''}
                </div>
                <span class="item-contador">${pcs} PC${pcs === 1 ? '' : 's'}</span>
                <span class="item-seta">&#8250;</span>
              </li>`;
          }).join('')}
        </ul>` : `
        <div class="vazio">Nenhum setor ainda.<br>Toque em <b>+ Novo setor</b> para começar.</div>`}
      <p class="info" style="text-align:center;margin-top:20px">
        <a href="#/config">Configurações</a>
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
  const encontrados = todosComputadores().filter((c) => {
    const caminho = caminhoDoSubsetor(c.subsetorId);
    return [c.tombamento, c.marca, c.modelo, c.localizacao, c.observacao, caminho.setor, caminho.subsetor]
      .some((v) => String(v || '').toLowerCase().includes(termo));
  }).slice(0, 100);
  resultado.innerHTML = encontrados.length
    ? `<div class="secao-titulo">${plural(encontrados.length, 'resultado', 'resultados')}</div>
       <ul class="lista">${encontrados.map((c) => linhaComputador(c, true)).join('')}</ul>`
    : '<div class="vazio">Nada encontrado.</div>';
}

// --- Tela: setor (lista de subsetores) ----------------------------------------

function telaSetor(id) {
  const setor = dados.setores[id];
  if (!setor || setor.excluido) return irPara('#/');
  const subs = subsetoresDe(id);
  cabecalho(setor.nome, 'Setor', true);

  app.innerHTML = `
    ${subs.length ? `
      <div class="secao-titulo">Subsetores</div>
      <ul class="lista">
        ${subs.map((s) => {
          const pcs = computadoresDe(s.id).length;
          return `
            <li class="item" data-ir="#/subsetor/${esc(s.id)}">
              <div class="item-corpo">
                <div class="item-titulo">${esc(s.nome)}</div>
                ${s.pendente ? '<div class="pendente">Aguardando envio</div>' : ''}
              </div>
              <span class="item-contador">${pcs} PC${pcs === 1 ? '' : 's'}</span>
              <span class="item-seta">&#8250;</span>
            </li>`;
        }).join('')}
      </ul>` : `
      <div class="vazio">Nenhum subsetor neste setor.<br>Toque em <b>+ Novo subsetor</b>.</div>`}
    <div class="botoes botoes-linha">
      <button class="btn btn-claro" id="renomear">Renomear setor</button>
      <button class="btn btn-perigo" id="excluir">Excluir setor</button>
    </div>
    <button class="fab" id="novo-sub">+ Novo subsetor</button>`;

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
    renderizar();
    sincronizar({ silencioso: true });
  });

  document.getElementById('excluir').addEventListener('click', () => {
    if (subs.length) {
      mostrarToast('Exclua os subsetores antes de excluir o setor', 'erro');
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
  const setor = dados.setores[sub.paiId];
  const pcs = computadoresDe(id);
  cabecalho(sub.nome, setor ? setor.nome : '', true);

  app.innerHTML = `
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
    renderizar();
    sincronizar({ silencioso: true });
  });

  document.getElementById('excluir').addEventListener('click', () => {
    if (pcs.length) {
      mostrarToast('Exclua ou mova os computadores antes de excluir o subsetor', 'erro');
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
  const subsetorId = editando ? editando.subsetorId : opcoes.subsetorId;
  const sub = dados.setores[subsetorId];
  if (!sub || sub.excluido) return irPara('#/');
  const caminho = caminhoDoSubsetor(subsetorId);

  cabecalho(editando ? 'Editar computador' : 'Novo computador', caminho.setor + ' › ' + caminho.subsetor, true);

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
  const avisoDuplicado = document.getElementById('aviso-duplicado');

  function verificarDuplicado() {
    const dup = buscarPorTombamento(campoTombamento.value, editando && editando.id);
    if (!dup) {
      avisoDuplicado.innerHTML = '';
      return null;
    }
    const c = caminhoDoSubsetor(dup.subsetorId);
    avisoDuplicado.innerHTML = `<div class="aviso">
      Este tombamento já foi registrado em <b>${esc(c.setor)} › ${esc(c.subsetor)}</b>
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

  campoTombamento.addEventListener('input', verificarDuplicado);
  campoModelo.addEventListener('input', atualizarChips);
  document.querySelectorAll('#chips-modelo .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      campoModelo.value = chip.dataset.modelo;
      atualizarChips();
    });
  });
  verificarDuplicado();
  atualizarChips();

  document.getElementById('ler-codigo').addEventListener('click', async () => {
    const codigo = await abrirScanner();
    if (codigo) {
      campoTombamento.value = codigo.trim();
      verificarDuplicado();
      mostrarToast('Código lido: ' + codigo.trim(), 'ok');
      document.getElementById('pc-localizacao').focus();
    }
  });

  let acao = 'salvar';
  document.querySelectorAll('#form-pc button[type=submit]').forEach((b) => {
    b.addEventListener('click', () => { acao = b.dataset.acao; });
  });

  document.getElementById('form-pc').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const tombamento = campoTombamento.value.trim();
    if (!tombamento) {
      mostrarToast('Informe o tombamento', 'erro');
      campoTombamento.focus();
      return;
    }
    const dup = verificarDuplicado();
    if (dup && !window.confirm('Este tombamento já está registrado. Salvar mesmo assim?')) return;

    const salvo = salvarComputador({
      id: editando ? editando.id : null,
      tombamento,
      subsetorId,
      localizacao: document.getElementById('pc-localizacao').value,
      marca: document.getElementById('pc-marca').value,
      modelo: campoModelo.value,
      observacao: document.getElementById('pc-observacao').value,
    });
    ultimoPreenchimento = { marca: salvo.marca, modelo: salvo.modelo };
    mostrarToast('Computador ' + salvo.tombamento + ' salvo', 'ok');
    sincronizar({ silencioso: true });

    if (acao === 'proximo') {
      renderizar();
      document.getElementById('pc-tombamento').focus();
    } else {
      history.back();
    }
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

  if (!editando) campoTombamento.focus();
}

// ---------------------------------------------------------------------------
// Navegação (usa o "#" da URL para o botão voltar do Android funcionar)
// ---------------------------------------------------------------------------

function irPara(hash) {
  if (location.hash === hash) renderizar();
  else location.replace(hash);
}

function renderizar() {
  const rota = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);

  if (!configurado() && rota[0] !== 'config') {
    location.replace('#/config');
    return;
  }

  switch (rota[0]) {
    case 'config': return telaConfig();
    case 'setor': return telaSetor(rota[1]);
    case 'subsetor': return telaSubsetor(rota[1]);
    case 'novo': return telaComputador({ subsetorId: rota[1] });
    case 'computador': return telaComputador({ id: rota[1] });
    default: return telaInicio();
  }
}

app.addEventListener('click', (ev) => {
  const alvo = ev.target.closest('[data-ir]');
  if (alvo) location.hash = alvo.dataset.ir;
});

btnVoltar.addEventListener('click', () => history.back());
document.getElementById('btn-sync').addEventListener('click', () => sincronizar());
window.addEventListener('hashchange', renderizar);
window.addEventListener('online', () => sincronizar({ silencioso: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sincronizar({ silencioso: true });
});

atualizarBadge();
renderizar();
sincronizar({ silencioso: true });
