// Amistoso: times colados, presença, partidas com saque e rotação, fila de desafiantes.
// Independente das outras abas: guarda tudo na própria chave do localStorage.

import { normalizarNome } from "./nomes.js";

export const CHAVE_AMISTOSO = "djalmer.amistoso.v1";
export const OPCOES = { times: [2, 3, 4], maxAtletas: [6, 7, 8, 9, 10], pontos: [12, 15, 21, 25] };
export const EM_QUADRA = 6;
const FASES_DE_JOGO = ["escalacao", "jogo", "fim"];

export function estadoAmistosoVazio(config = { times: 2, maxAtletas: 6, pontos: 15 }) {
  return {
    fase: "config",
    config: { ...config },
    times: [],
    presentes: [],
    ordem: [],
    fila: [],
    retorno: null,
    sequencia: { time: null, vitorias: 0 },
    escalacoes: [],
    proxima: null,
    atual: null,
    partidas: [],
  };
}

export function carregarAmistoso(storage) {
  try {
    const salvo = JSON.parse(storage.getItem(CHAVE_AMISTOSO));
    if (salvo && typeof salvo === "object") return { ...estadoAmistosoVazio(), ...salvo };
  } catch {
    // Estado corrompido: começa de novo.
  }
  return estadoAmistosoVazio();
}

export function salvarAmistoso(storage, estado) {
  storage.setItem(CHAVE_AMISTOSO, JSON.stringify(estado));
}

const copia = (valor) => JSON.parse(JSON.stringify(valor));
const jogando = (estado) => [...(estado.atual?.times || []), ...(estado.proxima?.times || [])];

// ---- Formulário ---------------------------------------------------------

export function configurarAmistoso(estado, campo, valor) {
  const numero = Number(valor);
  if (!OPCOES[campo]?.includes(numero)) throw new Error("Opção inválida.");
  estado.config[campo] = numero;
}

/** Usa os times lidos da mensagem. O formulário passa a seguir a mensagem. */
export function aplicarTimesAmistoso(estado, timesLidos) {
  const n = timesLidos.length;
  if (n < 2 || n > 4) throw new Error(`A mensagem tem ${n === 1 ? "1 time" : `${n} times`}. O Amistoso aceita de 2 a 4.`);
  const vistos = new Map();
  timesLidos.forEach((time) => {
    const total = time.jogadores.length;
    if (total < EM_QUADRA || total > 10) throw new Error(`${time.nome} tem ${total} atletas. Cada time precisa ter de 6 a 10.`);
    time.jogadores.forEach((nome) => {
      const chave = normalizarNome(nome);
      if (vistos.has(chave)) throw new Error(`${nome} aparece em ${vistos.get(chave)} e em ${time.nome}.`);
      vistos.set(chave, time.nome);
    });
  });
  const config = { ...estado.config, times: n, maxAtletas: Math.max(...timesLidos.map((t) => t.jogadores.length)) };
  const ajustado = config.times !== estado.config.times || config.maxAtletas !== estado.config.maxAtletas;
  Object.assign(estado, estadoAmistosoVazio(config));
  estado.times = timesLidos.map((time) => ({ nome: time.nome, jogadores: [...time.jogadores] }));
  estado.presentes = estado.times.map(() => []);
  estado.escalacoes = estado.times.map(() => null);
  return { times: n, ajustado };
}

export function comecarAmistosos(estado) {
  if (!estado.times.length) throw new Error("Cole a mensagem dos times primeiro.");
  estado.fase = "presenca";
}

// ---- Presença -----------------------------------------------------------

export const confirmado = (estado, time) => estado.presentes[time].length >= EM_QUADRA;

export function alternarPresencaAmistoso(estado, time, nome) {
  const presentes = estado.presentes[time];
  const indice = presentes.indexOf(nome);
  if (indice >= 0) {
    const lado = estado.atual?.times.indexOf(time) ?? -1;
    if (lado >= 0 && estado.atual.quadras[lado].includes(nome)) throw new Error(`${nome} está em quadra. Substitua antes de desmarcar.`);
    presentes.splice(indice, 1);
    estado.escalacoes[time] = estado.escalacoes[time]?.map((n) => (n === nome ? null : n)) ?? null;
  } else {
    if (!estado.times[time].jogadores.includes(nome)) throw new Error(`${nome} não está no ${estado.times[time].nome}.`);
    presentes.push(nome);
  }
  const naOrdem = estado.ordem.includes(time);
  if (confirmado(estado, time) && !naOrdem) {
    estado.ordem.push(time);
    // Time que confirma depois do início entra no fim da fila.
    if (FASES_DE_JOGO.includes(estado.fase) && !jogando(estado).includes(time) && estado.retorno !== time) estado.fila.push(time);
  }
  if (!confirmado(estado, time) && naOrdem && !jogando(estado).includes(time)) {
    estado.ordem = estado.ordem.filter((t) => t !== time);
    estado.fila = estado.fila.filter((t) => t !== time);
    if (estado.retorno === time) estado.retorno = null;
  }
}

export function comecarConfrontos(estado) {
  if (estado.ordem.length < 2) throw new Error("Confirme pelo menos 2 times (6 presentes em cada).");
  estado.proxima = { times: [estado.ordem[0], estado.ordem[1]], escolha: false };
  estado.fila = estado.ordem.slice(2);
  estado.fase = "escalacao";
}

// ---- Escalação ----------------------------------------------------------

/** Coloca um atleta numa posição (0..5 = posições 1..6). Se ele já estava em outra, troca. */
export function escalar(estado, time, posicao, nome) {
  if (nome && !estado.presentes[time].includes(nome)) throw new Error(`${nome} não está marcado como presente.`);
  const quadra = estado.escalacoes[time] ? [...estado.escalacoes[time]] : Array(EM_QUADRA).fill(null);
  const antes = nome ? quadra.indexOf(nome) : -1;
  if (antes >= 0) quadra[antes] = quadra[posicao];
  quadra[posicao] = nome || null;
  estado.escalacoes[time] = quadra;
}

/** Times que podem enfrentar o vencedor, com o sugerido primeiro. */
export function opcoesAdversario(estado) {
  if (!estado.proxima?.escolha) return [];
  return [estado.retorno, ...estado.fila].filter((t) => t !== null && t !== estado.proxima.times[0]);
}

export function trocarAdversario(estado, time) {
  if (!opcoesAdversario(estado).includes(time)) throw new Error("Esse time não pode entrar agora.");
  estado.proxima.times[1] = time;
}

export function iniciarPartida(estado, saque) {
  if (estado.fase !== "escalacao") throw new Error("Nenhuma partida para começar.");
  if (saque !== 0 && saque !== 1) throw new Error("Escolha quem começa sacando.");
  const times = [...estado.proxima.times];
  const quadras = times.map((time) => {
    const quadra = estado.escalacoes[time];
    const nome = estado.times[time].nome;
    if (!quadra || quadra.some((n) => !n)) throw new Error(`Escale os 6 atletas do ${nome}.`);
    const ausente = quadra.find((n) => !estado.presentes[time].includes(n));
    if (ausente) throw new Error(`${ausente} não está marcado como presente.`);
    return [...quadra];
  });
  estado.fila = estado.fila.filter((t) => !times.includes(t));
  if (times.includes(estado.retorno)) estado.retorno = null;
  estado.atual = { times, quadras, placar: [0, 0], saque, desfazer: [] };
  estado.proxima = null;
  estado.fase = "jogo";
}

// ---- Partida ------------------------------------------------------------

/** Alvo da partida e vencedor. Em (pontos-1) x (pontos-1), vence quem fizer 3 pontos primeiro. */
export function situacao(estado) {
  const { placar } = estado.atual;
  const pontos = estado.config.pontos;
  const desempate = Math.min(...placar) >= pontos - 1;
  const alvo = desempate ? pontos + 2 : pontos;
  const vencedor = placar.findIndex((p) => p >= alvo);
  return { alvo, desempate, vencedor: vencedor >= 0 ? vencedor : null };
}

export const sacador = (estado) => estado.atual.quadras[estado.atual.saque][0];

/** Rotação no sentido horário: quem estava na posição 2 vai para a 1 e saca. */
export const rodar = (quadra) => quadra.map((_, i) => quadra[(i + 1) % quadra.length]);

export function marcarPonto(estado, lado) {
  const atual = estado.atual;
  if (estado.fase !== "jogo") throw new Error("A partida já terminou.");
  atual.desfazer.push(copia({ quadras: atual.quadras, placar: atual.placar, saque: atual.saque }));
  atual.placar[lado] += 1;
  if (atual.saque !== lado) {
    atual.saque = lado;
    atual.quadras[lado] = rodar(atual.quadras[lado]);
  }
  if (situacao(estado).vencedor !== null) estado.fase = "fim";
}

export function desfazerPonto(estado) {
  const anterior = estado.atual?.desfazer.pop();
  if (!anterior) throw new Error("Nenhum ponto para desfazer.");
  Object.assign(estado.atual, anterior);
  estado.fase = "jogo";
}

export function substituir(estado, lado, posicao, nome) {
  const atual = estado.atual;
  const time = atual.times[lado];
  if (!estado.presentes[time].includes(nome)) throw new Error(`${nome} não está marcado como presente.`);
  if (atual.quadras[lado].includes(nome)) throw new Error(`${nome} já está em quadra.`);
  const saindo = atual.quadras[lado][posicao];
  atual.quadras[lado][posicao] = nome;
  // A próxima escalação do time já vem com a troca.
  const escalacao = estado.escalacoes[time];
  if (escalacao) estado.escalacoes[time] = escalacao.map((n) => (n === saindo ? nome : n));
  return saindo;
}

/**
 * Fecha a partida. Perdedor vai para o fim da fila. Quem vence 2 seguidas
 * (com pelo menos 3 times) fica fora 1 partida e volta contra o vencedor dela.
 */
export function encerrarPartida(estado) {
  const { vencedor: lado } = situacao(estado);
  if (estado.fase !== "fim" || lado === null) throw new Error("A partida ainda não terminou.");
  const { times, placar } = estado.atual;
  const vencedor = times[lado];
  const perdedor = times[1 - lado];
  estado.partidas.push({ numero: estado.partidas.length + 1, times: [...times], placar: [...placar], vencedor });
  estado.fila = [...estado.fila.filter((t) => !times.includes(t)), perdedor];
  const vitorias = estado.sequencia.time === vencedor ? estado.sequencia.vitorias + 1 : 1;
  if (vitorias >= 2 && estado.fila.length >= 2) {
    estado.retorno = vencedor;
    estado.sequencia = { time: null, vitorias: 0 };
    estado.proxima = { times: [estado.fila[0], estado.fila[1]], escolha: false };
  } else {
    estado.sequencia = { time: vencedor, vitorias };
    estado.proxima = { times: [vencedor, estado.retorno ?? estado.fila[0]], escolha: true };
  }
  estado.atual = null;
  estado.fase = "escalacao";
  return { vencedor, perdedor, descanso: estado.retorno === vencedor };
}

export function encerrarAmistosos(estado) {
  Object.assign(estado, estadoAmistosoVazio(estado.config));
}
