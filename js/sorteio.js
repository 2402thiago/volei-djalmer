// Sorteio de times: 4 times de 6 a partir de exatamente 24 presentes.
// Regras portadas do sistema anterior sem alteração:
// - 6 potes de 4 atletas: C1, Levantadores (LM1/LF1), M1, F1 e o bloco M2/F2 (8).
// - Pote principal + potes adicionais definem onde o atleta pode entrar.
// - Núcleo de cada time: 1 C1 + 1 Levantador, pareando opostos do ranking.
// - M1, F1, M2 e F2 são sorteados equilibrando as mulheres entre os times.
// - Casais ativos ficam sempre no mesmo time.

import { normalizarNome } from "./nomes.js";

export const NIVEIS = ["C1", "LM1", "LF1", "M1", "M2", "F1", "F2"];
// Ordem de exibição da Lista Master.
export const POTES_ORDEM = ["C1", "M1", "M2", "LM1", "F1", "F2", "LF1"];
export const TOTAL_ATLETAS = 24;
const TIMES = [0, 1, 2, 3];

function embaralhar(itens, rng) {
  const lista = [...itens];
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

const rank = (p) => p.ranking || 999;

function categoriaNucleo(p) {
  const pote = p.pote_sorteio || p.nivel;
  return pote === "levantadores" || pote === "LM1" || pote === "LF1" ? "Levantadores" : pote;
}

// Lista os motivos que impedem o sorteio. Vazio = pode sortear.
export function problemasParaSortear(atletas) {
  const problemas = [];
  if (atletas.length !== TOTAL_ATLETAS) {
    const diferenca = TOTAL_ATLETAS - atletas.length;
    problemas.push(diferenca > 0
      ? `${diferenca === 1 ? "Falta 1 presente" : `Faltam ${diferenca} presentes`} para fechar ${TOTAL_ATLETAS}.`
      : `${diferenca === -1 ? "Sobra 1 presente" : `Sobram ${-diferenca} presentes`}. Desmarque ${-diferenca === 1 ? "alguém" : `${-diferenca} pessoas`} para ficar com ${TOTAL_ATLETAS}.`);
  }
  atletas.filter((a) => !a.pote).forEach((a) => problemas.push(`${a.nome} está sem pote principal.`));
  atletas.filter((a) => !a.sexo).forEach((a) => problemas.push(`${a.nome} está sem sexo definido.`));
  return problemas;
}

function selecionarTop4PorNivel(ativos) {
  const grupos = { C1: [], Levantadores: [], M1: [], F1: [], M2: [], F2: [] };
  const limites = { C1: 4, Levantadores: 4, M1: 4, F1: 4, Base: 8 };
  const ordenados = [...ativos].sort((a, b) => rank(a) - rank(b));
  const permissoes = (p) => new Set([p.nivel, ...(p.potes_adicionais || [])].filter(Boolean));
  const tem = (p, nivel) => permissoes(p).has(nivel);
  const basePreferida = (p) => {
    const preferido = p.sexo === "M" ? "M2" : "F2";
    const outro = preferido === "M2" ? "F2" : "M2";
    if (tem(p, preferido)) return preferido;
    if (tem(p, outro)) return outro;
    return preferido;
  };
  const opcoes = (p) => {
    const resultado = [];
    if (tem(p, "C1")) resultado.push("C1");
    if ((p.sexo === "M" && tem(p, "LM1")) || (p.sexo === "F" && tem(p, "LF1"))) resultado.push("Levantadores");
    if (tem(p, "M1") || (tem(p, "C1") && p.sexo === "M") || (tem(p, "LM1") && p.sexo === "M")) resultado.push("M1");
    if (tem(p, "F1") || (tem(p, "C1") && p.sexo === "F") || (tem(p, "LF1") && p.sexo === "F")) resultado.push("F1");
    if (NIVEIS.some((nivel) => tem(p, nivel))) resultado.push("Base");
    return [...new Set(resultado)];
  };
  const candidatos = ordenados.map((p) => ({ p, opcoes: opcoes(p) }));
  const semOpcao = candidatos.filter((item) => !item.opcoes.length);
  if (semOpcao.length) throw new Error(`Atletas sem pote válido na Lista Master: ${semOpcao.map((item) => item.p.nome).join(", ")}.`);
  const contagens = Object.fromEntries(Object.keys(limites).map((key) => [key, 0]));
  const alocacoes = new Map();
  const ehPrincipal = (item, categoria) => categoria === item.p.nivel ||
    (categoria === "Levantadores" && ["LM1", "LF1"].includes(item.p.nivel));
  const buscar = (indice) => {
    if (indice === candidatos.length) return Object.entries(limites).every(([key, limite]) => contagens[key] === limite);
    const restantes = candidatos.slice(indice);
    if (Object.entries(limites).some(([key, limite]) => contagens[key] > limite ||
      contagens[key] + restantes.filter((item) => item.opcoes.includes(key)).length < limite)) return false;
    const item = candidatos[indice];
    const escolhas = [...item.opcoes].sort((a, b) => (ehPrincipal(item, a) ? -1 : 0) - (ehPrincipal(item, b) ? -1 : 0));
    return escolhas.some((categoria) => {
      if (contagens[categoria] >= limites[categoria]) return false;
      contagens[categoria] += 1;
      alocacoes.set(item.p.id, categoria);
      if (buscar(indice + 1)) return true;
      contagens[categoria] -= 1;
      alocacoes.delete(item.p.id);
      return false;
    });
  };
  if (!buscar(0)) {
    throw new Error("Os presentes não fecham os potes: são necessários 4 C1, 4 levantadores, 4 M1, 4 F1 e 8 no bloco M2/F2. Revise os potes adicionais na Lista Master.");
  }
  candidatos.forEach(({ p }) => {
    const categoria = alocacoes.get(p.id);
    const pote = categoria === "Base" ? basePreferida(p) : categoria;
    grupos[categoria === "Base" ? pote : categoria].push(p);
    p.pote_sorteio = categoria === "Levantadores" ? "levantadores" : pote;
  });
  return grupos;
}

function posicionarCasais(top, times, casais, rng) {
  const selecionados = [...top.C1, ...top.Levantadores, ...top.M1, ...top.F1, ...top.M2, ...top.F2];
  const porNome = new Map(selecionados.map((p) => [normalizarNome(p.nome), p]));
  const usados = new Set();
  const unidades = [];
  const ausentes = [];
  casais.forEach(([nomeA, nomeB]) => {
    const primeiro = porNome.get(normalizarNome(nomeA));
    const segundo = porNome.get(normalizarNome(nomeB));
    if (!primeiro || !segundo) { ausentes.push(`${nomeA} e ${nomeB}`); return; }
    if (usados.has(primeiro.id) || usados.has(segundo.id)) return;
    unidades.push([primeiro, segundo]);
    usados.add(primeiro.id);
    usados.add(segundo.id);
  });
  for (const unidade of unidades) {
    const categorias = new Set(unidade.map(categoriaNucleo));
    // Casal do mesmo nível ocupa as duas vagas da categoria em um time.
    const valido = (t) => times[t].jogadores.length + unidade.length <= 4 &&
      [...categorias].every((c) => times[t].jogadores.every((j) => categoriaNucleo(j) !== c));
    const escolhido = embaralhar(TIMES, rng).find(valido);
    if (escolhido === undefined) {
      throw new Error("Não foi possível encaixar todos os casais nos times. Desative algum casal ou revise os potes.");
    }
    times[escolhido].jogadores.push(...unidade);
  }
  return { ausentes, usados };
}

function preencherNucleoC1Lev(top, times, usados, rng) {
  // Pareamento de opostos: 1º C1 + 4º Levantador, 2º + 3º, ...
  const c1 = top.C1.filter((p) => !usados.has(p.id)).sort((a, b) => rank(a) - rank(b));
  const lev = top.Levantadores.filter((p) => !usados.has(p.id)).sort((a, b) => rank(b) - rank(a));
  const nucleo = (t, categoria) => times[t].jogadores.find((j) => categoriaNucleo(j) === categoria);

  // Time com Levantador do casal recebe o C1 oposto (melhor Lev, pior C1).
  TIMES.filter((t) => !nucleo(t, "C1") && nucleo(t, "Levantadores"))
    .sort((x, y) => rank(nucleo(x, "Levantadores")) - rank(nucleo(y, "Levantadores")))
    .forEach((t) => {
      const escolhido = c1.pop();
      if (escolhido) times[t].jogadores.push(escolhido);
    });

  // Time com C1 do casal recebe o Levantador oposto (melhor C1, pior Lev).
  TIMES.filter((t) => nucleo(t, "C1") && !nucleo(t, "Levantadores"))
    .sort((x, y) => rank(nucleo(x, "C1")) - rank(nucleo(y, "C1")))
    .forEach((t) => {
      const escolhido = lev.shift();
      if (escolhido) times[t].jogadores.push(escolhido);
    });

  // Times sem C1 e sem Levantador: pares fixos de opostos, destino sorteado.
  embaralhar(TIMES.filter((t) => !nucleo(t, "C1") && !nucleo(t, "Levantadores")), rng)
    .forEach((t) => {
      if (!c1.length || !lev.length) return;
      times[t].jogadores.push(c1.shift(), lev.shift());
    });

  // Sobras (casal do mesmo nível de C1 ou Levantador): times com vaga.
  while (c1.length || lev.length) {
    const p = c1.length ? c1.pop() : lev.shift();
    const escolhido = embaralhar(TIMES.filter((t) => times[t].jogadores.length < 6), rng)
      .sort((a, b) => times[a].jogadores.length - times[b].jogadores.length)[0];
    if (escolhido === undefined) break;
    times[escolhido].jogadores.push(p);
  }
}

function distribuirRestantes(top, times, rng) {
  // M1, F1, M2 e F2: 1 de cada por time, mulheres equilibradas, por backtracking.
  const categorias = ["M1", "F1", "M2", "F2"];
  const pendentes = embaralhar(categorias.flatMap((c) => top[c].map((p) => ({ p, c }))), rng)
    .filter((item) => !times.some((t) => t.jogadores.includes(item.p)));
  const totalMulheres = pendentes.filter((i) => i.p.sexo === "F").length +
    times.reduce((s, t) => s + t.jogadores.filter((p) => p.sexo === "F").length, 0);
  const base = Math.floor(totalMulheres / 4);
  const resto = totalMulheres % 4;

  const tentar = (alvos, equilibrarMulheres, flexivel) => {
    let tentativas = 0;
    // M2 e F2 admitem 2 por time no modo flexível (casais do mesmo nível).
    const limite = (c) => flexivel && (c === "M2" || c === "F2") ? 2 : 1;
    const colocar = (indice) => {
      if (indice === pendentes.length) return true;
      if (++tentativas > 200000) return false;
      const item = pendentes[indice];
      const vaga = (t) => times[t].jogadores.length < 6 &&
        times[t].jogadores.filter((j) => top[item.c].includes(j)).length < limite(item.c);
      const mulheres = (t) => times[t].jogadores.filter((p) => p.sexo === "F").length + (item.p.sexo === "F" ? 1 : 0);
      let candidatos = TIMES.filter((t) => vaga(t) && (!equilibrarMulheres || mulheres(t) <= alvos[t]));
      if (!candidatos.length && equilibrarMulheres) candidatos = TIMES.filter(vaga);
      for (const t of embaralhar(candidatos, rng)) {
        times[t].jogadores.push(item.p);
        if (colocar(indice + 1)) return true;
        times[t].jogadores.pop();
      }
      return false;
    };
    return colocar(0);
  };

  const combinacoes = [];
  for (let mascara = 0; mascara < 16; mascara++) {
    const selecionados = TIMES.filter((t) => mascara & (1 << t));
    if (selecionados.length === resto) combinacoes.push(selecionados);
  }
  for (const flexivel of [false, true]) {
    for (const combo of embaralhar(combinacoes, rng)) {
      const alvos = Array(4).fill(base);
      combo.forEach((t) => { alvos[t] += 1; });
      if (tentar(alvos, true, flexivel)) return;
    }
  }
  if (!tentar(Array(4).fill(base + 1), false, false) && !tentar(Array(4).fill(base + 1), false, true)) {
    throw new Error("Não foi possível distribuir os atletas restantes nos times.");
  }
}

const diferencaMulheres = (times) => {
  const mulheres = times.map((t) => t.jogadores.filter((p) => p.sexo === "F").length);
  return Math.max(...mulheres) - Math.min(...mulheres);
};

/**
 * Sorteia 4 times.
 * @param atletas presentes: { id, nome, sexo, pote, potesAdicionais, ranking }
 * @param opcoes.casais pares de nomes [[a, b], ...] que devem ficar juntos
 * @param opcoes.rng gerador aleatório (para testes)
 * @returns { times: [{ nome, jogadores: [{ id, nome, sexo, pote, poteSorteio }] }], casaisAusentes }
 */
export function sortearTimes(atletas, { casais = [], rng = Math.random } = {}) {
  const problemas = problemasParaSortear(atletas);
  if (problemas.length) throw new Error(problemas.join("\n"));

  const ativos = atletas.map((a) => ({
    id: a.id, nome: a.nome, sexo: a.sexo, nivel: a.pote,
    potes_adicionais: a.potesAdicionais || [], ranking: a.ranking,
  }));
  const top = selecionarTop4PorNivel(ativos);

  // Tenta até 100 vezes: casais podem cair em posições inviáveis ou
  // desequilibrar as mulheres. Guarda a melhor tentativa como alternativa.
  let escolhido = null;
  let alternativa = null;
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < 100 && !escolhido; tentativa++) {
    const times = TIMES.map(() => ({ jogadores: [] }));
    try {
      const { ausentes, usados } = casais.length
        ? posicionarCasais(top, times, casais, rng)
        : { ausentes: [], usados: new Set() };
      preencherNucleoC1Lev(top, times, usados, rng);
      const viavel = ["M1", "F1", "M2", "F2"].every((c) => {
        const limite = (c === "M2" || c === "F2") ? 2 : 1;
        const restantes = top[c].filter((p) => !times.some((t) => t.jogadores.includes(p))).length;
        const vagas = times.reduce((s, t) =>
          s + Math.min(limite - t.jogadores.filter((j) => top[c].includes(j)).length, 6 - t.jogadores.length), 0);
        return restantes <= vagas;
      });
      if (!viavel) throw new Error("Os casais ocuparam todas as vagas de uma categoria. Desative algum casal.");
      distribuirRestantes(top, times, rng);
      const resultado = { times, ausentes };
      if (diferencaMulheres(times) <= 1) escolhido = resultado;
      else if (!alternativa || diferencaMulheres(times) < diferencaMulheres(alternativa.times)) alternativa = resultado;
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  escolhido ||= alternativa;
  if (!escolhido) throw ultimoErro || new Error("Não foi possível sortear os times. Desative algum casal ou revise os potes.");

  const times = escolhido.times.map((time, indice) => {
    if (time.jogadores.length !== 6) throw new Error(`Time incompleto: ${time.jogadores.length} de 6 jogadores.`);
    const jogadores = [...time.jogadores].sort((a, b) => rank(a) - rank(b)).map((p) => ({
      id: p.id, nome: p.nome, sexo: p.sexo, pote: p.nivel, poteSorteio: p.pote_sorteio,
    }));
    const c1 = jogadores.find((j) => j.poteSorteio === "C1");
    return { nome: c1 ? `Time ${c1.nome}` : `Time ${indice + 1}`, jogadores };
  });
  return { times, casaisAusentes: escolhido.ausentes };
}

export const nomePoteSorteio = (pote) => ({ levantadores: "LM1/LF1" }[pote] || pote);
