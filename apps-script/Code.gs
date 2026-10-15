/**
 * Recebe os dados do app de Auditoria e grava na planilha.
 *
 * Instalação (uma vez só):
 *  1. Crie uma planilha no Google Sheets.
 *  2. Menu Extensões > Apps Script. Apague o conteúdo e cole este arquivo.
 *  3. Troque a CHAVE abaixo por uma senha sua (a mesma vai no app).
 *  4. Implantar > Nova implantação > Tipo "App da Web".
 *     Executar como: "Eu". Quem pode acessar: "Qualquer pessoa".
 *  5. Copie a URL que termina em /exec e coloque no app.
 */

const CHAVE = 'TROQUE-ESTA-CHAVE';

const ABA_COMPUTADORES = 'Computadores';
const ABA_SETORES = 'Setores';

const COLUNAS_COMPUTADORES = [
  ['id', 'ID'],
  ['tombamento', 'Tombamento'],
  ['setor', 'Setor'],
  ['subsetor', 'Subsetor'],
  ['localizacao', 'Localização exata'],
  ['marca', 'Marca'],
  ['modelo', 'Modelo'],
  ['observacao', 'Observação'],
  ['usuario', 'Registrado por'],
  ['criadoEm', 'Registrado em'],
  ['atualizadoPor', 'Alterado por'],
  ['atualizadoEm', 'Alterado em'],
  ['subsetorId', 'ID Subsetor'],
];

const COLUNAS_SETORES = [
  ['id', 'ID'],
  ['setor', 'Setor'],
  ['subsetor', 'Subsetor'],
  ['paiId', 'ID Setor'],
  ['criadoPor', 'Criado por'],
  ['criadoEm', 'Criado em'],
];

const CAMPOS_DATA = ['criadoEm', 'atualizadoEm'];

function doGet() {
  return json({ ok: true, mensagem: 'Planilha da auditoria funcionando.' });
}

function doPost(e) {
  try {
    const pedido = JSON.parse(e.postData.contents);
    if (pedido.chave !== CHAVE) return json({ ok: false, erro: 'Chave de acesso inválida' });
    if (pedido.acao !== 'sincronizar') return json({ ok: false, erro: 'Ação desconhecida' });

    const trava = LockService.getScriptLock();
    trava.waitLock(30000);
    try {
      const planilha = SpreadsheetApp.getActiveSpreadsheet();
      const abaSetores = prepararAba(planilha, ABA_SETORES, COLUNAS_SETORES);
      const abaComputadores = prepararAba(planilha, ABA_COMPUTADORES, COLUNAS_COMPUTADORES);

      const setores = (pedido.setores || []).map(function (s) {
        return {
          id: s.id,
          // Setor principal: nome vai em "Setor". Subsetor: "Setor" = nome do pai.
          setor: s.paiId ? s.paiNome : s.nome,
          subsetor: s.paiId ? s.nome : '',
          paiId: s.paiId || '',
          criadoPor: s.criadoPor,
          criadoEm: s.criadoEm,
          excluido: s.excluido,
        };
      });
      gravar(abaSetores, COLUNAS_SETORES, setores);
      gravar(abaComputadores, COLUNAS_COMPUTADORES, pedido.computadores || []);
      SpreadsheetApp.flush();

      return json({
        ok: true,
        setores: ler(abaSetores, COLUNAS_SETORES).map(function (s) {
          return {
            id: s.id,
            nome: s.paiId ? s.subsetor : s.setor,
            paiId: s.paiId,
            criadoPor: s.criadoPor,
            criadoEm: s.criadoEm,
          };
        }),
        computadores: ler(abaComputadores, COLUNAS_COMPUTADORES),
      });
    } finally {
      trava.releaseLock();
    }
  } catch (erro) {
    return json({ ok: false, erro: String(erro && erro.message ? erro.message : erro) });
  }
}

function json(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function prepararAba(planilha, nome, colunas) {
  let aba = planilha.getSheetByName(nome);
  if (!aba) {
    aba = planilha.insertSheet(nome);
  }
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, colunas.length)
      .setValues([colunas.map(function (c) { return c[1]; })])
      .setFontWeight('bold');
    aba.setFrozenRows(1);
    // Texto puro em todas as colunas (mantém zeros à esquerda do tombamento).
    aba.getRange(1, 1, aba.getMaxRows(), colunas.length).setNumberFormat('@');
    // Esconde as colunas de ID (usadas só pelo app).
    colunas.forEach(function (c, i) {
      if (c[0] === 'id' || c[0] === 'subsetorId' || c[0] === 'paiId') aba.hideColumns(i + 1);
    });
  }
  return aba;
}

function lerLinhas(aba, colunas) {
  const total = aba.getLastRow() - 1;
  if (total <= 0) return [];
  return aba.getRange(2, 1, total, colunas.length).getValues();
}

function ler(aba, colunas) {
  return lerLinhas(aba, colunas)
    .filter(function (linha) { return linha[0] !== ''; })
    .map(function (linha) {
      const objeto = {};
      colunas.forEach(function (c, i) {
        objeto[c[0]] = CAMPOS_DATA.indexOf(c[0]) >= 0 ? paraIso(linha[i]) : String(linha[i]);
      });
      return objeto;
    });
}

function gravar(aba, colunas, registros) {
  if (!registros.length) return;
  const linhas = lerLinhas(aba, colunas);
  const posicao = {};
  linhas.forEach(function (linha, i) { if (linha[0] !== '') posicao[linha[0]] = i + 2; });

  const excluir = [];
  const novas = [];
  registros.forEach(function (r) {
    if (!r || !r.id) return;
    const linhaPlanilha = posicao[r.id];
    if (r.excluido) {
      if (linhaPlanilha) excluir.push(linhaPlanilha);
      return;
    }
    const valores = colunas.map(function (c) {
      const v = r[c[0]];
      return CAMPOS_DATA.indexOf(c[0]) >= 0 ? formatarData(v) : (v == null ? '' : String(v));
    });
    if (linhaPlanilha) {
      aba.getRange(linhaPlanilha, 1, 1, colunas.length).setValues([valores]);
    } else {
      novas.push(valores);
    }
  });

  if (novas.length) {
    const inicio = aba.getLastRow() + 1;
    const intervalo = aba.getRange(inicio, 1, novas.length, colunas.length);
    intervalo.setNumberFormat('@');
    intervalo.setValues(novas);
  }

  // Apaga de baixo para cima para não deslocar as linhas ainda não apagadas.
  excluir.sort(function (a, b) { return b - a; }).forEach(function (n) { aba.deleteRow(n); });
}

// Datas ficam na planilha como "dd/MM/yyyy HH:mm:ss" (texto) no fuso da planilha.
function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, fuso(), 'dd/MM/yyyy HH:mm:ss');
}

function paraIso(valor) {
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') return valor.toISOString();
  const m = String(valor).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return String(valor);
  const texto = m[3] + '-' + m[2] + '-' + m[1] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
  const d = Utilities.parseDate(texto, fuso(), "yyyy-MM-dd'T'HH:mm:ss");
  return d.toISOString();
}

function fuso() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Sao_Paulo';
}
