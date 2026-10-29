import test from "node:test";
import assert from "node:assert/strict";
import { sortearTimes, problemasParaSortear } from "../js/sorteio.js";
import { rngSemente, vinteQuatro } from "./fixtures.js";

const mulheres = (time) => time.jogadores.filter((j) => j.sexo === "F").length;

function conferirComposicao(times, atletas) {
  assert.equal(times.length, 4);
  const ids = times.flatMap((t) => t.jogadores.map((j) => j.id));
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, 24);
  assert.deepEqual([...ids].sort(), atletas.map((a) => a.id).sort());
  times.forEach((time) => assert.equal(time.jogadores.length, 6));
  const contagem = times.map(mulheres);
  assert.ok(Math.max(...contagem) - Math.min(...contagem) <= 1, `mulheres desequilibradas: ${contagem}`);
}

test("monta 4 times de 6 com 1 C1 e 1 levantador por time", () => {
  for (let semente = 1; semente <= 30; semente++) {
    const atletas = vinteQuatro();
    const { times } = sortearTimes(atletas, { rng: rngSemente(semente) });
    conferirComposicao(times, atletas);
    times.forEach((time) => {
      const potes = time.jogadores.map((j) => j.poteSorteio);
      assert.equal(potes.filter((p) => p === "C1").length, 1);
      assert.equal(potes.filter((p) => p === "levantadores").length, 1);
      assert.equal(potes.filter((p) => p === "M1").length, 1);
      assert.equal(potes.filter((p) => p === "F1").length, 1);
    });
  }
});

test("pareia opostos do ranking entre C1 e levantador", () => {
  const atletas = vinteQuatro();
  const { times } = sortearTimes(atletas, { rng: rngSemente(7) });
  const rankDe = new Map(atletas.map((a) => [a.id, a.ranking]));
  const posicao = (lista, id) => lista.indexOf(id);
  const c1 = atletas.filter((a) => a.pote === "C1").map((a) => a.id);
  const lev = atletas.filter((a) => a.pote === "LM1" || a.pote === "LF1").map((a) => a.id);
  times.forEach((time) => {
    const doC1 = time.jogadores.find((j) => j.poteSorteio === "C1");
    const doLev = time.jogadores.find((j) => j.poteSorteio === "levantadores");
    assert.equal(posicao(c1, doC1.id) + posicao(lev, doLev.id), 3, `par ${rankDe.get(doC1.id)} + ${rankDe.get(doLev.id)}`);
  });
});

test("nomeia o time pelo C1 sorteado", () => {
  const { times } = sortearTimes(vinteQuatro(), { rng: rngSemente(3) });
  times.forEach((time) => {
    const c1 = time.jogadores.find((j) => j.poteSorteio === "C1");
    assert.equal(time.nome, `Time ${c1.nome}`);
  });
});

test("mantém casais ativos no mesmo time", () => {
  for (let semente = 1; semente <= 20; semente++) {
    const atletas = vinteQuatro();
    const casais = [["M1 M1", "F1 F1"], ["M2 M2", "F2 F3"]];
    const { times, casaisAusentes } = sortearTimes(atletas, { casais, rng: rngSemente(semente) });
    conferirComposicao(times, atletas);
    assert.deepEqual(casaisAusentes, []);
    casais.forEach(([a, b]) => {
      const time = times.find((t) => t.jogadores.some((j) => j.nome === a));
      assert.ok(time.jogadores.some((j) => j.nome === b), `${a} e ${b} separados`);
    });
  }
});

test("avisa casal que não está entre os presentes", () => {
  const { casaisAusentes } = sortearTimes(vinteQuatro(), { casais: [["Fulano", "Ciclana"]], rng: rngSemente(1) });
  assert.deepEqual(casaisAusentes, ["Fulano e Ciclana"]);
});

test("usa pote adicional quando o principal está cheio", () => {
  const atletas = vinteQuatro();
  // Um M2 a mais e um M1 a menos: o M2 com permissão de M1 sobe.
  const trocado = atletas.find((a) => a.pote === "M1");
  trocado.pote = "M2";
  trocado.potesAdicionais = ["M1"];
  const { times } = sortearTimes(atletas, { rng: rngSemente(5) });
  const jogador = times.flatMap((t) => t.jogadores).find((j) => j.id === trocado.id);
  assert.equal(jogador.poteSorteio, "M1");
});

test("explica por que não dá para sortear", () => {
  const atletas = vinteQuatro().slice(0, 22);
  atletas[0].pote = "";
  atletas[1].sexo = "";
  const problemas = problemasParaSortear(atletas);
  assert.match(problemas[0], /Faltam 2/);
  assert.ok(problemas.some((p) => p.includes("sem pote principal")));
  assert.ok(problemas.some((p) => p.includes("sem sexo")));
  assert.throws(() => sortearTimes(atletas), /Faltam 2/);
  assert.match(problemasParaSortear([...vinteQuatro(), ...vinteQuatro().slice(0, 1)])[0], /Sobra 1 presente/);
});

test("falha com mensagem clara quando os potes não fecham", () => {
  const atletas = vinteQuatro();
  atletas.filter((a) => a.pote === "C1").forEach((a) => { a.pote = "M2"; });
  assert.throws(() => sortearTimes(atletas, { rng: rngSemente(1) }), /não fecham os potes/);
});
