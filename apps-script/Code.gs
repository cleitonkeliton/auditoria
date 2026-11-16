/**
 * Recebe os dados do app de Auditoria e grava na planilha.
 *
 * Instalação (uma vez só):
 *  1. Abra a planilha no Google Sheets e vá em Extensões > Apps Script.
 *  2. Apague todo o conteúdo e cole este arquivo inteiro.
 *  3. Troque a CHAVE abaixo por uma senha sua (a mesma vai no app) e salve.
 *  4. Na barra de cima, escolha a função "configurar" e clique em Executar.
 *     Autorize o acesso quando o Google pedir.
 *  5. Implantar > Nova implantação > App da Web.
 *     Executar como: "Eu". Quem pode acessar: "Qualquer pessoa".
 *  6. Copie a URL que termina em /exec e coloque no app.
 *
 * Para conferir se está tudo certo, abra a URL /exec no navegador.
 */

const CHAVE = 'TROQUE-ESTA-CHAVE';

const ABA_COMPUTADORES = 'Computadores';
const ABA_SETORES = 'Setores';
const PROPRIEDADE_PLANILHA = 'PLANILHA_ID';

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
  // ID do setor ou do subsetor onde o computador está.
  ['subsetorId', 'ID Local'],
];

const COLUNAS_SETORES = [
  ['id', 'ID'],
  ['setor', 'Setor'],
  ['subsetor', 'Subsetor'],
  ['paiId', 'ID Setor'],
  ['criadoPor', 'Criado por'],
  ['criadoEm', 'Criado em'],
];

const COLUNAS_OCULTAS = ['id', 'subsetorId', 'paiId'];
const CAMPOS_DATA = ['criadoEm', 'atualizadoEm'];

let FUSO = 'America/Sao_Paulo';

/**
 * Execute esta função uma vez pelo editor (escolha "configurar" e clique em Executar).
 * Ela pede a autorização do Google, liga o script à planilha e cria as abas.
 */
function configurar() {
  const propriedades = PropertiesService.getScriptProperties();
  let planilha = SpreadsheetApp.getActiveSpreadsheet();
  if (!planilha) {
    // Script criado fora da planilha: usa a planilha já configurada ou cria uma nova.
    const id = propriedades.getProperty(PROPRIEDADE_PLANILHA);
    if (id) {
      try {
        planilha = SpreadsheetApp.openById(id);
      } catch (erro) {
        planilha = null;
      }
    }
    if (!planilha) planilha = SpreadsheetApp.create('Auditoria de computadores');
  }
  propriedades.setProperty(PROPRIEDADE_PLANILHA, planilha.getId());

  prepararAba(planilha, ABA_SETORES, COLUNAS_SETORES);
  prepararAba(planilha, ABA_COMPUTADORES, COLUNAS_COMPUTADORES);
  removerAbaVaziaPadrao(planilha);

  Logger.log('Tudo pronto! Planilha: "' + planilha.getName() + '"');
  Logger.log('Endereço da planilha: ' + planilha.getUrl());
  if (CHAVE === 'TROQUE-ESTA-CHAVE') {
    Logger.log('ATENÇÃO: troque a CHAVE no início do código, salve e execute "configurar" de novo.');
  }
  Logger.log('Próximo passo: Implantar > Gerenciar implantações (ou Nova implantação), sempre com "Nova versão".');
}

function obterPlanilha() {
  const id = PropertiesService.getScriptProperties().getProperty(PROPRIEDADE_PLANILHA);
  const planilha = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!planilha) {
    throw new Error('Planilha não configurada. No editor do Apps Script, escolha a função "configurar" e clique em Executar.');
  }
  FUSO = planilha.getSpreadsheetTimeZone() || FUSO;
  return planilha;
}

function explicarErro(erro) {
  const mensagem = String(erro && erro.message ? erro.message : erro);
  if (/permission|permiss|authoriz|autoriza/i.test(mensagem)) {
    return 'Sem permissão para abrir a planilha (' + mensagem + '). ' +
      'No editor do Apps Script, execute a função "configurar" e autorize. ' +
      'Depois, em Implantar > Gerenciar implantações, edite a implantação com ' +
      '"Executar como: Eu", "Quem pode acessar: Qualquer pessoa" e "Versão: Nova versão".';
  }
  return mensagem;
}

/** Ao abrir a URL /exec no navegador, mostra se a planilha está funcionando. */
function doGet() {
  let corpo;
  try {
    const planilha = obterPlanilha();
    const aba = planilha.getSheetByName(ABA_COMPUTADORES);
    const total = aba ? Math.max(aba.getLastRow() - 1, 0) : 0;
    corpo =
      '<h1>✅ Planilha da auditoria funcionando</h1>' +
      '<p>Planilha: <a href="' + esc(planilha.getUrl()) + '" target="_blank"><b>' + esc(planilha.getName()) + '</b></a></p>' +
      '<p>Computadores registrados: <b>' + total + '</b></p>' +
      (CHAVE === 'TROQUE-ESTA-CHAVE'
        ? '<p style="color:#b00020">⚠️ A CHAVE ainda é a padrão. Troque no código, salve e faça uma nova versão da implantação.</p>'
        : '<p>Use esta URL e a sua chave no app.</p>');
  } catch (erro) {
    corpo = '<h1>❌ A planilha não está acessível</h1><p>' + esc(explicarErro(erro)) + '</p>';
  }
  return HtmlService
    .createHtmlOutput('<div style="font-family:sans-serif;font-size:16px;line-height:1.5;padding:8px">' + corpo + '</div>')
    .setTitle('Auditoria')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const pedido = JSON.parse(e.postData.contents);
    if (pedido.chave !== CHAVE) {
      return json({ ok: false, erro: 'Chave de acesso inválida. A chave no app precisa ser igual à CHAVE do script.' });
    }
    if (pedido.acao !== 'sincronizar') return json({ ok: false, erro: 'Ação desconhecida' });

    const trava = LockService.getScriptLock();
    trava.waitLock(30000);
    try {
      const planilha = obterPlanilha();
      const abaSetores = prepararAba(planilha, ABA_SETORES, COLUNAS_SETORES);
      const abaComputadores = prepararAba(planilha, ABA_COMPUTADORES, COLUNAS_COMPUTADORES);

      const setores = (pedido.setores || []).map(function (s) {
        return {
          id: s.id,
          // Setor principal: o nome vai em "Setor". Subsetor: "Setor" é o nome do setor dele.
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
        planilhaUrl: planilha.getUrl(),
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
    return json({ ok: false, erro: explicarErro(erro) });
  }
}

function json(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function esc(texto) {
  return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    // Texto puro em todas as colunas (mantém o tombamento exatamente como foi enviado).
    aba.getRange(1, 1, aba.getMaxRows(), colunas.length).setNumberFormat('@');
    // Esconde as colunas de ID (usadas só pelo app).
    colunas.forEach(function (c, i) {
      if (COLUNAS_OCULTAS.indexOf(c[0]) >= 0) aba.hideColumns(i + 1);
    });
  }
  return aba;
}

// Uma planilha nova vem com uma aba vazia ("Página1"); ela é removida se não tiver nada.
function removerAbaVaziaPadrao(planilha) {
  ['Página1', 'Sheet1'].forEach(function (nome) {
    const aba = planilha.getSheetByName(nome);
    if (aba && aba.getLastRow() === 0 && planilha.getSheets().length > 1) planilha.deleteSheet(aba);
  });
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
  return Utilities.formatDate(d, FUSO, 'dd/MM/yyyy HH:mm:ss');
}

function paraIso(valor) {
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') return valor.toISOString();
  const m = String(valor).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return String(valor);
  const texto = m[3] + '-' + m[2] + '-' + m[1] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
  return Utilities.parseDate(texto, FUSO, "yyyy-MM-dd'T'HH:mm:ss").toISOString();
}
