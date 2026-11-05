// Estado do app, persistência no navegador e operações sobre os dados.
//
// estado = {
//   atletas: [{ id, nome, sexo, pote, potesAdicionais, aliases }]  // agrupados por pote; ordem = ranking
//   casais: { ativado, lista: [{ a, b, ativo }] }                  // a/b = nomes
//   lista: { ids: [idAtleta], pendentes: [nome] }                  // confirmados do dia; pendentes = nomes não encontrados
//   times, timesAnterior                                           // [{ nome, jogadores: [{ id, nome, sexo, pote, poteSorteio }] }]
//   checkin: { ids: [idAtleta], ordem: [indiceTime] }              // chegada na quadra; ordem = times completos
// }

import { normalizarNome, novoId } from "./nomes.js";
import { NIVEIS, POTES_ORDEM } from "./sorteio.js";

export const CHAVE = "djalmer.v2";
export const CHAVE_BACKUP = "djalmer.backup.v1";

export const estadoVazio = () => ({
  atletas: [],
  casais: { ativado: false, lista: [] },
  lista: { ids: [], pendentes: [] },
  times: null,
  timesAnterior: null,
  checkin: { ids: [], ordem: [] },
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

// Casais fixos do app anterior. Não são mais padrão: a lista começa vazia.
const CASAIS_LEGADO = [
  ["Thiago Ramalho", "Maria Clara Batista"],
  ["Douglas Nascimento", "Pattricia"],
  ["João Alberto", "Thais Moreno"],
  ["Erivan Junior", "Livia Cristhina"],
];

const ehCasaisLegado = (lista) => lista.length === CASAIS_LEGADO.length &&
  lista.every((casal, i) => casal.a === CASAIS_LEGADO[i][0] && casal.b === CASAIS_LEGADO[i][1]);

const indicePote = (pote) => {
  const indice = POTES_ORDEM.indexOf(pote);
  return indice < 0 ? POTES_ORDEM.length : indice;
};

/** Agrupa a lista por pote (C1, M1, M2, LM1, F1, F2, LF1, sem pote), mantendo o ranking dentro de cada pote. */
export function ordenarPorPote(estado) {
  estado.atletas = estado.atletas
    .map((atleta, posicao) => ({ atleta, posicao }))
    .sort((x, y) => indicePote(x.atleta.pote) - indicePote(y.atleta.pote) || x.posicao - y.posicao)
    .map(({ atleta }) => atleta);
}

/** Ajusta dados salvos por versões anteriores deste app. */
function normalizar(salvo) {
  const estado = { ...estadoVazio(), ...salvo };
  if (salvo.presenca && !salvo.lista) estado.lista = salvo.presenca;
  delete estado.presenca;
  if (ehCasaisLegado(estado.casais.lista)) estado.casais = { ativado: false, lista: [] };
  estado.checkin = { ...estadoVazio().checkin, ...estado.checkin };
  ordenarPorPote(estado);
  return estado;
}

export function carregar(storage) {
  const salvo = lerJson(storage, CHAVE);
  const estado = salvo ? normalizar(salvo) : migrarLegado(storage);
  salvar(storage, estado);
  return estado;
}

export function salvar(storage, estado) {
  storage.setItem(CHAVE, JSON.stringify(estado));
}

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
    estado.atletas = participantes.filter((p) => p?.nome && NIVEIS.includes(p.nivel))
      .sort((a, b) => (a.ranking || 0) - (b.ranking || 0))
      .map((p) => limparAtleta({ id: p.id, nome: p.nome, sexo: p.sexo, pote: p.nivel }));
  }
  ordenarPorPote(estado);

  if (Array.isArray(participantes)) {
    participantes.filter((p) => p?.status === "ativo").forEach((p) => {
      const atleta = estado.atletas.find((a) => a.id === p.cadastro_id || a.id === p.id) || encontrarAtleta(estado.atletas, p.nome);
      if (atleta) { if (!estado.lista.ids.includes(atleta.id)) estado.lista.ids.push(atleta.id); }
      else if (p.nome) estado.lista.pendentes.push(p.nome);
    });
  }

  const pares = lerJson(storage, "volei.casais.config.v1");
  if (Array.isArray(pares) && pares.every((par) => Array.isArray(par) && par.length === 2)) {
    let ativos = lerJson(storage, "volei.casais.ativos.v1");
    if (!Array.isArray(ativos) || ativos.length !== pares.length) ativos = pares.map(() => true);
    const lista = pares.map(([a, b], indice) => ({ a, b, ativo: ativos[indice] !== false }));
    if (!ehCasaisLegado(lista)) estado.casais = { ativado: storage.getItem("volei.casais.v1") === "true", lista };
  }
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
  ordenarPorPote(estado);
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
  const poteAnterior = atleta.pote;
  Object.assign(atleta, limparAtleta({ ...atleta, ...alteracoes }));
  if (atleta.pote !== poteAnterior) {
    // Quem troca de pote entra no fim do novo grupo.
    estado.atletas = [...estado.atletas.filter((a) => a.id !== id), atleta];
    ordenarPorPote(estado);
  }
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
  estado.atletas = estado.atletas.filter((a) => a.id !== id);
  estado.lista.ids = estado.lista.ids.filter((item) => item !== id);
}

/** Move o atleta para a posição do alvo. Só dentro do mesmo pote. */
export function moverAtleta(estado, id, idAlvo) {
  const de = estado.atletas.findIndex((a) => a.id === id);
  const para = estado.atletas.findIndex((a) => a.id === idAlvo);
  if (de < 0 || para < 0 || de === para) return;
  if (estado.atletas[de].pote !== estado.atletas[para].pote) return;
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
  ordenarPorPote(estado);
  const anteriores = estado.casais.lista;
  const mesmoPar = (x, y) => [x.a, x.b].map(normalizarNome).sort().join("|") === [y.a, y.b].map(normalizarNome).sort().join("|");
  estado.casais.lista = lido.casais.map((casal) => ({ ...casal, ativo: anteriores.find((c) => mesmoPar(c, casal))?.ativo ?? true }));
  const ids = new Set(estado.atletas.map((a) => a.id));
  estado.lista.ids = estado.lista.ids.filter((id) => ids.has(id));
}

/** Define os confirmados a partir dos nomes da lista do grupo (substitui a anterior). */
export function aplicarListaGrupo(estado, nomes) {
  const ids = [];
  const pendentes = [];
  nomes.forEach((nome) => {
    const atleta = encontrarAtleta(estado.atletas, nome);
    if (!atleta) pendentes.push(nome);
    else if (!ids.includes(atleta.id)) ids.push(atleta.id);
  });
  estado.lista = { ids, pendentes };
  return { marcados: ids.length, pendentes };
}

/** Resolve um nome pendente: vincula a um atleta (vira apelido) ou cadastra novo. */
export function resolverPendente(estado, nome, idAtleta) {
  const atleta = idAtleta
    ? estado.atletas.find((a) => a.id === idAtleta)
    : adicionarAtleta(estado, { nome });
  if (!atleta) return null;
  if (idAtleta) adicionarAlias(estado, idAtleta, nome);
  estado.lista.pendentes = estado.lista.pendentes.filter((item) => item !== nome);
  if (!estado.lista.ids.includes(atleta.id)) estado.lista.ids.push(atleta.id);
  // Times colados com esse nome passam a apontar para o atleta.
  (estado.times || []).forEach((time) => time.jogadores.forEach((jogador) => {
    if (!jogador.id && normalizarNome(jogador.nome) === normalizarNome(nome)) {
      Object.assign(jogador, { id: atleta.id, nome: atleta.nome, sexo: atleta.sexo, pote: atleta.pote, poteSorteio: atleta.pote });
    }
  }));
  return atleta;
}

/** Confirmados com o ranking geral, prontos para o sorteio. */
export function confirmadosParaSorteio(estado) {
  return estado.atletas
    .map((atleta, indice) => ({ ...atleta, ranking: indice + 1 }))
    .filter((atleta) => estado.lista.ids.includes(atleta.id));
}

export function casaisParaSorteio(estado) {
  if (!estado.casais.ativado) return [];
  // Converte apelidos para o nome da Lista Master, que é o usado no sorteio.
  const nomeOficial = (nome) => encontrarAtleta(estado.atletas, nome)?.nome || nome;
  return estado.casais.lista.filter((c) => c.ativo).map((c) => [nomeOficial(c.a), nomeOficial(c.b)]);
}

/** Troca os times atuais (o anterior fica para Desfazer) e zera a chegada na quadra. */
export function definirTimes(estado, times) {
  estado.timesAnterior = estado.times;
  estado.times = times;
  zerarCheckin(estado);
}

export function desfazerTimes(estado) {
  estado.times = estado.timesAnterior;
  estado.timesAnterior = null;
  zerarCheckin(estado);
}

/** Times lidos da mensagem: liga nomes à Lista Master e define os confirmados. */
export function aplicarTimesColados(estado, timesLidos) {
  const pendentes = [];
  const ids = [];
  const times = timesLidos.map((time) => ({
    nome: time.nome,
    jogadores: time.jogadores.map((nome) => {
      const atleta = encontrarAtleta(estado.atletas, nome);
      if (!atleta) {
        if (!pendentes.includes(nome)) pendentes.push(nome);
        return { id: null, nome, sexo: "", pote: "", poteSorteio: "" };
      }
      if (ids.includes(atleta.id)) throw new Error(`${atleta.nome} aparece em mais de um lugar da mensagem.`);
      ids.push(atleta.id);
      return { id: atleta.id, nome: atleta.nome, sexo: atleta.sexo, pote: atleta.pote, poteSorteio: atleta.pote };
    }),
  }));
  definirTimes(estado, times);
  estado.lista = { ids, pendentes };
  return { times: times.length, atletas: ids.length + pendentes.length, pendentes };
}

export function zerarCheckin(estado) {
  estado.checkin = { ids: [], ordem: [] };
}

const chaveJogador = (jogador) => jogador.id || `nome:${normalizarNome(jogador.nome)}`;

/** Marca ou desmarca a chegada e recalcula a ordem dos times completos. */
export function alternarCheckin(estado, jogador) {
  const chave = chaveJogador(jogador);
  const ids = estado.checkin.ids;
  estado.checkin.ids = ids.includes(chave) ? ids.filter((item) => item !== chave) : [...ids, chave];
  const chegou = new Set(estado.checkin.ids);
  const completos = (estado.times || [])
    .map((time, indice) => (time.jogadores.every((j) => chegou.has(chaveJogador(j))) ? indice : null))
    .filter((indice) => indice !== null);
  const ordem = estado.checkin.ordem.filter((indice) => completos.includes(indice));
  completos.forEach((indice) => { if (!ordem.includes(indice)) ordem.push(indice); });
  estado.checkin.ordem = ordem;
}

export const chegou = (estado, jogador) => estado.checkin.ids.includes(chaveJogador(jogador));
