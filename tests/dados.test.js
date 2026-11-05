import test from "node:test";
import assert from "node:assert/strict";
import {
  carregar, CHAVE, CHAVE_BACKUP, estadoVazio, aplicarImportacao, previaImportacao,
  aplicarListaGrupo, resolverPendente, confirmadosParaSorteio, casaisParaSorteio, moverAtleta, atualizarAtleta,
  adicionarAtleta, aplicarTimesColados, alternarCheckin, chegou, definirTimes, desfazerTimes,
} from "../js/dados.js";

class StorageFalso {
  constructor(dados = {}) { this.dados = { ...dados }; }
  get length() { return Object.keys(this.dados).length; }
  key(i) { return Object.keys(this.dados)[i] ?? null; }
  getItem(chave) { return chave in this.dados ? this.dados[chave] : null; }
  setItem(chave, valor) { this.dados[chave] = String(valor); }
}

const atleta = (id, nome, extra = {}) => ({ id, nome, sexo: "M", pote: "M1", potesAdicionais: [], aliases: [], ...extra });

test("migra cadastro, confirmados e casais do app anterior e guarda backup", () => {
  const legado = {
    "volei.cadastro.atletas.v1": JSON.stringify([
      { id: "b", nome: "Beto", sexo: "M", pote: "M2" },
      { id: "a", nome: "Ana", sexo: "F", pote: "C1", potesAdicionais: ["F1", "XX"], aliases: ["Aninha"] },
    ]),
    "volei.participantes.v1": JSON.stringify([
      { id: "a", cadastro_id: "a", nome: "Ana", status: "ativo" },
      { id: "z", cadastro_id: null, nome: "Desconhecido", status: "ativo" },
      { id: "b", cadastro_id: "b", nome: "Beto", status: "inativo" },
    ]),
    "volei.casais.v1": "true",
    "volei.casais.config.v1": JSON.stringify([["Ana", "Beto"]]),
    "volei.casais.ativos.v1": JSON.stringify([false]),
  };
  const storage = new StorageFalso(legado);
  const estado = carregar(storage);
  assert.deepEqual(estado.atletas, [
    { id: "a", nome: "Ana", sexo: "F", pote: "C1", potesAdicionais: ["F1"], aliases: ["Aninha"] },
    { id: "b", nome: "Beto", sexo: "M", pote: "M2", potesAdicionais: [], aliases: [] },
  ]);
  assert.deepEqual(estado.lista, { ids: ["a"], pendentes: ["Desconhecido"] });
  assert.deepEqual(estado.casais, { ativado: true, lista: [{ a: "Ana", b: "Beto", ativo: false }] });
  assert.deepEqual(JSON.parse(storage.getItem(CHAVE_BACKUP)), legado);
  assert.ok(storage.getItem(CHAVE));
});

test("casais fixos do app anterior não são mais carregados", () => {
  const padrao = [
    { a: "Thiago Ramalho", b: "Maria Clara Batista", ativo: true },
    { a: "Douglas Nascimento", b: "Pattricia", ativo: true },
    { a: "João Alberto", b: "Thais Moreno", ativo: true },
    { a: "Erivan Junior", b: "Livia Cristhina", ativo: true },
  ];
  const salvo = { ...estadoVazio(), casais: { ativado: true, lista: padrao } };
  const estado = carregar(new StorageFalso({ [CHAVE]: JSON.stringify(salvo) }));
  assert.deepEqual(estado.casais, { ativado: false, lista: [] });
  assert.deepEqual(carregar(new StorageFalso({ "volei.casais.v1": "true" })).casais, { ativado: false, lista: [] });
});

test("converte o estado salvo da versão anterior (presenca vira lista)", () => {
  const salvo = { atletas: [atleta("a", "Ana")], presenca: { ids: ["a"], pendentes: [] } };
  const estado = carregar(new StorageFalso({ [CHAVE]: JSON.stringify(salvo) }));
  assert.deepEqual(estado.lista, { ids: ["a"], pendentes: [] });
  assert.equal(estado.presenca, undefined);
  assert.deepEqual(estado.checkin, { ids: [], ordem: [] });
});

test("começa vazio sem dados antigos", () => {
  assert.deepEqual(carregar(new StorageFalso()), estadoVazio());
});

test("lista fica agrupada por pote na ordem C1, M1, M2, LM1, F1, F2, LF1", () => {
  const estado = estadoVazio();
  ["LF1", "F2", "F1", "LM1", "M2", "M1", "C1", ""].forEach((pote, i) => adicionarAtleta(estado, { nome: `P${i}`, pote }));
  assert.deepEqual(estado.atletas.map((a) => a.pote), ["C1", "M1", "M2", "LM1", "F1", "F2", "LF1", ""]);
});

test("trocar de pote leva o atleta para o fim do novo grupo", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana", { pote: "C1" }), atleta("b", "Beto"), atleta("c", "Caio"), atleta("d", "Duda", { pote: "M2" })];
  atualizarAtleta(estado, "a", { pote: "M1" });
  assert.deepEqual(estado.atletas.map((a) => a.nome), ["Beto", "Caio", "Ana", "Duda"]);
});

test("ranking só muda dentro do mesmo pote", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana"), atleta("b", "Beto"), atleta("c", "Caio", { pote: "M2" })];
  estado.lista.ids = ["b", "a"];
  moverAtleta(estado, "b", "a");
  moverAtleta(estado, "c", "a");
  assert.deepEqual(estado.atletas.map((a) => a.nome), ["Beto", "Ana", "Caio"]);
  assert.deepEqual(confirmadosParaSorteio(estado).map((a) => [a.nome, a.ranking]), [["Beto", 1], ["Ana", 2]]);
});

test("importação substitui a lista, mantém ids e mostra a prévia", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana"), atleta("b", "Beto")];
  estado.lista.ids = ["a", "b"];
  estado.casais.lista = [{ a: "Ana", b: "Beto", ativo: false }];
  const lido = {
    atletas: [atleta(undefined, "Carla"), atleta(undefined, "ana", { pote: "C1" })],
    casais: [{ a: "Beto", b: "Ana" }],
  };
  assert.deepEqual(previaImportacao(estado, lido), { total: 2, novos: ["Carla"], removidos: ["Beto"], repetidos: [], casais: 1 });
  aplicarImportacao(estado, lido);
  assert.deepEqual(estado.atletas.map((a) => a.nome), ["ana", "Carla"]);
  assert.equal(estado.atletas[0].id, "a");
  assert.deepEqual(estado.lista.ids, ["a"]);
  assert.equal(estado.casais.lista[0].ativo, false);
});

test("lista do grupo marca por nome e apelido e separa os desconhecidos", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana Paula", { aliases: ["Aninha"] }), atleta("b", "Beto")];
  const resultado = aplicarListaGrupo(estado, ["aninha", "BETO", "Zé"]);
  assert.deepEqual(resultado, { marcados: 2, pendentes: ["Zé"] });
  resolverPendente(estado, "Zé", "b");
  assert.deepEqual(estado.atletas[1].aliases, ["Zé"]);
  assert.deepEqual(estado.lista.pendentes, []);
  resolverPendente(estado, "Novo", null);
  assert.ok(estado.lista.ids.includes(estado.atletas.find((a) => a.nome === "Novo").id));
});

test("casais usam o nome oficial e renomear atualiza os casais", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana", { aliases: ["Aninha"] }), atleta("b", "Beto")];
  estado.casais = { ativado: true, lista: [{ a: "Aninha", b: "Beto", ativo: true }, { a: "X", b: "Y", ativo: false }] };
  assert.deepEqual(casaisParaSorteio(estado), [["Ana", "Beto"]]);
  atualizarAtleta(estado, "b", { nome: "Roberto" });
  assert.equal(estado.casais.lista[0].b, "Roberto");
  estado.casais.ativado = false;
  assert.deepEqual(casaisParaSorteio(estado), []);
});

test("times colados viram os confirmados e nomes desconhecidos ficam pendentes", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana", { pote: "C1" }), atleta("b", "Beto", { aliases: ["Betinho"] })];
  const resultado = aplicarTimesColados(estado, [
    { nome: "Time Ana", jogadores: ["Ana", "Zé"] },
    { nome: "Time 2", jogadores: ["Betinho"] },
  ]);
  assert.deepEqual(resultado, { times: 2, atletas: 3, pendentes: ["Zé"] });
  assert.deepEqual(estado.lista, { ids: ["a", "b"], pendentes: ["Zé"] });
  assert.equal(estado.times[1].jogadores[0].nome, "Beto");
  resolverPendente(estado, "Zé", null);
  assert.ok(estado.times[0].jogadores[1].id);
  assert.throws(() => aplicarTimesColados(estado, [{ nome: "Time A", jogadores: ["Ana"] }, { nome: "Time B", jogadores: ["Ana"] }]), /mais de um lugar/);
});

test("ordem em quadra segue a ordem em que cada time fica completo", () => {
  const estado = estadoVazio();
  const time = (letra) => ({ nome: `Time ${letra}`, jogadores: [1, 2].map((n) => ({ id: `${letra}${n}`, nome: `${letra}${n}` })) });
  definirTimes(estado, [time("A"), time("B"), time("C")]);
  const marcar = (id) => alternarCheckin(estado, { id });
  marcar("B1"); marcar("A1"); marcar("B2");
  assert.deepEqual(estado.checkin.ordem, [1]);
  marcar("C1"); marcar("C2"); marcar("A2");
  assert.deepEqual(estado.checkin.ordem, [1, 2, 0]);
  marcar("B2");
  assert.deepEqual(estado.checkin.ordem, [2, 0]);
  marcar("B2");
  assert.deepEqual(estado.checkin.ordem, [2, 0, 1]);
  assert.ok(chegou(estado, { id: "A1" }));
  desfazerTimes(estado);
  assert.deepEqual(estado.checkin, { ids: [], ordem: [] });
});
