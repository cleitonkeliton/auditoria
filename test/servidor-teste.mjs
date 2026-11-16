// Servidor local para testes: serve o app (www/) e simula o Apps Script + Google Sheets em memória.
//
//   node test/servidor-teste.mjs    ->  http://localhost:8765  (URL da planilha: http://localhost:8765/exec, chave: teste123)
//
// Rotas extras só para testes:
//   GET  /__planilha              estado atual das abas
//   POST /__falha?modo=permissao  faz o "Google" recusar o acesso (modo vazio volta ao normal)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import vm from 'node:vm';

const raiz = new URL('..', import.meta.url).pathname;

function criarPlanilhaFalsa(id, nome) {
  const abas = {};
  const ordem = [];
  function criarAba(nomeAba) {
    const linhas = [];
    const aba = {
      nome: nomeAba, linhas, ocultas: [],
      getLastRow: () => { let n = linhas.length; while (n > 0 && linhas[n - 1].every((v) => v === '')) n--; return n; },
      getMaxRows: () => 1000,
      setFrozenRows() {},
      hideColumns(i) { aba.ocultas.push(i); },
      deleteRow(n) { linhas.splice(n - 1, 1); },
      getRange(r, c, nr, nc) {
        return {
          setValues(v) { for (let i = 0; i < nr; i++) { while (linhas.length < r + i) linhas.push([]); for (let j = 0; j < nc; j++) linhas[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
          getValues() { const out = []; for (let i = 0; i < nr; i++) { const l = linhas[r - 1 + i] || []; out.push(Array.from({ length: nc }, (_, j) => l[c - 1 + j] ?? '')); } return out; },
          setFontWeight() { return this; },
          setNumberFormat() { return this; },
        };
      },
    };
    return aba;
  }
  const planilha = {
    abas,
    getId: () => id,
    getName: () => nome,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
    getSheetByName: (n) => abas[n] || null,
    getSheets: () => ordem.map((n) => abas[n]),
    insertSheet: (n) => { abas[n] = criarAba(n); ordem.push(n); return abas[n]; },
    deleteSheet: (aba) => { delete abas[aba.nome]; ordem.splice(ordem.indexOf(aba.nome), 1); },
    getSpreadsheetTimeZone: () => 'America/Sao_Paulo',
  };
  planilha.insertSheet('Página1');
  return planilha;
}

/**
 * Carrega o Code.gs num contexto com SpreadsheetApp, PropertiesService etc. falsos.
 * vinculada: true simula o script aberto pela planilha (Extensões > Apps Script).
 */
export function criarAmbiente({ vinculada = true, chave = 'teste123' } = {}) {
  const arquivos = {};
  const estado = { falha: '' };
  const ativa = vinculada ? criarPlanilhaFalsa('planilha-vinculada', 'Auditoria') : null;
  if (ativa) arquivos[ativa.getId()] = ativa;
  const propriedades = {};

  function verificarAcesso() {
    if (estado.falha === 'permissao') throw new Error('You do not have permission to access the requested document.');
  }

  const contexto = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => { verificarAcesso(); return ativa; },
      openById: (id) => { verificarAcesso(); if (!arquivos[id]) throw new Error('Unexpected error while getting the method or property openById'); return arquivos[id]; },
      create: (nome) => { const p = criarPlanilhaFalsa('planilha-' + (Object.keys(arquivos).length + 1), nome); arquivos[p.getId()] = p; return p; },
      flush() {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propriedades ? propriedades[k] : null),
        setProperty: (k, v) => { propriedades[k] = String(v); },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ texto: t, tipo: 'application/json', setMimeType() { return this; } }),
    },
    HtmlService: {
      createHtmlOutput: (h) => ({ texto: h, tipo: 'text/html', setTitle() { return this; }, addMetaTag() { return this; } }),
    },
    Logger: { log: (m) => { (contexto.__logs ||= []).push(m); } },
    Utilities: {
      formatDate(d) {
        const p = (n) => String(n).padStart(2, '0');
        const l = new Date(d.getTime() - 3 * 3600e3);
        return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:${p(l.getUTCSeconds())}`;
      },
      parseDate(texto) { return new Date(texto + '-03:00'); },
    },
  });
  const codigo = readFileSync(join(raiz, 'apps-script/Code.gs'), 'utf8')
    .replace("const CHAVE = 'TROQUE-ESTA-CHAVE'", `const CHAVE = '${chave}'`);
  vm.runInContext(codigo, contexto);
  return { contexto, arquivos, propriedades, estado, ativa };
}

const ambiente = criarAmbiente();

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
export const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/exec') {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const saida = req.method === 'POST'
        ? ambiente.contexto.doPost({ postData: { contents: corpo } })
        : ambiente.contexto.doGet();
      res.writeHead(200, { 'Content-Type': saida.tipo, 'Access-Control-Allow-Origin': '*' });
      res.end(saida.texto);
    });
    return;
  }
  if (url.pathname === '/__falha') {
    ambiente.estado.falha = url.searchParams.get('modo') || '';
    res.end('ok');
    return;
  }
  if (url.pathname === '/__planilha') {
    const planilha = ambiente.arquivos[ambiente.propriedades.PLANILHA_ID] || ambiente.ativa;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(Object.entries(planilha.abas)
      .map(([k, a]) => [k, { linhas: a.linhas.slice(0, a.getLastRow()), ocultas: a.ocultas }]))));
    return;
  }
  const caminho = join(raiz, 'www', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(caminho)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': tipos[extname(caminho)] || 'application/octet-stream' });
  res.end(readFileSync(caminho));
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  servidor.listen(8765, () => console.log('http://localhost:8765'));
}
