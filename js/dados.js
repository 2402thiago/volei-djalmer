// Estado do app, persistência no navegador e operações sobre os dados.
//
// estado = {
//   atletas: [{ id, nome, sexo, pote, potesAdicionais, aliases }]  // ordem = ranking
//   casais: { ativado, lista: [{ a, b, ativo }] }                  // a/b = nomes
//   presenca: { ids: [idAtleta], pendentes: [nome] }               // pendentes = nomes não encontrados
//   times, timesAnterior                                           // resultado do sorteio
// }

import { normalizarNome, novoId } from "./nomes.js";
import { NIVEIS } from "./sorteio.js";

export const CHAVE = "djalmer.v2";
export const CHAVE_BACKUP = "djalmer.backup.v1";

export const estadoVazio = () => ({
  atletas: [],
  casais: { ativado: false, lista: [] },
  presenca: { ids: [], pendentes: [] },
  times: null,
  timesAnterior: null,
});

const lerJson = (storage, chave) => {
  try { return JSON.parse(storage.getItem(chave) || "null"); } catch { return null; }
};

const limparAtleta = (atleta) => ({
  id: atleta.id || novoId(),
  nome: String(atleta.nome).trim(),
  sexo: atleta.sexo === "M" || atleta.sexo === "F" ? atleta.sexo : "",
  pote: NIVEIS.includes(atleta.pote) ? atleta.pote : "",
  potesAdicionais: (Array.isArray(atleta.potesAdicionais) ? atleta.potesAdicionais : [])
    .filter((pote) => NIVEIS.includes(pote) && pote !== atleta.pote),
  aliases: Array.isArray(atleta.aliases) ? atleta.aliases.filter(Boolean) : [],
});

export function carregar(storage) {
  const salvo = lerJson(storage, CHAVE);
  if (salvo) return { ...estadoVazio(), ...salvo };
  const migrado = migrarLegado(storage);
  salvar(storage, migrado);
  return migrado;
}

export function salvar(storage, estado) {
  storage.setItem(CHAVE, JSON.stringify(estado));
}

// Casais que existiam fixos no app anterior quando nada havia sido configurado.
const CASAIS_LEGADO = [
  ["Thiago Ramalho", "Maria Clara Batista"],
  ["Douglas Nascimento", "Pattricia"],
  ["João Alberto", "Thais Moreno"],
  ["Erivan Junior", "Livia Cristhina"],
];

/** Converte os dados do app anterior (chaves volei.*) e guarda cópia intacta. */
export function migrarLegado(storage) {
  const estado = estadoVazio();
  const chaves = [];
  for (let i = 0; i < storage.length; i++) {
    const chave = storage.key(i);
    if (chave?.startsWith("volei.")) chaves.push(chave);
  }
  if (!chaves.length) return estado;
  storage.setItem(CHAVE_BACKUP, JSON.stringify(Object.fromEntries(chaves.map((chave) => [chave, storage.getItem(chave)]))));

  const cadastro = lerJson(storage, "volei.cadastro.atletas.v1");
  const participantes = lerJson(storage, "volei.participantes.v1");
  if (Array.isArray(cadastro) && cadastro.length) {
    estado.atletas = cadastro.filter((a) => a?.nome).map(limparAtleta);
  } else if (Array.isArray(participantes)) {
    // Versão ainda mais antiga: o nível ficava no participante.
    const forca = { C1: 7, M1: 6, M2: 5, F1: 4, F2: 3, LM1: 2, LF1: 1 };
    estado.atletas = participantes.filter((p) => p?.nome && NIVEIS.includes(p.nivel))
      .sort((a, b) => forca[b.nivel] - forca[a.nivel] || (a.ranking || 0) - (b.ranking || 0))
      .map((p) => limparAtleta({ id: p.id, nome: p.nome, sexo: p.sexo, pote: p.nivel }));
  }

  if (Array.isArray(participantes)) {
    participantes.filter((p) => p?.status === "ativo").forEach((p) => {
      const atleta = estado.atletas.find((a) => a.id === p.cadastro_id || a.id === p.id) || encontrarAtleta(estado.atletas, p.nome);
      if (atleta) { if (!estado.presenca.ids.includes(atleta.id)) estado.presenca.ids.push(atleta.id); }
      else if (p.nome) estado.presenca.pendentes.push(p.nome);
    });
  }

  let pares = lerJson(storage, "volei.casais.config.v1");
  if (!Array.isArray(pares) || pares.some((par) => !Array.isArray(par) || par.length !== 2)) pares = CASAIS_LEGADO;
  let ativos = lerJson(storage, "volei.casais.ativos.v1");
  if (!Array.isArray(ativos) || ativos.length !== pares.length) ativos = pares.map(() => true);
  estado.casais = {
    ativado: storage.getItem("volei.casais.v1") === "true",
    lista: pares.map(([a, b], indice) => ({ a, b, ativo: ativos[indice] !== false })),
  };
  return estado;
}

export function encontrarAtleta(atletas, nome) {
  const chave = normalizarNome(nome);
  if (!chave) return null;
  return atletas.find((a) => normalizarNome(a.nome) === chave || a.aliases.some((alias) => normalizarNome(alias) === chave)) || null;
}

export function adicionarAtleta(estado, dados) {
  const nome = String(dados.nome || "").trim();
  if (!nome) throw new Error("Digite o nome do atleta.");
  if (encontrarAtleta(estado.atletas, nome)) throw new Error(`"${nome}" já está na Lista Master.`);
  const atleta = limparAtleta({ ...dados, nome, id: novoId() });
  estado.atletas.push(atleta);
  return atleta;
}

export function atualizarAtleta(estado, id, alteracoes) {
  const atleta = estado.atletas.find((a) => a.id === id);
  if (!atleta) return;
  if (alteracoes.nome !== undefined) {
    const nome = alteracoes.nome.trim();
    if (!nome) throw new Error("O nome não pode ficar vazio.");
    const outro = encontrarAtleta(estado.atletas, nome);
    if (outro && outro.id !== id) throw new Error(`"${nome}" já pertence a ${outro.nome}.`);
    renomearNosCasais(estado, atleta.nome, nome);
  }
  Object.assign(atleta, limparAtleta({ ...atleta, ...alteracoes }));
}

function renomearNosCasais(estado, antigo, novo) {
  const chave = normalizarNome(antigo);
  estado.casais.lista.forEach((casal) => {
    if (normalizarNome(casal.a) === chave) casal.a = novo;
    if (normalizarNome(casal.b) === chave) casal.b = novo;
  });
}

export function adicionarAlias(estado, id, alias) {
  const nome = String(alias || "").trim();
  const atleta = estado.atletas.find((a) => a.id === id);
  if (!nome || !atleta) return;
  const dono = encontrarAtleta(estado.atletas, nome);
  if (dono && dono.id !== id) throw new Error(`"${nome}" já pertence a ${dono.nome}.`);
  if (!dono) atleta.aliases.push(nome);
}

export function removerAtleta(estado, id) {
  const atleta = estado.atletas.find((a) => a.id === id);
  if (!atleta) return;
  estado.atletas = estado.atletas.filter((a) => a.id !== id);
  estado.presenca.ids = estado.presenca.ids.filter((item) => item !== id);
}

/** Move o atleta para a posição do alvo (ranking). */
export function moverAtleta(estado, id, idAlvo) {
  const de = estado.atletas.findIndex((a) => a.id === id);
  const para = estado.atletas.findIndex((a) => a.id === idAlvo);
  if (de < 0 || para < 0 || de === para) return;
  const [atleta] = estado.atletas.splice(de, 1);
  estado.atletas.splice(para, 0, atleta);
}

/** Compara a lista atual com a lida da mensagem, sem alterar nada. */
export function previaImportacao(estado, lido) {
  const novos = lido.atletas.filter((a) => !encontrarAtleta(estado.atletas, a.nome)).map((a) => a.nome);
  const removidos = estado.atletas.filter((a) => !encontrarAtleta(lido.atletas.map(limparAtleta), a.nome)).map((a) => a.nome);
  const repetidos = lido.atletas.filter((a, i) => lido.atletas.findIndex((b) => normalizarNome(b.nome) === normalizarNome(a.nome)) !== i).map((a) => a.nome);
  return { total: lido.atletas.length, novos, removidos, repetidos, casais: lido.casais.length };
}

/** Substitui a Lista Master pela da mensagem, mantendo ids de quem continua. */
export function aplicarImportacao(estado, lido) {
  const { repetidos } = previaImportacao(estado, lido);
  if (repetidos.length) throw new Error(`Nomes repetidos na mensagem: ${[...new Set(repetidos)].join(", ")}.`);
  estado.atletas = lido.atletas.map((a) => limparAtleta({ ...a, id: encontrarAtleta(estado.atletas, a.nome)?.id || novoId() }));
  const anteriores = estado.casais.lista;
  const mesmoPar = (x, y) => [x.a, x.b].map(normalizarNome).sort().join("|") === [y.a, y.b].map(normalizarNome).sort().join("|");
  estado.casais.lista = lido.casais.map((casal) => ({ ...casal, ativo: anteriores.find((c) => mesmoPar(c, casal))?.ativo ?? true }));
  const ids = new Set(estado.atletas.map((a) => a.id));
  estado.presenca.ids = estado.presenca.ids.filter((id) => ids.has(id));
}

/** Marca a presença a partir dos nomes da lista do grupo (substitui a anterior). */
export function aplicarListaGrupo(estado, nomes) {
  const ids = [];
  const pendentes = [];
  nomes.forEach((nome) => {
    const atleta = encontrarAtleta(estado.atletas, nome);
    if (!atleta) pendentes.push(nome);
    else if (!ids.includes(atleta.id)) ids.push(atleta.id);
  });
  estado.presenca = { ids, pendentes };
  return { marcados: ids.length, pendentes };
}

export function alternarPresenca(estado, id) {
  const ids = estado.presenca.ids;
  estado.presenca.ids = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/** Resolve um nome pendente: vincula a um atleta (vira apelido) ou cadastra novo. */
export function resolverPendente(estado, nome, idAtleta) {
  const atleta = idAtleta
    ? estado.atletas.find((a) => a.id === idAtleta)
    : adicionarAtleta(estado, { nome });
  if (!atleta) return null;
  if (idAtleta) adicionarAlias(estado, idAtleta, nome);
  estado.presenca.pendentes = estado.presenca.pendentes.filter((item) => item !== nome);
  if (!estado.presenca.ids.includes(atleta.id)) estado.presenca.ids.push(atleta.id);
  return atleta;
}

/** Presentes com o ranking geral, prontos para o sorteio. */
export function presentesParaSorteio(estado) {
  return estado.atletas
    .map((atleta, indice) => ({ ...atleta, ranking: indice + 1 }))
    .filter((atleta) => estado.presenca.ids.includes(atleta.id));
}

export function casaisParaSorteio(estado) {
  if (!estado.casais.ativado) return [];
  // Converte apelidos para o nome da Lista Master, que é o usado no sorteio.
  const nomeOficial = (nome) => encontrarAtleta(estado.atletas, nome)?.nome || nome;
  return estado.casais.lista.filter((c) => c.ativo).map((c) => [nomeOficial(c.a), nomeOficial(c.b)]);
}
