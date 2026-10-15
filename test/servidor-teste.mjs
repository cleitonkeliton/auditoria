// Servidor local para testes: serve o app (www/) e simula o Apps Script + Google Sheets em memória.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import vm from 'node:vm';

const raiz = new URL('..', import.meta.url).pathname;

function criarPlanilhaFalsa() {
  const abas = {};
  function criarAba(nome) {
    const linhas = [];
    const aba = {
      nome, linhas, ocultas: [],
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
  return {
    abas,
    getSheetByName: (n) => abas[n] || null,
    insertSheet: (n) => (abas[n] = criarAba(n)),
    getSpreadsheetTimeZone: () => 'America/Sao_Paulo',
  };
}

const planilha = criarPlanilhaFalsa();
const contexto = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => planilha, flush() {} },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (t) => ({ texto: t, setMimeType() { return this; } }),
  },
  Utilities: {
    formatDate(d, _tz, _fmt) {
      const p = (n) => String(n).padStart(2, '0');
      const l = new Date(d.getTime() - 3 * 3600e3);
      return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:${p(l.getUTCSeconds())}`;
    },
    parseDate(texto) { return new Date(texto + '-03:00'); },
  },
});
vm.runInContext(readFileSync(join(raiz, 'apps-script/Code.gs'), 'utf8').replace("const CHAVE = 'TROQUE-ESTA-CHAVE'", "const CHAVE = 'teste123'"), contexto);

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
export const servidor = http.createServer((req, res) => {
  if (req.url.startsWith('/exec')) {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const saida = req.method === 'POST' ? contexto.doPost({ postData: { contents: corpo } }) : contexto.doGet();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(saida.texto);
    });
    return;
  }
  if (req.url === '/__planilha') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(Object.entries(planilha.abas).map(([k, a]) => [k, { linhas: a.linhas.slice(0, a.getLastRow()), ocultas: a.ocultas }]))));
    return;
  }
  const caminho = join(raiz, 'www', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(caminho)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': tipos[extname(caminho)] || 'application/octet-stream' });
  res.end(readFileSync(caminho));
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  servidor.listen(8765, () => console.log('http://localhost:8765'));
}
