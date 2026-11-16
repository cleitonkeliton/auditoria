// Testes do apps-script/Code.gs com o Google simulado.   node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente } from './servidor-teste.mjs';

function sincronizar(ambiente, corpo) {
  const saida = ambiente.contexto.doPost({
    postData: { contents: JSON.stringify(Object.assign({ acao: 'sincronizar', chave: 'teste123', usuario: 'Ana' }, corpo)) },
  });
  return JSON.parse(saida.texto);
}

const setor = { id: 's1', nome: 'Financeiro', paiId: '', paiNome: '', criadoPor: 'Ana', criadoEm: '2026-11-16T12:00:00.000Z' };
const subsetor = { id: 's2', nome: 'Sala 101', paiId: 's1', paiNome: 'Financeiro', criadoPor: 'Ana', criadoEm: '2026-11-16T12:01:00.000Z' };
const pcNoSetor = {
  id: 'c1', tombamento: '756322', setor: 'Financeiro', subsetor: '', subsetorId: 's1', localizacao: 'Recepção',
  marca: 'Daten', modelo: 'Mini', observacao: '', usuario: 'Ana', criadoEm: '2026-11-16T12:02:00.000Z',
  atualizadoPor: 'Ana', atualizadoEm: '2026-11-16T12:02:00.000Z',
};
const pcNoSubsetor = Object.assign({}, pcNoSetor, { id: 'c2', tombamento: '8120441', subsetor: 'Sala 101', subsetorId: 's2' });

test('planilha vinculada funciona sem rodar "configurar"', () => {
  const amb = criarAmbiente({ vinculada: true });
  const r = sincronizar(amb, { setores: [setor, subsetor], computadores: [pcNoSetor, pcNoSubsetor] });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.planilhaUrl, amb.ativa.getUrl());
  assert.equal(r.computadores.length, 2);
  const linhas = amb.ativa.abas.Computadores.linhas;
  assert.deepEqual(linhas[0].slice(1, 4), ['Tombamento', 'Setor', 'Subsetor']);
  assert.deepEqual(linhas[1].slice(1, 4), ['756322', 'Financeiro', ''], 'computador direto no setor fica sem subsetor');
  assert.deepEqual(linhas[2].slice(1, 4), ['8120441', 'Financeiro', 'Sala 101']);
  assert.deepEqual(r.setores.map((s) => s.nome), ['Financeiro', 'Sala 101']);
});

test('"configurar" liga o script à planilha vinculada e remove a aba vazia', () => {
  const amb = criarAmbiente({ vinculada: true });
  amb.contexto.configurar();
  assert.equal(amb.propriedades.PLANILHA_ID, amb.ativa.getId());
  assert.deepEqual(amb.ativa.getSheets().map((a) => a.nome), ['Setores', 'Computadores']);
  assert.match(amb.contexto.doGet().texto, /funcionando/);
  assert.equal(sincronizar(amb, { computadores: [pcNoSetor] }).ok, true);
});

test('script fora da planilha: "configurar" cria uma planilha nova', () => {
  const amb = criarAmbiente({ vinculada: false });
  const antes = sincronizar(amb, { computadores: [pcNoSetor] });
  assert.equal(antes.ok, false);
  assert.match(antes.erro, /configurar/);
  assert.match(amb.contexto.doGet().texto, /❌/);

  amb.contexto.configurar();
  const id = amb.propriedades.PLANILHA_ID;
  assert.ok(id);
  assert.equal(amb.arquivos[id].getName(), 'Auditoria de computadores');
  const depois = sincronizar(amb, { computadores: [pcNoSetor] });
  assert.equal(depois.ok, true, depois.erro);
  assert.match(amb.contexto.doGet().texto, /Computadores registrados: <b>1<\/b>/);

  amb.contexto.configurar();
  assert.equal(amb.propriedades.PLANILHA_ID, id, 'rodar de novo reaproveita a mesma planilha');
});

test('sem permissão: a resposta explica como resolver', () => {
  const amb = criarAmbiente({ vinculada: true });
  amb.estado.falha = 'permissao';
  const r = sincronizar(amb, { computadores: [pcNoSetor] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /You do not have permission/);
  assert.match(r.erro, /configurar/);
  assert.match(r.erro, /Executar como: Eu/);
  assert.match(amb.contexto.doGet().texto, /❌/);
});

test('chave errada é recusada', () => {
  const amb = criarAmbiente({ vinculada: true });
  const r = sincronizar(amb, { chave: 'outra', computadores: [pcNoSetor] });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Chave de acesso inválida/);
  assert.equal(amb.ativa.getSheetByName('Computadores'), null, 'nada é gravado');
});

test('editar atualiza a mesma linha e excluir apaga', () => {
  const amb = criarAmbiente({ vinculada: true });
  sincronizar(amb, { setores: [setor], computadores: [pcNoSetor, pcNoSubsetor] });
  sincronizar(amb, { computadores: [Object.assign({}, pcNoSetor, { observacao: 'Sem mouse' })] });
  let linhas = amb.ativa.abas.Computadores.linhas;
  assert.equal(linhas.length, 3);
  assert.equal(linhas[1][7], 'Sem mouse');

  const r = sincronizar(amb, { computadores: [Object.assign({}, pcNoSetor, { excluido: true })] });
  linhas = amb.ativa.abas.Computadores.linhas;
  assert.equal(linhas.length, 2);
  assert.deepEqual(r.computadores.map((c) => c.tombamento), ['8120441']);
});

test('datas vão para a planilha no horário de Brasília e voltam iguais', () => {
  const amb = criarAmbiente({ vinculada: true });
  const r = sincronizar(amb, { computadores: [pcNoSetor] });
  assert.equal(amb.ativa.abas.Computadores.linhas[1][9], '16/11/2026 09:02:00');
  assert.equal(r.computadores[0].criadoEm, '2026-11-16T12:02:00.000Z');
});
