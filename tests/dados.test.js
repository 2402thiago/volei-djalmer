import test from "node:test";
import assert from "node:assert/strict";
import {
  carregar, CHAVE, CHAVE_BACKUP, estadoVazio, aplicarImportacao, previaImportacao,
  aplicarListaGrupo, resolverPendente, presentesParaSorteio, casaisParaSorteio, moverAtleta, atualizarAtleta,
} from "../js/dados.js";

class StorageFalso {
  constructor(dados = {}) { this.dados = { ...dados }; }
  get length() { return Object.keys(this.dados).length; }
  key(i) { return Object.keys(this.dados)[i] ?? null; }
  getItem(chave) { return chave in this.dados ? this.dados[chave] : null; }
  setItem(chave, valor) { this.dados[chave] = String(valor); }
}

const atleta = (id, nome, extra = {}) => ({ id, nome, sexo: "M", pote: "M1", potesAdicionais: [], aliases: [], ...extra });

test("migra cadastro, presença e casais do app anterior e guarda backup", () => {
  const legado = {
    "volei.cadastro.atletas.v1": JSON.stringify([
      { id: "a", nome: "Ana", sexo: "F", pote: "C1", potesAdicionais: ["F1", "XX"], aliases: ["Aninha"] },
      { id: "b", nome: "Beto", sexo: "M", pote: "M2" },
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
  assert.deepEqual(estado.presenca, { ids: ["a"], pendentes: ["Desconhecido"] });
  assert.deepEqual(estado.casais, { ativado: true, lista: [{ a: "Ana", b: "Beto", ativo: false }] });
  assert.deepEqual(JSON.parse(storage.getItem(CHAVE_BACKUP)), legado);
  assert.ok(storage.getItem(CHAVE));
});

test("começa vazio sem dados antigos", () => {
  assert.deepEqual(carregar(new StorageFalso()), estadoVazio());
});

test("importação substitui a lista, mantém ids e mostra a prévia", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana"), atleta("b", "Beto")];
  estado.presenca.ids = ["a", "b"];
  estado.casais.lista = [{ a: "Ana", b: "Beto", ativo: false }];
  const lido = {
    atletas: [atleta(undefined, "Carla"), atleta(undefined, "ana", { pote: "C1" })],
    casais: [{ a: "Beto", b: "Ana" }],
  };
  assert.deepEqual(previaImportacao(estado, lido), { total: 2, novos: ["Carla"], removidos: ["Beto"], repetidos: [], casais: 1 });
  aplicarImportacao(estado, lido);
  assert.deepEqual(estado.atletas.map((a) => a.nome), ["Carla", "ana"]);
  assert.equal(estado.atletas[1].id, "a");
  assert.equal(estado.atletas[1].pote, "C1");
  assert.deepEqual(estado.presenca.ids, ["a"]);
  assert.equal(estado.casais.lista[0].ativo, false);
});

test("lista do grupo marca por nome e apelido e separa os desconhecidos", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana Paula", { aliases: ["Aninha"] }), atleta("b", "Beto")];
  const resultado = aplicarListaGrupo(estado, ["aninha", "BETO", "Zé"]);
  assert.deepEqual(resultado, { marcados: 2, pendentes: ["Zé"] });
  resolverPendente(estado, "Zé", "b");
  assert.deepEqual(estado.atletas[1].aliases, ["Zé"]);
  assert.deepEqual(estado.presenca.pendentes, []);
  resolverPendente(estado, "Novo", null);
  assert.equal(estado.atletas[2].nome, "Novo");
  assert.ok(estado.presenca.ids.includes(estado.atletas[2].id));
});

test("ranking vem da ordem da lista e acompanha a movimentação", () => {
  const estado = estadoVazio();
  estado.atletas = [atleta("a", "Ana"), atleta("b", "Beto"), atleta("c", "Caio")];
  estado.presenca.ids = ["c", "a"];
  moverAtleta(estado, "c", "a");
  assert.deepEqual(presentesParaSorteio(estado).map((a) => [a.nome, a.ranking]), [["Caio", 1], ["Ana", 2]]);
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
