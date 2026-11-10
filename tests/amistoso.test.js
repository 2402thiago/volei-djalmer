import test from "node:test";
import assert from "node:assert/strict";
import {
  estadoAmistosoVazio, aplicarTimesAmistoso, comecarAmistosos, alternarPresencaAmistoso, comecarConfrontos,
  escalar, iniciarPartida, marcarPonto, desfazerPonto, situacao, sacador, substituir, encerrarPartida,
  opcoesAdversario, trocarAdversario, carregarAmistoso, salvarAmistoso, configurarAmistoso,
} from "../js/amistoso.js";
import { lerMensagemTimes } from "../js/mensagem.js";

const time = (letra, total = 7) => ({ nome: `Time ${letra}`, jogadores: Array.from({ length: total }, (_, i) => `${letra}${i + 1}`) });

/** Amistoso com os times dados, todos presentes, na ordem A, B, C... */
function preparar(letras = ["A", "B"], pontos = 15) {
  const estado = estadoAmistosoVazio();
  aplicarTimesAmistoso(estado, letras.map((l) => time(l)));
  estado.config.pontos = pontos;
  comecarAmistosos(estado);
  estado.times.forEach((t, i) => t.jogadores.forEach((nome) => alternarPresencaAmistoso(estado, i, nome)));
  comecarConfrontos(estado);
  return estado;
}

function escalarTodos(estado) {
  estado.proxima.times.forEach((t) => {
    if (!estado.escalacoes[t]) estado.times[t].jogadores.slice(0, 6).forEach((nome, p) => escalar(estado, t, p, nome));
  });
}

function jogar(estado, ladoVencedor, saque = 0) {
  escalarTodos(estado);
  iniciarPartida(estado, saque);
  while (estado.fase === "jogo") marcarPonto(estado, ladoVencedor);
  const nomes = estado.atual.times.map((t) => estado.times[t].nome);
  encerrarPartida(estado);
  return nomes;
}

const nomesProxima = (estado) => estado.proxima.times.map((t) => estado.times[t].nome);

test("ponto de quem saca mantém o sacador; ponto de quem recebe roda e troca o saque", () => {
  const estado = preparar();
  escalarTodos(estado);
  iniciarPartida(estado, 0);
  assert.equal(sacador(estado), "A1");
  marcarPonto(estado, 0);
  assert.equal(sacador(estado), "A1");
  marcarPonto(estado, 1);
  assert.deepEqual(estado.atual.quadras[1], ["B2", "B3", "B4", "B5", "B6", "B1"]);
  assert.equal(sacador(estado), "B2");
  assert.deepEqual(estado.atual.placar, [1, 1]);
  marcarPonto(estado, 0);
  assert.equal(sacador(estado), "A2");
});

test("partida termina no alvo e o empate vira corrida de 3 pontos", () => {
  const estado = preparar();
  escalarTodos(estado);
  iniciarPartida(estado, 0);
  estado.atual.placar = [14, 13];
  marcarPonto(estado, 0);
  assert.equal(situacao(estado).vencedor, 0);
  assert.equal(estado.fase, "fim");

  desfazerPonto(estado);
  marcarPonto(estado, 1);
  assert.deepEqual(situacao(estado), { alvo: 17, desempate: true, vencedor: null });
  marcarPonto(estado, 0);
  marcarPonto(estado, 1);
  marcarPonto(estado, 0);
  marcarPonto(estado, 1);
  assert.deepEqual(estado.atual.placar, [16, 16]);
  marcarPonto(estado, 1);
  assert.deepEqual(situacao(estado), { alvo: 17, desempate: true, vencedor: 1 });
  assert.throws(() => marcarPonto(estado, 0), /terminou/);
});

test("desfazer volta placar, saque e rotação", () => {
  const estado = preparar();
  escalarTodos(estado);
  iniciarPartida(estado, 0);
  const antes = JSON.parse(JSON.stringify(estado.atual.quadras));
  marcarPonto(estado, 1);
  desfazerPonto(estado);
  assert.deepEqual(estado.atual.quadras, antes);
  assert.deepEqual(estado.atual.placar, [0, 0]);
  assert.equal(estado.atual.saque, 0);
  assert.throws(() => desfazerPonto(estado), /Nenhum ponto/);
});

test("time confirma com 6 presentes e perde a posição abaixo de 6", () => {
  const estado = estadoAmistosoVazio();
  aplicarTimesAmistoso(estado, [time("A"), time("B"), time("C")]);
  comecarAmistosos(estado);
  const marcar = (t, n) => alternarPresencaAmistoso(estado, t, `${"ABC"[t]}${n}`);
  [1, 2, 3, 4, 5, 6].forEach((n) => marcar(1, n));
  [1, 2, 3, 4, 5].forEach((n) => marcar(0, n));
  assert.deepEqual(estado.ordem, [1]);
  assert.throws(() => comecarConfrontos(estado), /pelo menos 2/);
  marcar(0, 6);
  assert.deepEqual(estado.ordem, [1, 0]);
  marcar(1, 6);
  assert.deepEqual(estado.ordem, [0]);
  marcar(1, 7);
  assert.deepEqual(estado.ordem, [0, 1]);
});

test("fila com 3 times: quem vence 2 seguidas descansa 1 partida e volta contra o vencedor", () => {
  const estado = preparar(["A", "B", "C"]);
  assert.deepEqual(nomesProxima(estado), ["Time A", "Time B"]);
  jogar(estado, 0);
  assert.deepEqual(nomesProxima(estado), ["Time A", "Time C"]);
  jogar(estado, 0);
  assert.deepEqual(nomesProxima(estado), ["Time B", "Time C"]);
  assert.deepEqual(opcoesAdversario(estado), []);
  jogar(estado, 0);
  assert.deepEqual(nomesProxima(estado), ["Time B", "Time A"]);
  jogar(estado, 1);
  assert.deepEqual(nomesProxima(estado), ["Time A", "Time C"]);
  assert.equal(estado.partidas.length, 4);
});

test("fila com 4 times e escolha manual do adversário", () => {
  const estado = preparar(["A", "B", "C", "D"]);
  jogar(estado, 0);
  assert.deepEqual(opcoesAdversario(estado).map((t) => estado.times[t].nome), ["Time C", "Time D", "Time B"]);
  trocarAdversario(estado, 3);
  assert.deepEqual(nomesProxima(estado), ["Time A", "Time D"]);
  jogar(estado, 0);
  // A venceu 2 seguidas: jogam os 2 primeiros da fila (C e B) e A volta depois.
  assert.deepEqual(nomesProxima(estado), ["Time C", "Time B"]);
  jogar(estado, 1);
  assert.deepEqual(nomesProxima(estado), ["Time B", "Time A"]);
  assert.throws(() => trocarAdversario(estado, 1), /não pode entrar/);
});

test("com 2 times a regra de 2 vitórias fica desligada e time atrasado entra no fim da fila", () => {
  const estado = estadoAmistosoVazio();
  aplicarTimesAmistoso(estado, [time("A"), time("B"), time("C")]);
  comecarAmistosos(estado);
  [0, 1].forEach((t) => estado.times[t].jogadores.forEach((nome) => alternarPresencaAmistoso(estado, t, nome)));
  comecarConfrontos(estado);
  jogar(estado, 0);
  jogar(estado, 0);
  assert.deepEqual(nomesProxima(estado), ["Time A", "Time B"]);
  estado.times[2].jogadores.forEach((nome) => alternarPresencaAmistoso(estado, 2, nome));
  assert.deepEqual(estado.fila, [1, 2]);
  jogar(estado, 0);
  // A segue vencendo e, agora com 3 times, descansa uma partida.
  assert.deepEqual(nomesProxima(estado), ["Time C", "Time B"]);
});

test("mensagem colada ajusta o formulário e recusa times fora do limite", () => {
  const estado = estadoAmistosoVazio();
  const mensagem = "*Times - Vôlei Djalmer*\n\n*Time Ana*\n" + Array.from({ length: 8 }, (_, i) => `${i + 1}. Ana${i}`).join("\n")
    + "\n\n*Time Bia*\n" + Array.from({ length: 6 }, (_, i) => `${i + 1}. Bia${i}`).join("\n")
    + "\n\n*Time Caio*\n" + Array.from({ length: 6 }, (_, i) => `${i + 1}. Caio${i}`).join("\n");
  assert.deepEqual(aplicarTimesAmistoso(estado, lerMensagemTimes(mensagem)), { times: 3, ajustado: true });
  assert.deepEqual(estado.config, { times: 3, maxAtletas: 8, pontos: 15 });
  assert.throws(() => aplicarTimesAmistoso(estado, [time("A")]), /tem 1 time\./);
  assert.throws(() => aplicarTimesAmistoso(estado, ["A", "B", "C", "D", "E"].map((l) => time(l))), /5 times/);
  assert.throws(() => aplicarTimesAmistoso(estado, [time("A", 5), time("B")]), /5 atletas/);
  assert.throws(() => aplicarTimesAmistoso(estado, [time("A", 11), time("B")]), /11 atletas/);
  assert.throws(() => aplicarTimesAmistoso(estado, [time("A"), { nome: "Time X", jogadores: ["a1", ...time("X").jogadores] }]), /aparece/);
  assert.throws(() => configurarAmistoso(estado, "pontos", 18), /inválida/);
});

test("substituição só aceita presentes fora da quadra e entra na próxima escalação", () => {
  const estado = preparar();
  alternarPresencaAmistoso(estado, 0, "A7");
  escalarTodos(estado);
  iniciarPartida(estado, 0);
  assert.throws(() => substituir(estado, 0, 2, "A7"), /não está marcado/);
  assert.throws(() => substituir(estado, 0, 2, "A1"), /já está em quadra/);
  assert.throws(() => alternarPresencaAmistoso(estado, 0, "A3"), /em quadra/);
  alternarPresencaAmistoso(estado, 0, "A7");
  assert.equal(substituir(estado, 0, 2, "A7"), "A3");
  assert.deepEqual(estado.atual.quadras[0], ["A1", "A2", "A7", "A4", "A5", "A6"]);
  assert.deepEqual(estado.escalacoes[0], ["A1", "A2", "A7", "A4", "A5", "A6"]);
});

test("escalar troca de posição quem já estava na quadra e salva no aparelho", () => {
  const estado = preparar();
  escalar(estado, 0, 0, "A1");
  escalar(estado, 0, 1, "A2");
  escalar(estado, 0, 1, "A1");
  assert.deepEqual(estado.escalacoes[0].slice(0, 2), ["A2", "A1"]);
  assert.throws(() => iniciarPartida(estado, 0), /Escale os 6/);
  const dados = {};
  const storage = { getItem: (c) => dados[c] ?? null, setItem: (c, v) => { dados[c] = v; } };
  salvarAmistoso(storage, estado);
  assert.deepEqual(carregarAmistoso(storage), estado);
  assert.deepEqual(carregarAmistoso({ getItem: () => "{quebrado" }), estadoAmistosoVazio());
});
