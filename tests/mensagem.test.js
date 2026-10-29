import test from "node:test";
import assert from "node:assert/strict";
import { gerarMensagemMaster, lerMensagemMaster, extrairListaGrupo, gerarMensagemTimes } from "../js/mensagem.js";

const atletas = [
  { nome: "João Silva", sexo: "M", pote: "C1", potesAdicionais: ["M1"], aliases: ["Joãozinho", "JP"] },
  { nome: "Pedro", sexo: "M", pote: "M1", potesAdicionais: [], aliases: [] },
  { nome: "Ana", sexo: "F", pote: "C1", potesAdicionais: [], aliases: [] },
  { nome: "Novata", sexo: "", pote: "", potesAdicionais: [], aliases: [] },
];
const casais = [{ a: "João Silva", b: "Ana", ativo: true }];

test("gera a Lista Master agrupada por pote com ranking geral", () => {
  const mensagem = gerarMensagemMaster(atletas, casais);
  assert.equal(mensagem, [
    "*Lista Master - Vôlei Djalmer*",
    "*C1*\n1. João Silva (M) +M1 [Joãozinho, JP]\n3. Ana (F)",
    "*M1*\n2. Pedro (M)",
    "*Sem pote*\n4. Novata",
    "*Casais*\nJoão Silva & Ana",
  ].join("\n\n"));
});

test("importar a mensagem exportada devolve os mesmos dados", () => {
  const lido = lerMensagemMaster(gerarMensagemMaster(atletas, casais));
  assert.deepEqual(lido.atletas, atletas);
  assert.deepEqual(lido.casais, [{ a: "João Silva", b: "Ana" }]);
});

test("aceita a mensagem sem asteriscos e com quebras do Windows", () => {
  const texto = "Lista Master - Vôlei Djalmer\r\n\r\nC1\r\n1. Ana (F)\r\nM2\r\n2. Beto (m) +f2";
  const lido = lerMensagemMaster(texto);
  assert.deepEqual(lido.atletas.map((a) => [a.nome, a.sexo, a.pote, a.potesAdicionais]), [
    ["Ana", "F", "C1", []],
    ["Beto", "M", "M2", ["F2"]],
  ]);
});

test("recusa pote adicional desconhecido e mensagem vazia", () => {
  assert.throws(() => lerMensagemMaster("*C1*\n1. Ana (F) +X9"), /pote desconhecido \+X9/);
  assert.throws(() => lerMensagemMaster("oi pessoal"), /Nenhum atleta/);
});

test("lê a lista do grupo até a espera, sem os checks", () => {
  const texto = [
    "Vôlei sábado 16h",
    "1. Ana ✅",
    "2. Beto",
    "3. (convidado do Beto)",
    "4. Carla ☑️",
    "",
    "Espera Grupo",
    "1. Dani",
  ].join("\n");
  assert.deepEqual(extrairListaGrupo(texto), ["Ana", "Beto", "Carla"]);
});

test("considera só os primeiros 24 da lista do grupo", () => {
  const texto = Array.from({ length: 30 }, (_, i) => `${i + 1}. Pessoa ${i + 1}`).join("\n");
  assert.equal(extrairListaGrupo(texto).length, 24);
});

test("gera a mensagem dos times", () => {
  const mensagem = gerarMensagemTimes([{ nome: "Time Ana", jogadores: [{ nome: "Ana" }, { nome: "Beto" }] }]);
  assert.equal(mensagem, "*Times - Vôlei Djalmer*\n\n*Time Ana*\n1. Ana\n2. Beto");
});
