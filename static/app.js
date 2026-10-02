/* App do torneio de vôlei — frontend mobile-first. */

const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw await erroApi(r);
    return r.json();
  },
  async enviar(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw await erroApi(r);
    return r.json();
  },
};

async function erroApi(resposta) {
  const texto = await resposta.text();
  try {
    const corpo = JSON.parse(texto);
    return new Error(corpo.detail || texto);
  } catch {
    return new Error(texto || "Não foi possível concluir a operação.");
  }
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[c]));

const STORAGE_PARTICIPANTES = "volei.participantes.v1";
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
function salvarParticipantesLocais() {
  localStorage.setItem(STORAGE_PARTICIPANTES, JSON.stringify(participantes));
}
function lerParticipantesLocais() {
  try { return JSON.parse(localStorage.getItem(STORAGE_PARTICIPANTES) || "null"); } catch { return null; }
}

// Função: extrair os 24 titulares da mensagem do WhatsApp
function extrairTitulares(texto) {
  const linhas = texto.split("\n");
  const titulares = [];
  let naLista = false;

  for (const linha of linhas) {
    const t = linha.trim();
    if (/^1\./.test(t)) naLista = true;
    if (/^Espera Grupo/i.test(t) || /^Convidados/i.test(t)) break;
    if (naLista) {
      const m = t.match(/^\d+\.\s*(.+?)(?:\s*✅)?$/);
      if (m) {
        const nome = m[1].trim().replace(/\s*[✅☑][\uFE0E\uFE0F]?\s*$/, "").replace(/^\(convidado\s+.+\)$/i, "");
        if (nome && !nome.startsWith("(")) titulares.push(nome);
      }
    }
  }
  return titulares.slice(0, 24);
}

// Função: extrair os times da mensagem gerada pelo "Compartilhar times".
// Seções em negrito do WhatsApp (*Nome*) ou texto plano, seguidas de jogadores numerados.
// Apenas seções cujo nome começa com "Time" são reconhecidas (\b impede o título
// geral "Times"), para não confundir com a lista de participantes (C1, M1, ...).
function extrairTimes(texto) {
  const linhas = texto.split("\n");
  const times = [];
  let atual = null;
  for (const linha of linhas) {
    const t = linha.trim();
    const m = t.match(/^\d+\.\s*(.+?)(?:\s*✅)?$/);
    if (m) {
      const nome = m[1].trim().replace(/\s*[✅☑][\uFE0E\uFE0F]?\s*$/, "");
      if (nome && atual) atual.jogadores.push(nome);
      continue;
    }
    const negrito = t.match(/^\*(.+?)\*$/);
    const cabecalho = (negrito ? negrito[1] : t).trim();
    if (cabecalho && /^time\b/i.test(cabecalho)) {
      atual = { nome: cabecalho, jogadores: [] };
      times.push(atual);
    }
  }
  return times.filter((time) => time.jogadores.length);
}

// ---- Navegação entre telas -------------------------------------------
document.querySelectorAll(".aba").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("ativa"));
    document.querySelectorAll(".tela").forEach((t) => t.classList.remove("ativa"));
    btn.classList.add("ativa");
    document.getElementById(btn.dataset.tela).classList.add("ativa");
    atualizarVisibilidadeCasais(btn.dataset.tela);
  });
});

function atualizarVisibilidadeCasais(tela) {
  const botao = $("btn-abrir-casais");
  botao.hidden = tela !== "participantes";
  if (tela !== "participantes" && $("popup-casais").open) $("popup-casais").close();
  $("btn-configurar-pontos").hidden = tela !== "pontos";
}

atualizarVisibilidadeCasais("dashboard");

// ---- Participantes ---------------------------------------------------
let participantes = [];
let participanteId = new Map();
const filtrosParticipantes = { sexo: "", nivel: "" };
const STORAGE_CASAIS = "volei.casais.v1";
const STORAGE_CASAIS_ATIVOS = "volei.casais.ativos.v1";
const STORAGE_CASAIS_CONFIG = "volei.casais.config.v1";
let sorteioComCasais = localStorage.getItem(STORAGE_CASAIS) === "true";
const CASAIS_PADRAO = [
  ["Thiago Ramalho", "Maria Clara Batista"],
  ["Douglas Nascimento", "Pattricia"],
  ["João Alberto", "Thais Moreno"],
  ["Erivan Junior", "Livia Cristhina"],
];
let casaisConfigurados;
try { casaisConfigurados = JSON.parse(localStorage.getItem(STORAGE_CASAIS_CONFIG) || "null"); } catch { casaisConfigurados = null; }
if (!Array.isArray(casaisConfigurados) || casaisConfigurados.some((casal) => !Array.isArray(casal) || casal.length !== 2)) {
  casaisConfigurados = CASAIS_PADRAO.map((casal) => [...casal]);
}
let casaisAtivos;
try { casaisAtivos = JSON.parse(localStorage.getItem(STORAGE_CASAIS_ATIVOS) || "null"); } catch { casaisAtivos = null; }
if (!Array.isArray(casaisAtivos) || casaisAtivos.length !== casaisConfigurados.length) {
  casaisAtivos = casaisConfigurados.map(() => true);
}

const normalizarNome = (nome) => String(nome || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const nomePoteSorteio = (pote) => ({ M2F2: "M2/F2", levantadores: "LM1/LF1" }[pote] || pote);
const correspondeFiltroPote = (p, filtro) => {
  const pote = p.pote_sorteio || p.nivel;
  if (!filtro) return true;
  if (filtro === "M2") return pote === "M2" || pote === "M2F2";
  if (filtro === "F2") return pote === "M2F2";
  if (filtro === "LM1" || filtro === "LF1") return pote === "levantadores";
  return pote === filtro;
};

const NIVEIS = ["C1", "M1", "M2", "F1", "F2", "LM1", "LF1"];
const STORAGE_CADASTRO = "volei.cadastro.atletas.v1";
const STORAGE_SHEETS_CONECTADO = "volei.sheets.conectado.v1";
let cadastroAtletas = [];
let sheetsConectado = localStorage.getItem(STORAGE_SHEETS_CONECTADO) === "true";
const filtrosCadastro = { nivel: "", sexo: "" };

function salvarCadastro() { localStorage.setItem(STORAGE_CADASTRO, JSON.stringify(cadastroAtletas)); }

function payloadCadastro() {
  return { atletas: cadastroAtletas.map((atleta, ordem) => ({ ...atleta, ordem, atualizado_em: new Date().toISOString() })) };
}

function mensagemSheets(texto, erro = false) {
  $("msg-sheets").textContent = texto;
  $("msg-sheets").className = erro ? "msg erro" : "msg";
}

function credenciaisSheetsSite() {
  return { sheet_id: $("sheets-id-site").value.trim(), service_account_info: $("sheets-credencial-site").value.trim() };
}

function salvarCredenciaisDaSessao() {
  const credenciais = credenciaisSheetsSite();
  sessionStorage.setItem("volei.sheets.credenciais.v1", JSON.stringify(credenciais));
  return credenciais;
}

function carregarCredenciaisDaSessao() {
  try {
    const credenciais = JSON.parse(sessionStorage.getItem("volei.sheets.credenciais.v1") || "{}");
    $("sheets-id-site").value = credenciais.sheet_id || "";
    $("sheets-credencial-site").value = credenciais.service_account_info || "";
  } catch { /* Configuração da sessão inválida é descartada. */ }
}

$("btn-testar-sheets").addEventListener("click", () => executarSheets(async () => {
  const resposta = await api.enviar("/api/nivelamento/testar", "POST", salvarCredenciaisDaSessao());
  mensagemSheets(resposta.mensagem);
}));

async function executarSheets(acao) {
  try { return await acao(); } catch (erro) { mensagemSheets(erro.message, true); return null; }
}

let tarefaEmAndamento = false;

async function executarComProgresso(titulo, acao) {
  if (tarefaEmAndamento) return;
  tarefaEmAndamento = true;
  const painel = $("progresso-tarefa");
  const etapa = $("etapa-progresso");
  painel.hidden = false;
  painel.classList.remove("minimizado", "concluido", "falhou");
  $("titulo-progresso").textContent = titulo;
  $("btn-fechar-progresso").hidden = true;
  etapa.className = "msg";
  etapa.textContent = "Preparando operação...";
  try {
    const resultado = await acao((mensagem) => { etapa.textContent = mensagem; });
    etapa.textContent = resultado || "Operação concluída.";
    painel.classList.add("concluido");
    $("titulo-progresso").textContent = `${titulo}: concluído`;
    $("btn-fechar-progresso").hidden = false;
    setTimeout(() => { painel.hidden = true; }, 900);
  } catch (erro) {
    etapa.textContent = erro.message;
    etapa.className = "msg erro";
    painel.classList.add("falhou");
    $("titulo-progresso").textContent = `${titulo}: erro`;
    $("btn-fechar-progresso").hidden = false;
  } finally {
    tarefaEmAndamento = false;
  }
}

$("btn-minimizar-progresso").addEventListener("click", (event) => { event.stopPropagation(); $("progresso-tarefa").classList.add("minimizado"); });
$("progresso-tarefa").addEventListener("click", () => {
  if ($("progresso-tarefa").classList.contains("minimizado")) $("progresso-tarefa").classList.remove("minimizado");
});
$("btn-fechar-progresso").addEventListener("click", (event) => { event.stopPropagation(); $("progresso-tarefa").hidden = true; });

$("btn-conectar-sheets").addEventListener("click", () => executarSheets(async () => {
  if (!confirm("Conectar limpará apenas os dados da aba Nivelamento e criará a aba Acessos, se necessário. As demais abas serão preservadas. Deseja continuar?")) return;
  await api.enviar("/api/nivelamento/conectar", "POST", salvarCredenciaisDaSessao());
  sheetsConectado = true;
  localStorage.setItem(STORAGE_SHEETS_CONECTADO, "true");
  mensagemSheets("Planilha conectada e preparada.");
}));
$("btn-desconectar-sheets").addEventListener("click", () => {
  sheetsConectado = false;
  localStorage.removeItem(STORAGE_SHEETS_CONECTADO);
  sessionStorage.removeItem("volei.sheets.credenciais.v1");
  $("sheets-id-site").value = "";
  $("sheets-credencial-site").value = "";
  mensagemSheets("Google Sheets desconectado neste navegador.");
});
$("btn-sincronizar-sheets").addEventListener("click", () => executarComProgresso("Sincronizando Cadastro", async (etapa) => {
  if (!sheetsConectado) throw new Error("Conecte o Google Sheets antes de sincronizar.");
  etapa("Enviando novos atletas para a planilha...");
  const resposta = await api.enviar("/api/nivelamento/sincronizar", "POST", { ...payloadCadastro(), ...salvarCredenciaisDaSessao() });
  const mensagem = `${resposta.adicionados} novos atletas enviados para a planilha.`;
  mensagemSheets(mensagem);
  return mensagem;
}));
$("btn-importar-sheets").addEventListener("click", () => {
  if (!confirm("Importar substituirá o Cadastro local pelos dados da planilha. Deseja continuar?")) return;
  executarComProgresso("Importando Cadastro", async (etapa) => {
    if (!sheetsConectado) throw new Error("Conecte o Google Sheets antes de importar.");
    etapa("Lendo a lista única de nivelamento...");
    const resposta = await api.enviar("/api/nivelamento/importar", "POST", salvarCredenciaisDaSessao());
    cadastroAtletas = resposta.atletas.sort((a, b) => a.ordem - b.ordem).map(({ ordem, atualizado_em, ...atleta }) => atleta);
    salvarCadastro();
    renderCadastro();
    limparTimesEPresenca();
    const mensagem = `${cadastroAtletas.length} atletas importados. Times e presença anteriores foram limpos.`;
    mensagemSheets(mensagem);
    return mensagem;
  });
});

function carregarCadastro() {
  try { cadastroAtletas = JSON.parse(localStorage.getItem(STORAGE_CADASTRO) || "[]"); } catch { cadastroAtletas = []; }
  if (!Array.isArray(cadastroAtletas)) cadastroAtletas = [];
  cadastroAtletas = cadastroAtletas.filter((atleta) => atleta && atleta.id && atleta.nome).map((atleta) => ({
    id: atleta.id,
    nome: atleta.nome,
    sexo: atleta.sexo || "",
    pote: NIVEIS.includes(atleta.pote) ? atleta.pote : "",
    potesAdicionais: Array.isArray(atleta.potesAdicionais) ? atleta.potesAdicionais.filter((pote) => NIVEIS.includes(pote)) : [],
    aliases: Array.isArray(atleta.aliases) ? atleta.aliases : [],
  }));
  renderCadastro();
}

function encontrarCadastro(nome) {
  const chave = normalizarNome(nome);
  return cadastroAtletas.find((atleta) => normalizarNome(atleta.nome) === chave || atleta.aliases.some((alias) => normalizarNome(alias) === chave));
}

function atualizarParticipantesDoCadastro() {
  let atualizados = 0;
  participantes.forEach((participante) => {
    const atleta = cadastroAtletas.find((item) => item.id === participante.cadastro_id || item.id === participante.id) || encontrarCadastro(participante.nome);
    if (!atleta) return;
    participante.id = atleta.id;
    participante.cadastro_id = atleta.id;
    participante.nome = atleta.nome;
    participante.sexo = atleta.sexo;
    participante.nivel = atleta.pote || null;
    participante.ranking = cadastroAtletas.indexOf(atleta) + 1;
    participante.potes_adicionais = atleta.potesAdicionais;
    delete participante.pote_sorteio;
    delete participante.promovido_de;
    participante.atualizado_em = new Date().toISOString();
    atualizados += 1;
  });
  salvarParticipantesLocais();
  renderParticipantes();
  return atualizados;
}

function aplicarPotesDoSorteio() {
  const ativos = participantes.filter((p) => p.status === "ativo");
  if (ativos.length !== 24) throw new Error(`É necessário ter exatamente 24 atletas ativos. Atual: ${ativos.length}.`);
  const pendencias = ativos.filter((p) => !p.cadastro_id || !p.sexo || !p.nivel);
  if (pendencias.length) throw new Error(`Atletas pendentes de cadastro ou nivelamento: ${pendencias.map((p) => p.nome).join(", ")}.`);
  const atribuicoes = calcularAtribuicaoPotes(ativos);
  ativos.forEach((p) => { p.pote_sorteio = atribuicoes.get(p.id); });
  criarTimesComRestricoes(ativos);
  salvarParticipantesLocais();
  renderParticipantes();
}

function limparTimesEPresenca() {
  localStorage.removeItem(STORAGE_TIMES);
  localStorage.removeItem(STORAGE_PRESENCA);
  times = [];
  presenca = { assinatura: "", atletas: {}, ordem: [] };
  renderTimes();
  renderPresenca();
}

function buscarCadastro(termo) {
  const chave = normalizarNome(termo);
  if (!chave) return cadastroAtletas;
  return cadastroAtletas.filter((atleta) => normalizarNome(atleta.nome).includes(chave) || atleta.aliases.some((alias) => normalizarNome(alias).includes(chave)));
}

function renderResultadosCadastro(elemento, atletas, aoSelecionar) {
  elemento.innerHTML = "";
  atletas.forEach((atleta) => {
    const botao = document.createElement("button");
    botao.className = "secundario resultado-vinculo";
    botao.textContent = `${atleta.nome}${atleta.aliases.length ? ` (${atleta.aliases.join(", ")})` : ""}`;
    botao.addEventListener("click", () => aoSelecionar(atleta));
    elemento.appendChild(botao);
  });
}

function migrarCadastroLegado() {
  if (cadastroAtletas.length || !participantes.length || !participantes.some((p) => NIVEIS.includes(p.nivel))) return;
  const forca = { C1: 7, M1: 6, M2: 5, F1: 4, F2: 3, LM1: 2, LF1: 1 };
  cadastroAtletas = [...participantes].sort((a, b) => forca[b.nivel] - forca[a.nivel] || (a.ranking || 0) - (b.ranking || 0)).map((p) => ({
    id: p.id,
    nome: p.nome,
    sexo: p.sexo || "",
    pote: NIVEIS.includes(p.nivel) ? p.nivel : "",
    potesAdicionais: [],
    aliases: [],
  }));
  salvarCadastro();
  renderCadastro();
}

function renderCadastro() {
  const lista = $("lista-cadastro");
  const alvo = $("cadastro-alvo");
  if (!lista || !alvo) return;
  alvo.innerHTML = cadastroAtletas.length ? cadastroAtletas.map((atleta) => `<option value="${atleta.id}">${esc(atleta.nome)}</option>`).join("") : '<option value="">Cadastre um atleta primeiro</option>';
  lista.innerHTML = "";
  if (!cadastroAtletas.length) {
    lista.innerHTML = '<div class="card">Nenhum atleta cadastrado.</div>';
    return;
  }
  const exibidos = cadastroAtletas
    .filter((atleta) => (!filtrosCadastro.nivel || atleta.pote === filtrosCadastro.nivel || atleta.potesAdicionais.includes(filtrosCadastro.nivel)) && (!filtrosCadastro.sexo || atleta.sexo === filtrosCadastro.sexo))
    .sort((a, b) => cadastroAtletas.indexOf(a) - cadastroAtletas.indexOf(b));
  exibidos.forEach((atleta, indice) => {
    const item = document.createElement("div");
    item.className = "atleta-cadastro";
    item.draggable = true;
    item.dataset.cadastroId = atleta.id;
    const opcoes = NIVEIS.map((pote) => `<option value="${pote}" ${atleta.pote === pote ? "selected" : ""}>${pote}</option>`).join("");
    const adicionais = NIVEIS.filter((pote) => pote !== atleta.pote).map((pote) => `<label><input type="checkbox" data-pote-adicional="${pote}" ${atleta.potesAdicionais.includes(pote) ? "checked" : ""} />${pote}</label>`).join("");
    item.innerHTML = `<div class="cabecalho-cadastro"><span class="nome-cabecalho-cadastro">${indice + 1}. <input data-cadastro-nome value="${esc(atleta.nome)}" maxlength="80" /></span><span class="acoes-cabecalho-cadastro"><span class="dica-arraste">Arraste</span><button class="btn-excluir-cadastro" data-excluir-cadastro="${atleta.id}" title="Excluir atleta" aria-label="Excluir ${esc(atleta.nome)}">🗑️</button></span></div><div class="linha"><select data-cadastro-sexo><option value="" ${!atleta.sexo ? "selected" : ""}>Sexo</option><option value="F" ${atleta.sexo === "F" ? "selected" : ""}>F</option><option value="M" ${atleta.sexo === "M" ? "selected" : ""}>M</option></select><select data-cadastro-pote><option value="">Pote principal</option>${opcoes}</select></div><div class="det-cadastro">Pote principal: ${atleta.pote || "não definido"} · Também atua em: ${atleta.potesAdicionais.length ? atleta.potesAdicionais.join(", ") : "nenhum"}</div><div class="det-cadastro">Nomes vinculados: ${atleta.aliases.length ? atleta.aliases.map(esc).join(", ") : "nenhum"}</div><div class="potes-adicionais"><span class="det-cadastro">Permissões:</span>${adicionais}</div>`;
    lista.appendChild(item);
  });
  lista.querySelectorAll("[data-cadastro-nome]").forEach((input) => input.addEventListener("change", () => atualizarCadastro(input.closest("[data-cadastro-id]").dataset.cadastroId, { nome: input.value.trim() })));
  lista.querySelectorAll("[data-cadastro-sexo]").forEach((select) => select.addEventListener("change", () => atualizarCadastro(select.closest("[data-cadastro-id]").dataset.cadastroId, { sexo: select.value })));
  lista.querySelectorAll("[data-cadastro-pote]").forEach((select) => select.addEventListener("change", () => atualizarCadastro(select.closest("[data-cadastro-id]").dataset.cadastroId, { pote: select.value })));
  lista.querySelectorAll("[data-pote-adicional]").forEach((input) => input.addEventListener("change", () => {
    const atleta = cadastroAtletas.find((item) => item.id === input.closest("[data-cadastro-id]").dataset.cadastroId);
    atleta.potesAdicionais = NIVEIS.filter((pote) => pote !== atleta.pote && input.closest("[data-cadastro-id]").querySelector(`[data-pote-adicional="${pote}"]`)?.checked);
    salvarCadastro(); renderCadastro();
  }));
  lista.querySelectorAll("[data-excluir-cadastro]").forEach((botao) => botao.addEventListener("click", () => abrirConfirmacaoExcluirCadastro(botao.dataset.excluirCadastro)));
  configurarArrasteCadastro(lista);
}

document.querySelectorAll("[data-cadastro-nivel]").forEach((botao) => botao.addEventListener("click", () => {
  filtrosCadastro.nivel = botao.dataset.cadastroNivel;
  document.querySelectorAll("[data-cadastro-nivel]").forEach((item) => item.classList.toggle("ativo", item === botao));
  renderCadastro();
}));

document.querySelectorAll("[data-cadastro-sexo]").forEach((botao) => botao.addEventListener("click", () => {
  filtrosCadastro.sexo = botao.dataset.cadastroSexo;
  document.querySelectorAll("[data-cadastro-sexo]").forEach((item) => item.classList.toggle("ativo", item === botao));
  renderCadastro();
}));

function atualizarCadastro(id, alteracoes) {
  const atleta = cadastroAtletas.find((item) => item.id === id);
  if (!atleta) return;
  Object.assign(atleta, alteracoes);
  atleta.potesAdicionais = atleta.potesAdicionais.filter((pote) => pote !== atleta.pote);
  salvarCadastro(); renderCadastro();
}

function adicionarAtletaAoCadastro(nome) {
  const existente = encontrarCadastro(nome);
  if (existente) return existente;
  const atleta = { id: novoId(), nome, sexo: "", pote: "", potesAdicionais: [], aliases: [] };
  cadastroAtletas.push(atleta);
  salvarCadastro();
  renderCadastro();
  return atleta;
}

function configurarArrasteCadastro(lista) {
  let origem = null;
  lista.querySelectorAll(".atleta-cadastro").forEach((item) => {
    item.addEventListener("dragstart", () => { origem = item; item.classList.add("arrastando"); });
    item.addEventListener("dragend", () => { item.classList.remove("arrastando"); lista.querySelectorAll(".alvo-arraste").forEach((alvo) => alvo.classList.remove("alvo-arraste")); });
    item.addEventListener("dragover", (event) => { event.preventDefault(); if (origem && origem !== item) item.classList.add("alvo-arraste"); });
    item.addEventListener("dragleave", () => item.classList.remove("alvo-arraste"));
    item.addEventListener("drop", (event) => {
      event.preventDefault(); if (!origem || origem === item) return;
      const de = cadastroAtletas.findIndex((atleta) => atleta.id === origem.dataset.cadastroId);
      const para = cadastroAtletas.findIndex((atleta) => atleta.id === item.dataset.cadastroId);
      const [atleta] = cadastroAtletas.splice(de, 1);
      cadastroAtletas.splice(para, 0, atleta);
      salvarCadastro(); renderCadastro();
    });
  });
}

$("btn-cadastro-adicionar").addEventListener("click", () => {
  const nome = $("cadastro-nome").value.trim();
  const mensagem = $("msg-cadastro");
  if (!nome) return;
  if (encontrarCadastro(nome)) {
    mensagem.textContent = "Este nome já está cadastrado ou vinculado.";
    mensagem.className = "msg erro";
    return;
  }
  cadastroAtletas.push({ id: novoId(), nome, sexo: $("cadastro-sexo").value, pote: $("cadastro-pote").value, potesAdicionais: [], aliases: [] });
  salvarCadastro(); renderCadastro();
  $("cadastro-nome").value = "";
  $("cadastro-sexo").value = "";
  $("cadastro-pote").value = "";
  mensagem.textContent = "Atleta adicionado ao final da lista.";
  mensagem.className = "msg";
});

$("btn-cadastro-vincular").addEventListener("click", () => {
  const alias = $("cadastro-alias").value.trim();
  const mensagem = $("msg-vinculo");
  const atleta = cadastroAtletas.find((item) => item.id === $("cadastro-alvo").value);
  if (!alias || !atleta) return;
  if (encontrarCadastro(alias)) {
    mensagem.textContent = "Este nome já está cadastrado ou vinculado.";
    mensagem.className = "msg erro";
    return;
  }
  atleta.aliases.push(alias);
  salvarCadastro(); renderCadastro();
  $("cadastro-alias").value = "";
  mensagem.textContent = `Nome vinculado a ${atleta.nome}.`;
  mensagem.className = "msg";
});

$("btn-cadastro-buscar").addEventListener("click", () => {
  const resultados = $("resultados-busca-cadastro");
  renderResultadosCadastro(resultados, buscarCadastro($("cadastro-alias").value), (atleta) => {
    $("cadastro-alvo").value = atleta.id;
    resultados.innerHTML = "";
  });
});

let pendenteParaVinculo = null;

function vincularParticipantePendente(participante, atleta) {
  const existente = encontrarCadastro(participante.nome);
  if (existente && existente.id !== atleta.id) throw new Error("Este nome já está vinculado a outro atleta cadastrado.");
  if (normalizarNome(atleta.nome) !== normalizarNome(participante.nome) && !atleta.aliases.some((alias) => normalizarNome(alias) === normalizarNome(participante.nome))) {
    atleta.aliases.push(participante.nome);
  }
  participante.id = atleta.id;
  participante.cadastro_id = atleta.id;
  participante.nome = atleta.nome;
  participante.sexo = atleta.sexo;
  participante.nivel = atleta.pote || null;
  participante.ranking = cadastroAtletas.indexOf(atleta) + 1;
  participante.potes_adicionais = atleta.potesAdicionais;
  salvarCadastro();
  salvarParticipantesLocais();
  renderCadastro();
  renderParticipantes();
}

function atualizarNomeParticipante(participante, nome) {
  const atleta = encontrarCadastro(nome);
  if (atleta && participantes.some((item) => item !== participante && (item.cadastro_id === atleta.id || item.id === atleta.id))) {
    throw new Error(`${atleta.nome} já está na lista de participantes.`);
  }
  if (atleta) {
    participante.id = atleta.id;
    participante.cadastro_id = atleta.id;
    participante.nome = atleta.nome;
    participante.sexo = atleta.sexo;
    participante.nivel = atleta.pote || null;
    participante.ranking = cadastroAtletas.indexOf(atleta) + 1;
    participante.potes_adicionais = atleta.potesAdicionais;
  } else {
    participante.id = novoId();
    participante.cadastro_id = null;
    participante.nome = nome;
    participante.sexo = "";
    participante.nivel = null;
    participante.ranking = null;
    participante.potes_adicionais = [];
  }
  delete participante.pote_sorteio;
  delete participante.promovido_de;
  participante.atualizado_em = new Date().toISOString();
  salvarParticipantesLocais();
}

function selecionarTop4PorNivel(ativos) {
  // Ordena pelo ranking da lista master (1 = mais forte)
  const ordenados = [...ativos].sort((a, b) => (a.ranking || 999) - (b.ranking || 999));
  const agrupar = (chaves) => ordenados.filter((p) => chaves.includes(p.nivel));
  const grupos = {
    C1: agrupar(["C1"]),
    Levantadores: agrupar(["LM1", "LF1"]),
    M1: agrupar(["M1"]),
    F1: agrupar(["F1"]),
    M2: agrupar(["M2"]),
    F2: agrupar(["F2"]),
  };
  // Preenche 4 vagas por categoria; se faltar, completa com os melhores ainda não usados
  const prioridade = ["C1", "Levantadores", "M1", "F1", "M2", "F2"];
  const usados = new Set();
  const selecionados = {};
  for (const categoria of prioridade) {
    const proprios = grupos[categoria].filter((p) => !usados.has(p.id));
    const escolhidos = proprios.slice(0, 4);
    escolhidos.forEach((p) => usados.add(p.id));
    const faltam = 4 - escolhidos.length;
    if (faltam > 0) {
      const extras = ordenados.filter((p) => !usados.has(p.id)).slice(0, faltam);
      extras.forEach((p) => usados.add(p.id));
      selecionados[categoria] = [...escolhidos, ...extras];
    } else {
      selecionados[categoria] = escolhidos;
    }
  }
  return selecionados;
}

function categoriaNucleo(p) {
  return (p.nivel === "LM1" || p.nivel === "LF1") ? "Levantadores" : p.nivel;
}

function posicionarCasais(top, timesNovos) {
  // Casais ativos são sempre mantidos no mesmo time, mesmo nivelando as regras.
  const selecionados = [...top.C1, ...top.Levantadores, ...top.M1, ...top.F1, ...top.M2, ...top.F2];
  const porNome = new Map(selecionados.map((p) => [normalizarNome(p.nome), p]));
  const usados = new Set();
  const unidades = [];
  const ausentes = [];
  casaisConfigurados.forEach((casal, indice) => {
    if (!casaisAtivos[indice]) return;
    const primeiro = porNome.get(normalizarNome(casal[0]));
    const segundo = porNome.get(normalizarNome(casal[1]));
    if (!primeiro || !segundo) { ausentes.push(`${casal[0]} e ${casal[1]}`); return; }
    if (usados.has(primeiro.id) || usados.has(segundo.id)) return;
    unidades.push([primeiro, segundo]);
    usados.add(primeiro.id);
    usados.add(segundo.id);
  });
  for (const unidade of unidades) {
    const contagens = {};
    unidade.forEach((p) => { const c = categoriaNucleo(p); contagens[c] = (contagens[c] || 0) + 1; });
    // Casal vence regras: casal do mesmo nível ocupa as duas vagas da categoria em um time.
    // Reserva 2 vagas para o núcleo de nivelamento (1 C1 + 1 Levantador).
    const valido = (t) => timesNovos[t].jogadores.length + unidade.length <= 4 &&
      Object.entries(contagens).every(([c]) => timesNovos[t].jogadores.every((j) => categoriaNucleo(j) !== c));
    const escolhido = [0, 1, 2, 3].sort(() => Math.random() - 0.5).find(valido);
    if (escolhido === undefined) {
      throw new Error("Não foi possível encaixar todos os casais nos times. Desative algum casal ou revise os potes.");
    }
    timesNovos[escolhido].jogadores.push(...unidade);
  }
  return { ausentes, usados };
}

function preencherNucleoC1Lev(top, timesNovos, usados = new Set()) {
  // Nivelamento: pareamento de opostos (1º C1 + 4º Levantador, 2º + 3º, ...).
  // Com casais, completa o núcleo de cada time mantendo a regra entre os restantes.
  const rank = (p) => p.ranking || 999;
  const c1 = top.C1.filter((p) => !usados.has(p.id)).sort((a, b) => rank(a) - rank(b));
  const lev = top.Levantadores.filter((p) => !usados.has(p.id)).sort((a, b) => rank(b) - rank(a));
  const nucleo = (t, categoria) => timesNovos[t].jogadores.find((j) => categoriaNucleo(j) === categoria);

  // Times com Levantador do casal recebem o C1 oposto (melhor Lev → pior C1)
  [0, 1, 2, 3].filter((t) => !nucleo(t, "C1") && nucleo(t, "Levantadores"))
    .sort((x, y) => rank(nucleo(x, "Levantadores")) - rank(nucleo(y, "Levantadores")))
    .forEach((t) => {
      const escolhido = c1.pop();
      if (escolhido) timesNovos[t].jogadores.push(escolhido);
    });

  // Times com C1 do casal recebem o Levantador oposto (melhor C1 → pior Lev)
  [0, 1, 2, 3].filter((t) => nucleo(t, "C1") && !nucleo(t, "Levantadores"))
    .sort((x, y) => rank(nucleo(x, "C1")) - rank(nucleo(y, "C1")))
    .forEach((t) => {
      const escolhido = lev.shift();
      if (escolhido) timesNovos[t].jogadores.push(escolhido);
    });

  // Times sem C1 e sem Levantador: pareamento fixo de opostos, destino sorteado
  [0, 1, 2, 3].filter((t) => !nucleo(t, "C1") && !nucleo(t, "Levantadores"))
    .sort(() => Math.random() - 0.5)
    .forEach((t) => {
      if (!c1.length || !lev.length) return;
      const parC1 = c1.shift();
      const parLev = lev.shift();
      timesNovos[t].jogadores.push(parC1, parLev);
    });

  // Sobras (ex.: casal do mesmo nível de C1 ou Levantador): coloca em times com vaga
  while (c1.length || lev.length) {
    const p = c1.length ? c1.pop() : lev.shift();
    const escolhido = [0, 1, 2, 3]
      .filter((t) => timesNovos[t].jogadores.length < 6)
      .sort((a, b) => timesNovos[a].jogadores.length - timesNovos[b].jogadores.length || Math.random() - 0.5)[0];
    if (escolhido === undefined) break;
    timesNovos[escolhido].jogadores.push(p);
  }
}

function distribuirRestantes(top, timesNovos) {
  // Sorteia M1, F1, M2 e F2: 1 de cada por time, mulheres equilibradas.
  // Somente C1 e Levantadores são fixados (nivelamento); o resto é aleatório.
  // Usa backtracking: com casais, algumas categorias só têm times elegíveis
  // limitados e a ordem gulosa pode esgotar as vagas antes do fim.
  const embaralhar = (itens) => [...itens].sort(() => Math.random() - 0.5);
  const categorias = ["M1", "F1", "M2", "F2"];
  // Exclui atletas já posicionados por casais ou pelo núcleo C1+Levantador
  const pendentes = embaralhar(categorias.flatMap((c) => top[c].map((p) => ({ p, c }))))
    .filter((item) => !timesNovos.some((t) => t.jogadores.includes(item.p)));
  const totalMulheres = pendentes.filter((i) => i.p.sexo === "F").length +
    timesNovos.reduce((s, t) => s + t.jogadores.filter((p) => p.sexo === "F").length, 0);
  const base = Math.floor(totalMulheres / 4);
  const resto = totalMulheres % 4;

  const tentar = (alvos, equilibrarMulheres, flexivel) => {
    let tentativas = 0;
    // A composição exige 1 de cada nível por time; M2 e F2 admitem 1 ou 2,
    // o que permite fechar times quando casais do mesmo nível deslocam vagas.
    const limite = (c) => flexivel && (c === "M2" || c === "F2") ? 2 : 1;
    const colocar = (indice) => {
      if (indice === pendentes.length) return true;
      if (++tentativas > 200000) return false;
      const item = pendentes[indice];
      const vaga = (t) => timesNovos[t].jogadores.length < 6 &&
        timesNovos[t].jogadores.filter((j) => top[item.c].includes(j)).length < limite(item.c);
      const mulheres = (t) => timesNovos[t].jogadores.filter((p) => p.sexo === "F").length + (item.p.sexo === "F" ? 1 : 0);
      let candidatos = [0, 1, 2, 3].filter((t) => vaga(t) && (!equilibrarMulheres || mulheres(t) <= alvos[t]));
      if (!candidatos.length && equilibrarMulheres) candidatos = [0, 1, 2, 3].filter((t) => vaga(t));
      for (const t of embaralhar(candidatos)) {
        timesNovos[t].jogadores.push(item.p);
        if (colocar(indice + 1)) return true;
        timesNovos[t].jogadores.pop();
      }
      return false;
    };
    return colocar(0);
  };

  // Prioriza composição estrita e equilíbrio de mulheres; flexibiliza M2/F2
  // (necessário com casais do mesmo nível) e por fim relaxa o equilíbrio.
  const combinacoes = [];
  for (let mascara = 0; mascara < 16; mascara++) {
    const times = [0, 1, 2, 3].filter((t) => mascara & (1 << t));
    if (times.length === resto) combinacoes.push(times);
  }
  for (const flexivel of [false, true]) {
    for (const combo of embaralhar(combinacoes)) {
      const alvos = Array(4).fill(base);
      combo.forEach((t) => { alvos[t] += 1; });
      if (tentar(alvos, true, flexivel)) return;
    }
  }
  if (!tentar(Array(4).fill(base + 1), false, false) && !tentar(Array(4).fill(base + 1), false, true)) {
    throw new Error("Não foi possível distribuir os atletas restantes nos times.");
  }
}

function excluirAtletaDoCadastro(id) {
  const atleta = cadastroAtletas.find((a) => a.id === id);
  if (!atleta) return;
  // Desvincula participantes vinculados a este atleta
  let desvinculados = 0;
  participantes.forEach((p) => {
    if (p.cadastro_id === id || p.id === id) {
      p.id = novoId();
      p.cadastro_id = null;
      p.nome = atleta.nome;
      p.sexo = "";
      p.nivel = null;
      p.ranking = null;
      p.potes_adicionais = [];
      delete p.pote_sorteio;
      delete p.promovido_de;
      p.atualizado_em = new Date().toISOString();
      desvinculados += 1;
    }
  });
  // Remove o atleta do cadastro
  cadastroAtletas.splice(cadastroAtletas.indexOf(atleta), 1);
  salvarCadastro(); salvarParticipantesLocais();
  if (desvinculados) limparTimesPresencaEPontos();
  renderCadastro(); renderParticipantes();
}


function abrirConfirmacaoExcluirCadastro(id) {
  const atleta = cadastroAtletas.find((a) => a.id === id);
  if (!atleta) return;
  $("msg-excluir-cadastro").textContent = `Excluir "${atleta.nome}" do cadastro? Participantes vinculados serão desvinculados e voltarão para "pendente".`;
  $("btn-fechar-excluir-cadastro").onclick = () => $("popup-excluir-cadastro").close();
  $("btn-cancelar-excluir-cadastro").onclick = () => $("popup-excluir-cadastro").close();
  $("btn-confirmar-excluir-cadastro").onclick = () => {
    $("popup-excluir-cadastro").close();
    excluirAtletaDoCadastro(id);
  };
  $("popup-excluir-cadastro").showModal();
}

$("btn-fechar-vinculo-pendente").addEventListener("click", () => $("popup-vincular-pendente").close());
$("busca-vinculo-pendente").addEventListener("input", () => {
  renderResultadosCadastro($("resultados-vinculo-pendente"), buscarCadastro($("busca-vinculo-pendente").value), (atleta) => {
    const participante = participantes.find((p) => p.id === pendenteParaVinculo);
    if (!participante) return;
    try {
      vincularParticipantePendente(participante, atleta);
      $("popup-vincular-pendente").close();
    } catch (erro) {
      alert(erro.message);
    }
  });
});

function atualizarBotaoCasais() {
  const botao = $("btn-casais");
  botao.textContent = `Casais: ${sorteioComCasais ? "ativado" : "desativado"}`;
  botao.setAttribute("aria-pressed", String(sorteioComCasais));
  botao.classList.toggle("primario", sorteioComCasais);
  botao.classList.toggle("secundario", !sorteioComCasais);
}

function salvarConfiguracaoCasais() {
  localStorage.setItem(STORAGE_CASAIS_CONFIG, JSON.stringify(casaisConfigurados));
  localStorage.setItem(STORAGE_CASAIS_ATIVOS, JSON.stringify(casaisAtivos));
}

function renderEditorCasais() {
  const editor = $("editor-casais");
  editor.innerHTML = casaisConfigurados.map((casal, indice) => `<label><input type="checkbox" data-casal="${indice}" ${casaisAtivos[indice] ? "checked" : ""} />${esc(casal[0])} + ${esc(casal[1])}</label>`).join("");
  editor.querySelectorAll("[data-casal]").forEach((input) => {
    input.addEventListener("change", () => {
      casaisAtivos[Number(input.dataset.casal)] = input.checked;
      salvarConfiguracaoCasais();
    });
  });
}

$("btn-casais").addEventListener("click", () => {
  sorteioComCasais = !sorteioComCasais;
  localStorage.setItem(STORAGE_CASAIS, String(sorteioComCasais));
  atualizarBotaoCasais();
});
$("btn-abrir-casais").addEventListener("click", () => {
  renderEditorCasais();
  $("popup-casais").showModal();
});
$("btn-fechar-casais").addEventListener("click", () => {
  $("popup-casais").close();
});
$("btn-adicionar-casal").addEventListener("click", () => {
  const primeiro = participantes.find((p) => p.status === "ativo" && normalizarNome(p.nome) === normalizarNome($("nome-casal-1").value));
  const segundo = participantes.find((p) => p.status === "ativo" && normalizarNome(p.nome) === normalizarNome($("nome-casal-2").value));
  const mensagem = $("msg-adicionar-casal");
  if (!primeiro || !segundo) {
    mensagem.textContent = "Informe dois participantes ativos da lista.";
    mensagem.className = "msg erro";
    return;
  }
  if (primeiro.id === segundo.id) {
    mensagem.textContent = "Um casal precisa ter dois participantes diferentes.";
    mensagem.className = "msg erro";
    return;
  }
  const chave = [normalizarNome(primeiro.nome), normalizarNome(segundo.nome)].sort().join("|");
  const existe = casaisConfigurados.some((casal) => [normalizarNome(casal[0]), normalizarNome(casal[1])].sort().join("|") === chave);
  if (existe) {
    mensagem.textContent = "Este casal já está cadastrado.";
    mensagem.className = "msg erro";
    return;
  }
  casaisConfigurados.push([primeiro.nome, segundo.nome]);
  casaisAtivos.push(true);
  salvarConfiguracaoCasais();
  $("nome-casal-1").value = "";
  $("nome-casal-2").value = "";
  mensagem.textContent = "Casal adicionado e ativado.";
  mensagem.className = "msg";
  renderEditorCasais();
});
atualizarBotaoCasais();

async function carregarParticipantes() {
  const locais = lerParticipantesLocais();
  if (Array.isArray(locais)) {
    participantes = locais;
  } else {
    try {
      participantes = await api.get("/api/participantes");
      salvarParticipantesLocais();
    } catch {
      participantes = [];
    }
  }
  participanteId = new Map(participantes.map((p) => [p.nome, p.id]));
  migrarCadastroLegado();
  renderParticipantes();
}

function renderParticipantes() {
  const lista = $("lista-participantes");
  lista.innerHTML = "";
  renderResumoParticipantes();
  const exibidos = participantes.filter((p) => (
    (!filtrosParticipantes.sexo || p.sexo === filtrosParticipantes.sexo) &&
    correspondeFiltroPote(p, filtrosParticipantes.nivel)
  )).sort((a, b) => {
    if (!filtrosParticipantes.nivel) return 0;
    return (a.ranking || Number.MAX_SAFE_INTEGER) - (b.ranking || Number.MAX_SAFE_INTEGER);
  });
  $("contador-filtros").textContent = `${exibidos.length} de ${participantes.length} participantes`;
  if (!exibidos.length) {
    lista.innerHTML = '<div class="card">Nenhum participante ainda. Adicione acima.</div>';
    return;
  }
  exibidos.forEach((p) => {
    const item = document.createElement("div");
    item.className = "item participante-item";
    item.draggable = false;
    const pendente = !p.cadastro_id;
    item.innerHTML = `
      <div>
        <div class="nome">${esc(p.nome)}</div>
        <div class="det">${pendente ? "Não cadastrado no nivelamento" : `${p.sexo || "Sexo não definido"} · ${nomePoteSorteio(p.pote_sorteio || p.nivel) || "Pote não definido"} · posição geral ${p.ranking || "não definida"}`}</div>
      </div><div class="linha linha-acoes"><button class="secundario" data-editar-participante="${p.id}">Editar nome</button>${pendente ? `<button class="secundario" data-adicionar-pendente="${p.id}">Adicionar ao Cadastro</button><button class="secundario" data-vincular-pendente="${p.id}">Vincular a cadastro existente</button>` : ""}</div>`;
    lista.appendChild(item);
  });
  lista.querySelectorAll("[data-adicionar-pendente]").forEach((botao) => botao.addEventListener("click", () => {
    const participante = participantes.find((p) => p.id === botao.dataset.adicionarPendente);
    if (!participante) return;
    const atleta = adicionarAtletaAoCadastro(participante.nome);
    participante.id = atleta.id;
    participante.cadastro_id = atleta.id;
    participante.nome = atleta.nome;
    salvarParticipantesLocais();
    renderParticipantes();
  }));
  lista.querySelectorAll("[data-vincular-pendente]").forEach((botao) => botao.addEventListener("click", () => {
    pendenteParaVinculo = botao.dataset.vincularPendente;
    $("busca-vinculo-pendente").value = "";
    renderResultadosCadastro($("resultados-vinculo-pendente"), cadastroAtletas, (atleta) => {
      const participante = participantes.find((p) => p.id === pendenteParaVinculo);
      if (!participante) return;
      try {
        vincularParticipantePendente(participante, atleta);
        $("popup-vincular-pendente").close();
      } catch (erro) {
        alert(erro.message);
      }
    });
    $("popup-vincular-pendente").showModal();
  }));
  lista.querySelectorAll("[data-editar-participante]").forEach((botao) => botao.addEventListener("click", () => {
    const participante = participantes.find((p) => p.id === botao.dataset.editarParticipante);
    if (!participante) return;
    const nome = prompt("Nome do participante", participante.nome);
    if (nome === null || !nome.trim() || nome.trim() === participante.nome) return;
    try {
      atualizarNomeParticipante(participante, nome.trim());
      limparTimesPresencaEPontos();
      renderParticipantes();
      $("msg-importar").textContent = "Nome atualizado. Times, presença e partida atual foram limpos.";
      $("msg-importar").className = "msg";
    } catch (erro) {
      alert(erro.message);
    }
  }));
}

function renderResumoParticipantes() {
  const resumo = $("resumo-niveis");
  if (!resumo) return;
  const niveis = ["C1", "M1", "F1", "M2", "M2F2", "levantadores"];
  const ativos = participantes.filter((p) => p.status === "ativo");
  const linhas = [...niveis, "Sem nível"];
  const contar = (nivel, sexo) => ativos.filter((p) =>
    (nivel === "__total__" || (nivel === "Sem nível" ? !p.nivel : (p.pote_sorteio || p.nivel) === nivel)) && p.sexo === sexo
  ).length;
  const contarSemGenero = (nivel) => ativos.filter((p) =>
    (nivel === "Sem nível" ? !p.nivel : (p.pote_sorteio || p.nivel) === nivel) && !p.sexo
  ).length;
  const celulas = linhas.map((nivel) => {
    const feminino = contar(nivel, "F");
    const masculino = contar(nivel, "M");
    const semGenero = contarSemGenero(nivel);
    return `<tr><th scope="row">${nomePoteSorteio(nivel)}</th><td>${feminino}</td><td>${masculino}</td><td>${semGenero}</td><td>${feminino + masculino + semGenero}</td></tr>`;
  }).join("");
  const totalF = contar("__total__", "F");
  const totalM = contar("__total__", "M");
  const totalSemGenero = ativos.filter((p) => !p.sexo).length;
  resumo.innerHTML = `<table><thead><tr><th>Nível</th><th>F</th><th>M</th><th>Não informado</th><th>Total</th></tr></thead><tbody>${celulas}</tbody><tfoot><tr><th>Total</th><th>${totalF}</th><th>${totalM}</th><th>${totalSemGenero}</th><th>${ativos.length}</th></tr></tfoot></table>`;
}

function salvarRankingDoNivel() {
  if (!filtrosParticipantes.nivel) return;
  const ids = [...$("lista-participantes").querySelectorAll(".participante-item")]
    .map((item) => item.dataset.participanteId);
  const ranking = new Map(ids.map((id, index) => [id, index + 1]));
  participantes.forEach((p) => {
    if (p.nivel === filtrosParticipantes.nivel && ranking.has(p.id)) {
      p.ranking = ranking.get(p.id);
      p.atualizado_em = new Date().toISOString();
    }
  });
  salvarParticipantesLocais();
  renderParticipantes();
}

function gerarMensagemParticipantes() {
  const ordemNiveis = ["C1", "M1", "F1", "M2", "M2F2", "levantadores"];
  const ativos = participantes.filter((p) => p.status === "ativo");
  const grupos = ordemNiveis.map((nivel) => ({
    nivel,
    atletas: ativos
      .filter((p) => (p.pote_sorteio || p.nivel) === nivel)
      .sort((a, b) => (a.ranking || Number.MAX_SAFE_INTEGER) - (b.ranking || Number.MAX_SAFE_INTEGER)),
  })).filter((grupo) => grupo.atletas.length);
  const semNivel = ativos
    .filter((p) => !p.nivel)
    .sort((a, b) => (a.ranking || Number.MAX_SAFE_INTEGER) - (b.ranking || Number.MAX_SAFE_INTEGER));

  const secoes = grupos.map((grupo) => [
    `*${nomePoteSorteio(grupo.nivel)}*`,
    ...grupo.atletas.map((p, index) => `${index + 1}. ${p.nome}`),
  ].join("\n"));
  if (semNivel.length) {
    secoes.push(["*Sem nível definido*", ...semNivel.map((p, index) => `${index + 1}. ${p.nome}`)].join("\n"));
  }
  return ["*Lista de participantes - Vôlei Djalma*", ...secoes].join("\n\n");
}

function gerarMensagemCadastro() {
  const linhas = cadastroAtletas.map((atleta, indice) => `${indice + 1}. ${atleta.nome}${atleta.pote ? ` - ${atleta.pote}` : ""}`);
  return ["*Lista única de nivelamento - Vôlei Djalmer*", ...linhas].join("\n");
}

$("btn-compartilhar-cadastro").addEventListener("click", async () => {
  if (!cadastroAtletas.length) {
    alert("Não há atletas cadastrados para compartilhar.");
    return;
  }
  const mensagem = gerarMensagemCadastro();
  try {
    if (navigator.share) {
      await navigator.share({ text: mensagem });
      return;
    }
    await navigator.clipboard.writeText(mensagem);
  } catch {
    // O WhatsApp continua disponível quando o compartilhamento nativo falha.
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, "_blank");
});

async function editarParticipante(id, alteracoes) {
  try {
    const p = participantes.find((item) => item.id === id);
    if (!p) return;
    const nivelAnterior = p.nivel;
    Object.assign(p, alteracoes, { atualizado_em: new Date().toISOString() });
    normalizarRankings(nivelAnterior);
    normalizarRankings(p.nivel);
    salvarParticipantesLocais();
    await carregarParticipantes();
  } catch (e) {
    alert(e.message);
  }
}

function normalizarRankings(nivel) {
  if (!nivel) return;
  participantes
    .filter((p) => p.nivel === nivel)
    .sort((a, b) => (a.ranking || Number.MAX_SAFE_INTEGER) - (b.ranking || Number.MAX_SAFE_INTEGER) || a.nome.localeCompare(b.nome))
    .forEach((p, index) => { p.ranking = index + 1; });
}

$("btn-compartilhar").addEventListener("click", async () => {
  const mensagem = gerarMensagemParticipantes();
  if (!participantes.some((p) => p.status === "ativo")) {
    alert("Não há participantes ativos para compartilhar.");
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({ text: mensagem });
      return;
    }
    await navigator.clipboard.writeText(mensagem);
  } catch {
    // A abertura do WhatsApp continua disponível mesmo sem clipboard/share.
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, "_blank");
});

$("btn-copiar-lista").addEventListener("click", async () => {
  const ativos = participantes.filter((p) => p.status === "ativo");
  if (!ativos.length) {
    alert("Não há participantes para copiar.");
    return;
  }
  const texto = ativos.map((p, i) => `${i + 1}. ${p.nome}`).join("\n");
  try {
    await navigator.clipboard.writeText(texto);
    $("msg-importar").textContent = "Lista copiada. Cole no campo de importação para recarregar este time.";
    $("msg-importar").className = "msg";
  } catch {
    $("whatsapp-texto").value = texto;
    $("msg-importar").textContent = "Clipboard indisponível: copie manualmente o texto colado no campo de importação.";
    $("msg-importar").className = "msg";
  }
});

$("btn-atualizar-lista").addEventListener("click", () => executarComProgresso("Atualizando lista", async (etapa) => {
    etapa("Atualizando atletas pelo Cadastro permanente...");
    const atualizados = atualizarParticipantesDoCadastro();
    etapa("Validando vagas obrigatórias dos potes...");
    aplicarPotesDoSorteio();
    limparTimesEPresenca();
    const mensagem = `${atualizados} atleta(s) atualizados e potes do sorteio validados. Times e presença anteriores foram limpos.`;
    $("msg-importar").textContent = mensagem;
    $("msg-importar").className = "msg";
    return mensagem;
}));

document.querySelectorAll(".atalho-nivel").forEach((botao) => {
  botao.addEventListener("click", () => {
    filtrosParticipantes.nivel = botao.dataset.nivel;
    document.querySelectorAll(".atalho-nivel").forEach((item) => item.classList.remove("ativo"));
    botao.classList.add("ativo");
    renderParticipantes();
  });
});

document.querySelectorAll(".atalho-sexo").forEach((botao) => {
  botao.addEventListener("click", () => {
    filtrosParticipantes.sexo = botao.dataset.sexo;
    document.querySelectorAll(".atalho-sexo").forEach((item) => item.classList.remove("ativo"));
    botao.classList.add("ativo");
    renderParticipantes();
  });
});

// ---- Times -----------------------------------------------------------
let times = [];
const STORAGE_TIMES = "volei.times.v1";
const STORAGE_PRESENCA = "volei.presenca.v1";
const STORAGE_PONTOS = "volei.pontos.v1";
const STORAGE_PARTIDA_PONTOS = "volei.partida.pontos.v1";
const STORAGE_TOTAL_PONTOS = "volei.total.pontos.v1";
const STORAGE_PARTIDAS_ENCERRADAS = "volei.partidas.encerradas.v1";
const STORAGE_ULTIMO_SORTEIO = "volei.ultimo.sorteio.v1";
let presenca = { assinatura: "", atletas: {}, ordem: [] };
let pontos = [];
let partidaPontos = { timeA: "", timeB: "" };
let registroPonto = null;
let totalPontosPartida = Number(localStorage.getItem(STORAGE_TOTAL_PONTOS) || 25);
if (!Number.isInteger(totalPontosPartida) || totalPontosPartida < 1) totalPontosPartida = 25;
try { partidaPontos = JSON.parse(localStorage.getItem(STORAGE_PARTIDA_PONTOS) || "null") || partidaPontos; } catch { /* Usa a partida padrão. */ }
let partidasEncerradas;
try { partidasEncerradas = JSON.parse(localStorage.getItem(STORAGE_PARTIDAS_ENCERRADAS) || "{}") || {}; } catch { partidasEncerradas = {}; }
if (typeof partidasEncerradas !== "object" || Array.isArray(partidasEncerradas)) partidasEncerradas = {};
let ultimoSorteio = null;
function salvarTimesLocais() { localStorage.setItem(STORAGE_TIMES, JSON.stringify(times)); }

function assinaturaTimes() {
  return times.map((time) => `${time.id}:${time.jogadores.map((p) => p.id).sort().join(",")}`).join("|");
}

function salvarPresenca() { localStorage.setItem(STORAGE_PRESENCA, JSON.stringify(presenca)); }

function reiniciarPresenca() {
  presenca = { assinatura: assinaturaTimes(), atletas: {}, ordem: [] };
  salvarPresenca();
  renderPresenca();
}

function carregarPresenca() {
  try { presenca = JSON.parse(localStorage.getItem(STORAGE_PRESENCA) || "null") || {}; } catch { presenca = {}; }
  if (presenca.assinatura !== assinaturaTimes() || !presenca.atletas || !Array.isArray(presenca.ordem)) {
    presenca = { assinatura: assinaturaTimes(), atletas: {}, ordem: [] };
    salvarPresenca();
  }
  atualizarOrdemPresenca();
  renderPresenca();
}

function salvarPontos() { localStorage.setItem(STORAGE_PONTOS, JSON.stringify(pontos)); }
function salvarPartidaPontos() { localStorage.setItem(STORAGE_PARTIDA_PONTOS, JSON.stringify(partidaPontos)); }
function salvarPartidasEncerradas() { localStorage.setItem(STORAGE_PARTIDAS_ENCERRADAS, JSON.stringify(partidasEncerradas)); }

function atualizarBotaoDesfazerSorteio() {
  $("btn-desfazer-sorteio").disabled = !ultimoSorteio;
}

function salvarUltimoSorteio() {
  if (!times.length) return;
  ultimoSorteio = JSON.parse(JSON.stringify({ participantes, times, presenca, pontos, partidaPontos, partidasEncerradas }));
  localStorage.setItem(STORAGE_ULTIMO_SORTEIO, JSON.stringify(ultimoSorteio));
  atualizarBotaoDesfazerSorteio();
}

function carregarUltimoSorteio() {
  try { ultimoSorteio = JSON.parse(localStorage.getItem(STORAGE_ULTIMO_SORTEIO) || "null"); } catch { ultimoSorteio = null; }
  if (!ultimoSorteio || !Array.isArray(ultimoSorteio.participantes) || !Array.isArray(ultimoSorteio.times)) ultimoSorteio = null;
  atualizarBotaoDesfazerSorteio();
}

function limparTimesPresencaEPontos() {
  limparTimesEPresenca();
  pontos = [];
  partidaPontos = { timeA: "", timeB: "" };
  partidasEncerradas = {};
  registroPonto = null;
  salvarPontos();
  salvarPartidaPontos();
  salvarPartidasEncerradas();
  ultimoSorteio = null;
  localStorage.removeItem(STORAGE_ULTIMO_SORTEIO);
  atualizarBotaoDesfazerSorteio();
  renderPontos();
}

function carregarPontos() {
  try { pontos = JSON.parse(localStorage.getItem(STORAGE_PONTOS) || "[]"); } catch { pontos = []; }
  if (!Array.isArray(pontos)) pontos = [];
  renderPontos();
}

function timePorId(id) { return times.find((time) => time.id === id); }

function nomearTimesPorC1(lista) {
  lista.forEach((time, indice) => {
    const c1 = time.jogadores.find((jogador) => jogador.pote_sorteio === "C1" || jogador.nivel === "C1");
    if (c1?.nome) time.nome = `Time ${c1.nome}`;
    else if (!time.nome || /^Time \d+$/.test(time.nome)) time.nome = `Time ${indice + 1}`;
  });
}

function garantirTimesDaPartida() {
  if (!times.some((time) => time.id === partidaPontos.timeA)) partidaPontos.timeA = times[0]?.id || "";
  if (!times.some((time) => time.id === partidaPontos.timeB) || partidaPontos.timeB === partidaPontos.timeA) {
    partidaPontos.timeB = times.find((time) => time.id !== partidaPontos.timeA)?.id || "";
  }
  salvarPartidaPontos();
}

function limparPontosDaPartida() {
  const chave = chavePartida();
  pontos = pontos.filter((ponto) => ponto.partida !== chave);
  delete partidasEncerradas[chave];
  salvarPontos();
  salvarPartidasEncerradas();
  registroPonto = null;
  renderPontos();
}

function chavePartida() {
  return [partidaPontos.timeA, partidaPontos.timeB].sort().join("|");
}

function pontosDaPartida() {
  const chave = chavePartida();
  return chave ? pontos.filter((ponto) => ponto.partida === chave) : [];
}

function totalPontosDoTime(time, eventos = pontosDaPartida()) {
  return eventos.filter((ponto) => idTimePonto(ponto) === time.id).length;
}

function partidaEncerrada() { return partidasEncerradas[chavePartida()]; }

function atualizarEncerramentoDaPartida() {
  const vencedor = [timePorId(partidaPontos.timeA), timePorId(partidaPontos.timeB)]
    .find((time) => time && totalPontosDoTime(time) >= totalPontosPartida);
  if (vencedor) partidasEncerradas[chavePartida()] = { timeId: vencedor.id };
  else delete partidasEncerradas[chavePartida()];
  salvarPartidasEncerradas();
  return vencedor;
}

function abrirPopupVencedor() {
  const encerramento = partidaEncerrada();
  const vencedor = timePorId(encerramento?.timeId);
  if (!vencedor) return;
  const eventos = pontosDaPartida();
  const pontuadores = resumoAtletasPontos(eventos).filter((atleta) => atleta.timeId === vencedor.id && atleta.total > 0);
  const pontosContra = eventos.filter((ponto) => idTimePonto(ponto) === vencedor.id && ponto.modo === "contra").length;
  const linhas = pontuadores.length
    ? `<div class="tabela-resumo"><table><thead><tr><th>Atleta</th><th>Total</th><th>Saque</th><th>Bloqueio</th><th>Ataque</th></tr></thead><tbody>${pontuadores.map((atleta) => `<tr><th scope="row">${esc(atleta.nome)}</th><td>${atleta.total}</td><td>${atleta.Saque}</td><td>${atleta.Bloqueio}</td><td>${atleta.Ataque}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="msg">Nenhum ponto direto registrado para este time.</p>';
  $("conteudo-vencedor").innerHTML = `<h3 class="time-vencedor">${esc(vencedor.nome)} venceu!</h3><p class="msg">${totalPontosDoTime(vencedor, eventos)} de ${totalPontosPartida} pontos</p>${pontosContra ? `<p class="msg">Pontos por erro adversário: ${pontosContra}</p>` : ""}${linhas}<button id="btn-compartilhar-vencedor" class="primario">Compartilhar partida</button>`;
  $("btn-compartilhar-vencedor").addEventListener("click", compartilharResumoPontos);
  if (!$("popup-vencedor").open) $("popup-vencedor").showModal();
}

async function compartilharResumoPontos() {
  const texto = mensagemResumoPontos();
  try {
    if (navigator.share) {
      await navigator.share({ text: texto });
      return;
    }
    await navigator.clipboard.writeText(texto);
  } catch {
    // O WhatsApp continua disponível quando o compartilhamento nativo falha.
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
}

function iniciarRegistroPonto(timeId) {
  if (partidaEncerrada()) return;
  registroPonto = { timeId, modo: "escolha", atletaId: "" };
  renderPontos();
}

function outroTime(timeId) { return times.find((time) => time.id !== timeId && [partidaPontos.timeA, partidaPontos.timeB].includes(time.id)); }

function idTimePonto(ponto) { return ponto.time_ponto_id || ponto.time_id; }
function nomeTimePonto(ponto) { return ponto.time_ponto_nome || ponto.time_nome; }

function registrarPonto(fundamento) {
  if (partidaEncerrada()) return;
  const timePonto = timePorId(registroPonto?.timeId);
  const timeAtleta = registroPonto?.modo === "contra" ? outroTime(timePonto?.id) : timePonto;
  const atleta = timeAtleta?.jogadores.find((jogador) => jogador.id === registroPonto.atletaId);
  if (!timePonto || !timeAtleta || !atleta) return;
  pontos.push({
    id: novoId(), partida: chavePartida(), time_id: timeAtleta.id, time_nome: timeAtleta.nome,
    time_ponto_id: timePonto.id, time_ponto_nome: timePonto.nome,
    atleta_id: atleta.id, atleta_nome: atleta.nome, fundamento: fundamento || null,
    modo: registroPonto.modo, registrado_em: new Date().toISOString(),
  });
  salvarPontos();
  registroPonto = null;
  const vencedor = atualizarEncerramentoDaPartida();
  renderPontos();
  if (vencedor) abrirPopupVencedor();
}

function resumoAtletasPontos(eventos) {
  const atletas = new Map();
  eventos.forEach((ponto) => {
    if (!atletas.has(ponto.atleta_id)) atletas.set(ponto.atleta_id, { nome: ponto.atleta_nome, time: ponto.time_nome, timeId: ponto.time_id, total: 0, erros: 0, Saque: 0, Bloqueio: 0, Ataque: 0 });
    const resumo = atletas.get(ponto.atleta_id);
    if (ponto.modo === "contra") resumo.erros += 1;
    else {
      resumo.total += 1;
      if (ponto.fundamento in resumo) resumo[ponto.fundamento] += 1;
    }
  });
  return [...atletas.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function mensagemResumoPontos() {
  const timeA = timePorId(partidaPontos.timeA);
  const timeB = timePorId(partidaPontos.timeB);
  const eventos = pontosDaPartida();
  const total = (time) => totalPontosDoTime(time, eventos);
  const atletas = resumoAtletasPontos(eventos);
  const secaoTime = (time) => {
    const atletasDoTime = atletas.filter((atleta) => atleta.timeId === time.id && (atleta.total || atleta.erros));
    const pontosContra = eventos.filter((ponto) => idTimePonto(ponto) === time.id && ponto.modo === "contra").length;
    return [
      `*${time.nome} - ${total(time)} pontos*`,
      ...(atletasDoTime.length ? atletasDoTime.map((atleta) => `${atleta.nome}: ${atleta.total} ponto${atleta.total === 1 ? "" : "s"} (${atleta.Ataque} ataque${atleta.Ataque === 1 ? "" : "s"}, ${atleta.Bloqueio} bloqueio${atleta.Bloqueio === 1 ? "" : "s"}, ${atleta.Saque} saque${atleta.Saque === 1 ? "" : "s"})${atleta.erros ? ` | ${atleta.erros} erro${atleta.erros === 1 ? "" : "s"}` : ""}`) : ["Nenhum registro individual."]),
      ...(pontosContra ? [`Pontos por erro adversário: ${pontosContra}`] : []),
    ].join("\n");
  };
  const destaque = (campo, titulo, unidade) => {
    const maior = Math.max(...atletas.map((atleta) => atleta[campo]), 0);
    if (!maior) return `${titulo}: sem registro`;
    const nomes = atletas.filter((atleta) => atleta[campo] === maior).map((atleta) => atleta.nome).join(" e ");
    return `${titulo}: ${nomes} - ${maior} ${unidade}${maior === 1 ? "" : "s"}`;
  };
  return [
    "*Resumo da partida - Vôlei Djalmer*",
    "",
    secaoTime(timeA),
    "",
    secaoTime(timeB),
    "",
    "*Destaques da partida*",
    destaque("Ataque", "Melhor Atacante", "ataque"),
    destaque("Bloqueio", "Melhor Bloqueador", "bloqueio"),
    destaque("Saque", "Melhor Saque", "saque"),
  ].join("\n");
}

function renderPontos() {
  const seletorA = $("pontos-time-a");
  const seletorB = $("pontos-time-b");
  const botaoA = $("btn-ponto-time-a");
  const botaoB = $("btn-ponto-time-b");
  const botaoReiniciar = $("btn-reiniciar-partida");
  const botaoNova = $("btn-nova-partida");
  const botaoDesfazer = $("btn-desfazer-ponto");
  const mensagem = $("msg-pontos");
  const registro = $("registro-ponto");
  const historico = $("historico-pontos");
  if (!seletorA || !seletorB || !botaoA || !botaoB || !botaoReiniciar || !botaoNova || !botaoDesfazer || !mensagem || !registro || !historico) return;

  garantirTimesDaPartida();
  if (times.length < 2) {
    seletorA.innerHTML = '<option>Times não sorteados</option>';
    seletorB.innerHTML = '<option>Times não sorteados</option>';
    botaoA.disabled = true;
    botaoB.disabled = true;
    botaoReiniciar.disabled = true;
    botaoNova.disabled = true;
    botaoDesfazer.disabled = true;
    mensagem.textContent = "Sorteie os times antes de registrar pontos.";
    registro.hidden = true;
    historico.innerHTML = "";
    return;
  }

  const opcoes = times.map((time) => `<option value="${time.id}">${esc(time.nome)}</option>`).join("");
  seletorA.innerHTML = opcoes;
  seletorB.innerHTML = opcoes;
  seletorA.value = partidaPontos.timeA;
  seletorB.value = partidaPontos.timeB;
  const timeA = timePorId(partidaPontos.timeA);
  const timeB = timePorId(partidaPontos.timeB);
  const encerrada = partidaEncerrada();
  botaoA.disabled = Boolean(encerrada);
  botaoB.disabled = Boolean(encerrada);
  botaoReiniciar.disabled = false;
  botaoNova.disabled = false;
  botaoDesfazer.disabled = !pontosDaPartida().length;
  botaoA.textContent = "Ponto";
  botaoB.textContent = "Ponto";
  mensagem.textContent = encerrada ? `Partida encerrada: ${timePorId(encerrada.timeId)?.nome || "time vencedor"}.` : "Clique no time que pontuou, selecione o atleta e depois o fundamento.";

  if (registroPonto) {
    const time = timePorId(registroPonto.timeId);
    if (!time) registroPonto = null;
    else {
      registro.hidden = false;
      const timeAtletas = registroPonto.modo === "contra" ? outroTime(time.id) : time;
      const atleta = timeAtletas?.jogadores.find((jogador) => jogador.id === registroPonto.atletaId);
      registro.innerHTML = registroPonto.modo === "escolha"
        ? `<h2>Tipo de ponto</h2><div class="opcoes-tipo-ponto"><button class="atleta-presenca" data-modo="direto">Ponto direto</button><button class="atleta-presenca" data-modo="contra">Ponto contra</button></div>`
        : `<h2>${registroPonto.modo === "contra" ? "Quem cometeu o erro?" : `Quem fez o ponto de ${esc(time.nome)}?`}</h2><div class="atletas-presenca atletas-ponto"></div>${atleta && registroPonto.modo === "direto" ? `<h3>Fundamento de ${esc(atleta.nome)}</h3><div class="fundamentos-ponto"><button class="atleta-presenca" data-fundamento="Saque">Saque</button><button class="atleta-presenca" data-fundamento="Bloqueio">Bloqueio</button><button class="atleta-presenca" data-fundamento="Ataque">Ataque</button></div>` : ""}`;
      registro.querySelectorAll("[data-modo]").forEach((botao) => botao.addEventListener("click", () => { registroPonto.modo = botao.dataset.modo; renderPontos(); }));
      const atletas = registro.querySelector(".atletas-ponto");
      (timeAtletas || time).jogadores.forEach((jogador) => {
        const botao = document.createElement("button");
        const selecionado = jogador.id === registroPonto.atletaId;
        botao.className = `atleta-presenca${selecionado ? " presente" : ""}`;
        botao.dataset.pontoAtleta = jogador.id;
        botao.textContent = `${selecionado ? "Selecionado: " : "Selecionar: "}${jogador.nome}`;
        atletas.appendChild(botao);
      });
      registro.querySelectorAll("[data-ponto-atleta]").forEach((botao) => botao.addEventListener("click", () => {
        registroPonto.atletaId = botao.dataset.pontoAtleta;
        if (registroPonto.modo === "contra") registrarPonto();
        else renderPontos();
      }));
      registro.querySelectorAll("[data-fundamento]").forEach((botao) => botao.addEventListener("click", () => registrarPonto(botao.dataset.fundamento)));
    }
  } else {
    registro.hidden = true;
  }

  const eventos = pontosDaPartida();
  const total = (time) => totalPontosDoTime(time, eventos);
  const linhas = resumoAtletasPontos(eventos).map((atleta) => `<tr><th scope="row">${esc(atleta.nome)}<small>${esc(atleta.time)}</small></th><td>${atleta.total}</td><td>${atleta.Saque}</td><td>${atleta.Bloqueio}</td><td>${atleta.Ataque}</td><td>${atleta.erros}</td></tr>`).join("");
  const lances = [...eventos].reverse().map((ponto) => `<li><strong>${esc(nomeTimePonto(ponto))}</strong>: ${ponto.modo === "contra" ? `erro de ${esc(ponto.atleta_nome)}` : `${esc(ponto.atleta_nome)} - ${esc(ponto.fundamento)}`}</li>`).join("");
  historico.innerHTML = `<div class="card historico-pontos"><div class="cabecalho-cadastro"><h2>Histórico da partida</h2><button id="btn-compartilhar-pontos" class="secundario" ${eventos.length ? "" : "disabled"}>Compartilhar resumo</button></div><p class="msg">Meta: ${totalPontosPartida} pontos</p><div class="placar-pontos"><strong>${esc(timeA.nome)} <span>${total(timeA)}</span></strong><strong>${esc(timeB.nome)} <span>${total(timeB)}</span></strong></div>${eventos.length ? `<div class="tabela-resumo"><table><thead><tr><th>Atleta</th><th>Total</th><th>Saque</th><th>Bloqueio</th><th>Ataque</th><th>Erros</th></tr></thead><tbody>${linhas}</tbody></table></div><ul class="lances-pontos">${lances}</ul>` : '<p class="msg">Nenhum ponto registrado nesta partida.</p>'}</div>`;
  $("btn-compartilhar-pontos")?.addEventListener("click", compartilharResumoPontos);
}

$("pontos-time-a").addEventListener("change", () => {
  partidaPontos.timeA = $("pontos-time-a").value;
  garantirTimesDaPartida();
  registroPonto = null;
  renderPontos();
});

$("pontos-time-b").addEventListener("change", () => {
  partidaPontos.timeB = $("pontos-time-b").value;
  garantirTimesDaPartida();
  registroPonto = null;
  renderPontos();
});

$("btn-reiniciar-partida").addEventListener("click", () => {
  if (!confirm("Reiniciar a partida apagará o placar e o histórico atuais. Deseja continuar?")) return;
  limparPontosDaPartida();
});

$("btn-nova-partida").addEventListener("click", () => {
  if (!confirm("Começar partida apagará o placar e o histórico atuais. Deseja continuar?")) return;
  pontos = [];
  salvarPontos();
  const primeiroTime = times[0]?.id || "";
  partidaPontos = { timeA: primeiroTime, timeB: times.find((time) => time.id !== primeiroTime)?.id || "" };
  partidasEncerradas = {};
  salvarPartidaPontos();
  salvarPartidasEncerradas();
  registroPonto = null;
  renderPontos();
});

$("btn-desfazer-ponto").addEventListener("click", () => {
  const eventos = pontosDaPartida();
  if (!eventos.length) return;
  const ultimo = eventos[eventos.length - 1];
  pontos = pontos.filter((ponto) => ponto.id !== ultimo.id);
  salvarPontos();
  if (partidaEncerrada()) {
    delete partidasEncerradas[chavePartida()];
    salvarPartidasEncerradas();
  }
  renderPontos();
});

$("btn-fechar-vencedor").addEventListener("click", () => $("popup-vencedor").close());

$("btn-configurar-pontos").addEventListener("click", () => {
  $("total-pontos-partida").value = totalPontosPartida;
  $("popup-config-pontos").showModal();
});
$("btn-fechar-config-pontos").addEventListener("click", () => $("popup-config-pontos").close());
$("btn-salvar-config-pontos").addEventListener("click", () => {
  const valor = Number($("total-pontos-partida").value);
  if (!Number.isInteger(valor) || valor < 1) { $("msg-config-pontos").textContent = "Informe um total de pontos válido."; return; }
  totalPontosPartida = valor;
  localStorage.setItem(STORAGE_TOTAL_PONTOS, String(valor));
  $("popup-config-pontos").close();
  const vencedor = atualizarEncerramentoDaPartida();
  renderPontos();
  if (vencedor) abrirPopupVencedor();
});

$("btn-ponto-time-a").addEventListener("click", () => iniciarRegistroPonto(partidaPontos.timeA));
$("btn-ponto-time-b").addEventListener("click", () => iniciarRegistroPonto(partidaPontos.timeB));

function timeCompleto(time) {
  return time.jogadores.every((p) => presenca.atletas[p.id]);
}

function atualizarOrdemPresenca() {
  const completos = new Set(times.filter(timeCompleto).map((time) => time.id));
  presenca.ordem = presenca.ordem.filter((id) => completos.has(id));
  times.filter(timeCompleto).forEach((time) => {
    if (!presenca.ordem.includes(time.id)) presenca.ordem.push(time.id);
  });
}

function renderPresenca() {
  const lista = $("lista-presenca");
  if (!lista) return;
  lista.innerHTML = "";
  if (!times.length) {
    lista.innerHTML = '<div class="card">Sorteie os times antes de confirmar a presença.</div>';
    return;
  }
  times.forEach((time) => {
    const presentes = time.jogadores.filter((p) => presenca.atletas[p.id]).length;
    const posicao = presenca.ordem.indexOf(time.id);
    const card = document.createElement("div");
    card.className = "card card-presenca";
    card.innerHTML = `<h3>${esc(time.nome)}</h3><p class="status-presenca">${presentes} de ${time.jogadores.length} presentes</p>${posicao >= 0 ? `<span class="ordem-quadra">TIME ${posicao + 1} EM QUADRA</span>` : ""}<div class="atletas-presenca"></div>`;
    const atletas = card.querySelector(".atletas-presenca");
    time.jogadores.forEach((p) => {
      const botao = document.createElement("button");
      const presente = Boolean(presenca.atletas[p.id]);
      botao.className = `atleta-presenca${presente ? " presente" : ""}`;
      botao.dataset.atleta = p.id;
      botao.textContent = `${presente ? "Presente: " : "Confirmar: "}${p.nome}`;
      atletas.appendChild(botao);
    });
    lista.appendChild(card);
  });
  lista.querySelectorAll("[data-atleta]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const id = botao.dataset.atleta;
      presenca.atletas[id] = !presenca.atletas[id];
      atualizarOrdemPresenca();
      salvarPresenca();
      renderPresenca();
    });
  });
}

$("btn-limpar-dados").addEventListener("click", () => {
  if (!confirm("Deseja limpar a lista atual de participantes, os times e a lista de presença? O Cadastro permanente e o nivelamento não serão apagados.")) return;
  localStorage.removeItem(STORAGE_PARTICIPANTES);
  localStorage.removeItem(STORAGE_TIMES);
  localStorage.removeItem(STORAGE_PRESENCA);
  participantes = [];
  participanteId = new Map();
  times = [];
  presenca = { assinatura: "", atletas: {}, ordem: [] };
  filtrosParticipantes.sexo = "";
  filtrosParticipantes.nivel = "";
  renderParticipantes();
  renderCadastro();
  renderTimes();
  renderPresenca();
  renderPontos();
  document.querySelectorAll(".atalho-nivel").forEach((item) => item.classList.toggle("ativo", item.dataset.nivel === ""));
  document.querySelectorAll(".atalho-sexo").forEach((item) => item.classList.toggle("ativo", item.dataset.sexo === ""));
  $("msg-limpar-dados").textContent = "Lista de participantes, times e presença limpos. Cadastro preservado.";
});

async function carregarTimes() {
  try { times = JSON.parse(localStorage.getItem(STORAGE_TIMES) || "[]"); } catch { times = []; }
  nomearTimesPorC1(times);
  salvarTimesLocais();
  renderTimes();
  carregarPresenca();
  carregarPontos();
}

function renderTimes() {
  const grade = $("lista-times");
  grade.innerHTML = "";
  if (!times.length) {
    grade.innerHTML = '<div class="card">Times ainda não montados.</div>';
    return;
  }
  times.forEach((t) => {
    const card = document.createElement("div");
    card.className = "card card-time";
    card.innerHTML = `<h3>${esc(t.nome)}</h3><div class="media">Média ${t.nivel_medio}</div><ul class="jogadores"></ul>`;
    grade.appendChild(card);
    const ul = card.querySelector(".jogadores");
    t.jogadores.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${esc(p.nome)}</span><span class="pilha-nivel">${nomePoteSorteio(p.pote_sorteio || p.nivel) || "-"}</span>`;
      ul.appendChild(li);
    });
  });
}

function gerarMensagemTimes() {
  const secoes = times.map((time) => [
    `*${time.nome}*`,
    ...time.jogadores.map((p, index) => `${index + 1}. ${p.nome}`),
  ].join("\n"));
  return ["*Times - Vôlei Djalmer*", ...secoes].join("\n\n");
}

$('btn-compartilhar-times').addEventListener("click", async () => {
  if (!times.length) {
    alert("Sorteie os times antes de compartilhar.");
    return;
  }
  const mensagem = gerarMensagemTimes();
  try {
    if (navigator.share) {
      await navigator.share({ text: mensagem });
      return;
    }
    await navigator.clipboard.writeText(mensagem);
  } catch {
    // O WhatsApp continua disponível quando o compartilhamento nativo falha.
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, "_blank");
});

function calcularAtribuicaoPotes(ativos) {
  const metas = { C1: 4, M1: 4, F1: 4, M2: 4, M2F2: 4, levantadores: 4 };
  const categoriaDoPote = (pote) => {
    if (pote === "LM1" || pote === "LF1") return "levantadores";
    if (pote === "F2") return "M2F2";
    return pote;
  };
  const opcoes = new Map(ativos.map((p) => {
    const potes = [p.nivel, ...p.potes_adicionais].filter(Boolean);
    const categorias = potes.flatMap((pote) => categoriaDoPote(pote) === "M2" ? ["M2", "M2F2"] : [categoriaDoPote(pote)]);
    return [p.id, [...new Set(categorias)]];
  }));
  const ordenados = [...ativos].sort((a, b) => opcoes.get(a.id).length - opcoes.get(b.id).length || a.ranking - b.ranking);
  const contagens = Object.fromEntries(Object.keys(metas).map((categoria) => [categoria, 0]));
  const atribuicoes = new Map();
  let tentativas = 0;

  const buscar = (indice) => {
    if (++tentativas > 100000) return false;
    const restantes = ordenados.slice(indice);
    if (Object.entries(metas).some(([categoria, meta]) => contagens[categoria] > meta || contagens[categoria] + restantes.filter((p) => opcoes.get(p.id).includes(categoria)).length < meta)) return false;
    if (indice === ordenados.length) return Object.entries(metas).every(([categoria, meta]) => contagens[categoria] === meta);
    const atleta = ordenados[indice];
    const categoriaPrincipal = categoriaDoPote(atleta.nivel);
    const opcoesOrdenadas = [...opcoes.get(atleta.id)].sort((a, b) => (a === categoriaPrincipal ? -1 : 0) - (b === categoriaPrincipal ? -1 : 0));
    return opcoesOrdenadas.some((categoria) => {
      if (contagens[categoria] >= metas[categoria]) return false;
      atribuicoes.set(atleta.id, categoria);
      contagens[categoria] += 1;
      if (buscar(indice + 1)) return true;
      contagens[categoria] -= 1;
      atribuicoes.delete(atleta.id);
      return false;
    });
  };

  if (!buscar(0)) {
    const diagnostico = Object.keys(metas).map((categoria) => `${categoria}: ${ativos.filter((p) => opcoes.get(p.id).includes(categoria)).length} atleta(s) habilitado(s), mínimo ${metas[categoria]}`);
    throw new Error(`Não foi possível encontrar uma composição válida dos potes autorizados.\n${diagnostico.join("\n")}`);
  }
  return atribuicoes;
}

function criarTimesComRestricoes(ativos) {
  const categorias = ["C1", "M1", "F1", "M2", "M2F2", "levantadores"];
  const forcaGlobal = (p) => ativos.length - p.ranking + 1;
  const embaralhar = (itens) => [...itens].sort(() => Math.random() - 0.5);
  const alvosFemininos = Array(4).fill(Math.floor(ativos.filter((p) => p.sexo === "F").length / 4));
  embaralhar([0, 1, 2, 3]).slice(0, ativos.filter((p) => p.sexo === "F").length % 4).forEach((time) => { alvosFemininos[time] += 1; });
  const porNome = new Map(ativos.map((p) => [normalizarNome(p.nome), p]));
  const unidades = [];
  const usados = new Set();
  const ausentes = [];
  if (sorteioComCasais) {
    casaisConfigurados.forEach((casal, indice) => {
      if (!casaisAtivos[indice]) return;
      const primeiro = porNome.get(normalizarNome(casal[0]));
      const segundo = porNome.get(normalizarNome(casal[1]));
      if (!primeiro || !segundo) { ausentes.push(`${casal[0]} e ${casal[1]}`); return; }
      unidades.push([primeiro, segundo]);
      usados.add(primeiro.id);
      usados.add(segundo.id);
    });
  }
  ativos.filter((p) => !usados.has(p.id)).forEach((p) => unidades.push([p]));
  unidades.sort((a, b) => b.length - a.length || b.reduce((s, p) => s + forcaGlobal(p), 0) - a.reduce((s, p) => s + forcaGlobal(p), 0));

  const timesNovos = [0, 1, 2, 3].map((indice) => ({ id: novoId(), nome: `Time ${indice + 1}`, jogadores: [], nivel_medio: "0.00" }));
  const distribuicao = timesNovos.map(() => Object.fromEntries(categorias.map((categoria) => [categoria, 0])));
  let tentativas = 0;
  const distribuir = (indice) => {
    if (indice === unidades.length) return true;
    if (++tentativas > 100000) return false;
    const unidade = unidades[indice];
    const porCategoria = unidade.reduce((totais, p) => {
      totais[p.pote_sorteio] = (totais[p.pote_sorteio] || 0) + 1;
      return totais;
    }, {});
    const mulheres = unidade.filter((p) => p.sexo === "F").length;
    const candidatos = [0, 1, 2, 3].filter((time) => timesNovos[time].jogadores.length + unidade.length <= 6 &&
      mulheres + timesNovos[time].jogadores.filter((p) => p.sexo === "F").length <= alvosFemininos[time] &&
      Object.entries(porCategoria).every(([categoria, quantidade]) => distribuicao[time][categoria] + quantidade <= 1)
    ).sort((a, b) => {
      const forcaA = timesNovos[a].jogadores.reduce((s, p) => s + forcaGlobal(p), 0);
      const forcaB = timesNovos[b].jogadores.reduce((s, p) => s + forcaGlobal(p), 0);
      return forcaA - forcaB || Math.random() - 0.5;
    });
    return candidatos.some((time) => {
      timesNovos[time].jogadores.push(...unidade);
      Object.entries(porCategoria).forEach(([categoria, quantidade]) => { distribuicao[time][categoria] += quantidade; });
      if (distribuir(indice + 1)) return true;
      timesNovos[time].jogadores.splice(-unidade.length);
      Object.entries(porCategoria).forEach(([categoria, quantidade]) => { distribuicao[time][categoria] -= quantidade; });
      return false;
    });
  };

  if (!distribuir(0)) {
    throw new Error("Não foi possível formar os times respeitando potes, casais e equilíbrio de gênero. Revise as permissões de pote ou desative algum casal.");
  }
  timesNovos.forEach((time) => {
    time.jogadores.sort((a, b) => a.ranking - b.ranking);
    time.nivel_medio = (time.jogadores.reduce((sum, p) => sum + forcaGlobal(p), 0) / 6).toFixed(2);
  });
  nomearTimesPorC1(timesNovos);
  return { times: timesNovos, ausentes };
}

function montarTimesLocais() {
  // 1. Sincroniza nome, sexo, nível e ranking dos 24 ativos com o Cadastro
  atualizarParticipantesDoCadastro();
  const ativos = participantes.filter((p) => p.status === "ativo");
  if (ativos.length !== 24) throw new Error(`São necessários 24 atletas ativos. Atual: ${ativos.length}.`);
  const problemas = [];
  ativos.filter((p) => !p.nivel).forEach((p) => problemas.push(`- ${p.nome}: pote principal não definido no Cadastro.`));
  ativos.filter((p) => !p.sexo).forEach((p) => problemas.push(`- ${p.nome}: sexo não definido no Cadastro.`));
  if (problemas.length) throw new Error(`Não foi possível sortear os times.\n${problemas.join("\n")}`);

  // 2. Seleciona top 4 de cada nível a partir dos 24 ativos da aba Lista
  const top = selecionarTop4PorNivel(ativos);

  // 3. Sorteia em tentativas: casais podem cair em posições inviáveis ou
  //    desequilibrar as mulheres, então reembaralha até fechar os times
  //    com equilíbrio; guarda a melhor tentativa como alternativa.
  let ausentes = [];
  let timesNovos = null;
  let alternativa = null;
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < 100 && !timesNovos; tentativa++) {
    const timesTentativa = [0, 1, 2, 3].map((indice) => ({ id: novoId(), nome: `Time ${indice + 1}`, jogadores: [], nivel_medio: "0.00" }));
    try {
      // Casais ativos: sempre juntos no mesmo time
      let usados = new Set();
      let ausentesT = [];
      if (sorteioComCasais) ({ ausentes: ausentesT, usados } = posicionarCasais(top, timesTentativa));
      // Nivelamento fixo: 1 C1 + 1 Levantador por time, pareando opostos
      preencherNucleoC1Lev(top, timesTentativa, usados);
      // Viabilidade rápida: restantes de cada categoria precisam de vagas
      if (!["M1", "F1", "M2", "F2"].every((c) => {
        const limite = (c === "M2" || c === "F2") ? 2 : 1;
        const restantes = top[c].filter((p) => !timesTentativa.some((t) => t.jogadores.includes(p))).length;
        const vagas = timesTentativa.reduce((s, t) =>
          s + Math.min(limite - t.jogadores.filter((j) => top[c].includes(j)).length, 6 - t.jogadores.length), 0);
        return restantes <= vagas;
      })) throw new Error("Posicionamento dos casais esgotou as vagas de uma categoria.");
      // Sorteia M1, F1, M2 e F2: 1 de cada por time, priorizando o equilíbrio
      distribuirRestantes(top, timesTentativa);
      const variancia = (lista) => {
        const mulheresPorTime = lista.map((t) => t.jogadores.filter((p) => p.sexo === "F").length);
        return Math.max(...mulheresPorTime) - Math.min(...mulheresPorTime);
      };
      if (variancia(timesTentativa) <= 1) {
        timesNovos = timesTentativa;
        ausentes = ausentesT;
      } else if (!alternativa || variancia(timesTentativa) < variancia(alternativa)) {
        alternativa = timesTentativa;
        ausentes = ausentesT;
      }
    } catch (e) {
      ultimoErro = e;
    }
  }
  if (!timesNovos) timesNovos = alternativa;
  if (!timesNovos) {
    throw ultimoErro || new Error("Não foi possível sortear os times. Desative algum casal ou revise os potes.");
  }

  // 4. Registra o pote de sorteio em cada atleta para exibição e desfazer
  Object.entries(top).forEach(([categoria, lista]) => {
    lista.forEach((p) => {
      p.pote_sorteio = categoria === "Levantadores" ? "levantadores" : categoria;
      p.promovido_de = p.nivel && p.nivel !== p.pote_sorteio &&
        !((p.nivel === "LM1" || p.nivel === "LF1") && p.pote_sorteio === "levantadores") ? p.nivel : null;
    });
  });

  // 5. Valida, ordena jogadores por força e calcula a média
  timesNovos.forEach((time) => {
    if (time.jogadores.length !== 6) throw new Error(`Time incompleto: ${time.jogadores.length} de 6 jogadores.`);
    time.jogadores.sort((a, b) => (a.ranking || 999) - (b.ranking || 999));
    time.nivel_medio = (time.jogadores.reduce((sum, p) => sum + (p.ranking || 0), 0) / 6).toFixed(2);
  });
  nomearTimesPorC1(timesNovos);
  salvarParticipantesLocais();
  $("msg-casais").textContent = ausentes.length
    ? `Casais não encontrados: ${ausentes.join(", ")}.`
    : (sorteioComCasais ? "Casais ativos permanecem no mesmo time." : "");
  return timesNovos;
}

$("btn-montar").addEventListener("click", async () => {
  try {
    const novosTimes = montarTimesLocais();
    salvarUltimoSorteio();
    times = novosTimes;
    salvarTimesLocais();
    reiniciarPresenca();
    renderPontos();
    $("msg-montar").textContent = "Times montados com sucesso.";
    $("msg-montar").className = "msg";
    renderTimes();
  } catch (e) {
    $("msg-montar").textContent = e.message;
    $("msg-montar").className = "msg erro";
  }
});

$("btn-desfazer-sorteio").addEventListener("click", () => {
  if (!ultimoSorteio) return;
  participantes = ultimoSorteio.participantes;
  participanteId = new Map(participantes.map((p) => [p.nome, p.id]));
  times = ultimoSorteio.times;
  presenca = ultimoSorteio.presenca;
  pontos = ultimoSorteio.pontos;
  partidaPontos = ultimoSorteio.partidaPontos;
  partidasEncerradas = ultimoSorteio.partidasEncerradas;
  registroPonto = null;
  salvarParticipantesLocais();
  salvarTimesLocais();
  salvarPresenca();
  salvarPontos();
  salvarPartidaPontos();
  salvarPartidasEncerradas();
  ultimoSorteio = null;
  localStorage.removeItem(STORAGE_ULTIMO_SORTEIO);
  atualizarBotaoDesfazerSorteio();
  renderParticipantes();
  renderTimes();
  renderPresenca();
  renderPontos();
  $("msg-montar").textContent = "Sorteio anterior restaurado.";
  $("msg-montar").className = "msg";
});

async function atualizarDados() {
  await Promise.all([carregarParticipantes(), carregarTimes()]);
  $("indicador-sync").textContent = "Local";
}

// ---- Inicialização ---------------------------------------------------
(async function init() {
  carregarCredenciaisDaSessao();
  carregarCadastro();
  carregarUltimoSorteio();
  await atualizarDados();

  // Importar da lista WhatsApp
  $("btn-preview").addEventListener("click", () => {
    const texto = $("whatsapp-texto").value.trim();
    if (!texto) return alert("Cole o texto primeiro.");

    const nomes = extrairTitulares(texto);
    if (!nomes.length) return alert("Nenhum titular encontrado no formato esperado.");

    $("preview-importar").innerHTML = nomes.map((n, i) =>
      `<div class="preview-item">${i + 1}. ${esc(n)}</div>`).join("");
    $("preview-importar").style.display = "block";
    $("btn-confirmar-importar").style.display = "inline-block";
    const timesMensagem = extrairTimes(texto);
    $("msg-importar").textContent = timesMensagem.length >= 2
      ? `${nomes.length} titulares e ${timesMensagem.length} times encontrados. Os times serão restaurados ao confirmar.`
      : `${nomes.length} titulares encontrados.`;
    $("msg-importar").className = "msg";
  });

  $("btn-confirmar-importar").addEventListener("click", async () => {
    const texto = $("whatsapp-texto").value.trim();
    const nomes = extrairTitulares(texto);

    try {
      $("btn-confirmar-importar").disabled = true;
      $("msg-importar").textContent = "Importando e limpando lista anterior...";
      const atletas = nomes.map((nome) => encontrarCadastro(nome));
      const repetidos = atletas.filter(Boolean).filter((atleta, indice, lista) => lista.findIndex((item) => item.id === atleta.id) !== indice);
      if (repetidos.length) throw new Error(`A lista contém nomes vinculados ao mesmo atleta: ${[...new Set(repetidos.map((atleta) => atleta.nome))].join(", ")}.`);
      participantes = atletas.map((atleta, indice) => atleta ? ({
        id: atleta.id,
        cadastro_id: atleta.id,
        nome: atleta.nome,
        sexo: atleta.sexo,
        nivel: atleta.pote || null,
        ranking: cadastroAtletas.findIndex((item) => item.id === atleta.id) + 1,
        potes_adicionais: atleta.potesAdicionais,
        status: "ativo",
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }) : ({
        id: novoId(),
        cadastro_id: null,
        nome: nomes[indice],
        sexo: "",
        nivel: null,
        ranking: null,
        status: "ativo",
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }));
      salvarParticipantesLocais();
      // Mensagem do "Compartilhar times": restaura os times gerados e salvos
      const timesMensagem = extrairTimes(texto);
      let restaurados = 0;
      if (timesMensagem.length >= 2) {
        times = timesMensagem.map((timeMsg) => {
          const jogadores = timeMsg.jogadores
            .map((nome) => participantes.find((p) => normalizarNome(p.nome) === normalizarNome(nome)))
            .filter(Boolean);
          return {
            id: novoId(),
            nome: timeMsg.nome,
            jogadores,
            nivel_medio: jogadores.length
              ? (jogadores.reduce((sum, p) => sum + (p.ranking || 0), 0) / jogadores.length).toFixed(2)
              : "0.00",
          };
        }).filter((time) => time.jogadores.length);
        restaurados = times.length;
        salvarTimesLocais();
      }
      const pendentes = participantes.filter((p) => !p.cadastro_id).length;
      $("msg-importar").textContent = restaurados
        ? `✅ ${nomes.length} importados e ${restaurados} times restaurados.${pendentes ? ` ${pendentes} atleta(s) precisam ser adicionados ao Cadastro.` : ""}`
        : `✅ ${nomes.length} importados localmente.${pendentes ? ` ${pendentes} atleta(s) precisam ser adicionados ao Cadastro.` : ""} Lista anterior removida.`;
      $("msg-importar").className = "msg";
      $("whatsapp-texto").value = "";
      $("preview-importar").style.display = "none";
      $("btn-confirmar-importar").style.display = "none";
      await Promise.all([carregarParticipantes(), carregarTimes()]);
    } catch (e) {
      $("msg-importar").textContent = e.message;
      $("msg-importar").className = "msg erro";
    } finally {
      $("btn-confirmar-importar").disabled = false;
    }
  });

})();
