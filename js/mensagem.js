// Mensagens de WhatsApp: Lista Master (exportar/importar), lista do grupo e times.

import { NIVEIS } from "./sorteio.js";

const TITULO_MASTER = "*Lista Master - Vôlei Djalmer*";
const SEM_POTE = "Sem pote";
const CASAIS = "Casais";

/*
 * Formato da Lista Master. O número é o ranking geral (posição na lista),
 * por isso os números pulam dentro de cada pote:
 *
 *   *Lista Master - Vôlei Djalmer*
 *
 *   *C1*
 *   1. João (M) +M1 [Joãozinho, JP]
 *   4. Ana (F)
 *
 *   *Casais*
 *   João & Ana
 *
 * (M)/(F) = sexo, +X = potes adicionais, [..] = outros nomes do atleta.
 */
export function gerarMensagemMaster(atletas, casais = []) {
  const linha = (atleta, indice) => {
    const partes = [`${indice + 1}. ${atleta.nome}`];
    if (atleta.sexo) partes.push(`(${atleta.sexo})`);
    atleta.potesAdicionais.forEach((pote) => partes.push(`+${pote}`));
    if (atleta.aliases.length) partes.push(`[${atleta.aliases.join(", ")}]`);
    return partes.join(" ");
  };
  const secoes = [...NIVEIS, ""].map((pote) => {
    const linhas = atletas.map((atleta, indice) => (atleta.pote === pote ? linha(atleta, indice) : null)).filter(Boolean);
    return linhas.length ? [`*${pote || SEM_POTE}*`, ...linhas].join("\n") : null;
  }).filter(Boolean);
  if (casais.length) secoes.push([`*${CASAIS}*`, ...casais.map((casal) => `${casal.a} & ${casal.b}`)].join("\n"));
  return [TITULO_MASTER, ...secoes].join("\n\n");
}

const limparCabecalho = (texto) => texto.replace(/^\*+|\*+$/g, "").trim();

function lerLinhaAtleta(resto) {
  let texto = resto.trim();
  let aliases = [];
  texto = texto.replace(/\s*\[([^\]]*)\]\s*$/, (_, lista) => {
    aliases = lista.split(",").map((nome) => nome.trim()).filter(Boolean);
    return "";
  });
  const potesAdicionais = [];
  let encontrado;
  while ((encontrado = texto.match(/\s+\+([A-Za-z0-9]+)$/))) {
    potesAdicionais.unshift(encontrado[1].toUpperCase());
    texto = texto.slice(0, encontrado.index);
  }
  let sexo = "";
  texto = texto.replace(/\s*\(([MF])\)$/i, (_, letra) => { sexo = letra.toUpperCase(); return ""; });
  return { nome: texto.trim(), sexo, potesAdicionais, aliases };
}

/** Lê a mensagem da Lista Master. Lança erro com a linha problemática. */
export function lerMensagemMaster(texto) {
  const atletas = [];
  const casais = [];
  let secao = null;
  String(texto || "").split(/\r?\n/).forEach((bruta, numeroLinha) => {
    const linha = bruta.trim();
    if (!linha) return;
    const numerada = linha.match(/^(\d+)[.)]\s+(.+)$/);
    if (!numerada) {
      const cabecalho = limparCabecalho(linha);
      if (NIVEIS.includes(cabecalho.toUpperCase())) secao = { tipo: "pote", pote: cabecalho.toUpperCase() };
      else if (cabecalho.toLowerCase() === SEM_POTE.toLowerCase()) secao = { tipo: "pote", pote: "" };
      else if (cabecalho.toLowerCase() === CASAIS.toLowerCase()) secao = { tipo: "casais" };
      else if (secao?.tipo === "casais" && linha.includes("&")) {
        const [a, b] = linha.split("&").map((nome) => nome.trim());
        if (a && b) casais.push({ a, b });
      }
      return;
    }
    if (secao?.tipo !== "pote") return;
    const atleta = lerLinhaAtleta(numerada[2]);
    const invalidos = atleta.potesAdicionais.filter((pote) => !NIVEIS.includes(pote));
    if (!atleta.nome) throw new Error(`Linha ${numeroLinha + 1} sem nome: "${linha}".`);
    if (invalidos.length) throw new Error(`Linha ${numeroLinha + 1}: pote desconhecido ${invalidos.map((p) => `+${p}`).join(", ")}.`);
    atletas.push({
      ...atleta,
      pote: secao.pote,
      potesAdicionais: atleta.potesAdicionais.filter((pote) => pote !== secao.pote),
      ordem: Number(numerada[1]),
      aparicao: atletas.length,
    });
  });
  if (!atletas.length) throw new Error("Nenhum atleta encontrado. Cole a mensagem inteira gerada por \"Exportar lista\".");
  atletas.sort((a, b) => a.ordem - b.ordem || a.aparicao - b.aparicao);
  return { atletas: atletas.map(({ ordem, aparicao, ...atleta }) => atleta), casais };
}

/**
 * Lê a lista de confirmados do grupo: linhas numeradas a partir do "1.",
 * até "Espera Grupo" ou "Convidados". Considera os primeiros 24 nomes.
 */
export function extrairListaGrupo(texto, limite = 24) {
  const nomes = [];
  let naLista = false;
  for (const bruta of String(texto || "").split(/\r?\n/)) {
    const linha = bruta.trim();
    if (/^1\./.test(linha)) naLista = true;
    if (/^\*?(Espera Grupo|Convidados)/i.test(linha)) break;
    if (!naLista) continue;
    const encontrado = linha.match(/^\d+\.\s*(.+)$/);
    if (!encontrado) continue;
    const nome = encontrado[1].replace(/\s*[✅☑✔][︎️]?\s*$/u, "").trim();
    if (nome && !nome.startsWith("(")) nomes.push(nome);
  }
  return nomes.slice(0, limite);
}

export function gerarMensagemTimes(times) {
  const secoes = times.map((time) => [
    `*${time.nome}*`,
    ...time.jogadores.map((jogador, indice) => `${indice + 1}. ${jogador.nome}`),
  ].join("\n"));
  return ["*Times - Vôlei Djalmer*", ...secoes].join("\n\n");
}
