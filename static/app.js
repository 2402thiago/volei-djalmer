/* App do torneio de vôlei — frontend mobile-first. */

const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async enviar(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

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
        const nome = m[1].trim().replace(/^\(convidado\s+.+\)$/i, "");
        if (nome && !nome.startsWith("(")) titulares.push(nome);
      }
    }
  }
  return titulares.slice(0, 24);
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

const NIVEIS = ["C1", "M1", "M2", "F1", "F2", "LM1", "LF1"];
const STORAGE_CADASTRO = "volei.cadastro.atletas.v1";
const STORAGE_SHEETS_CONECTADO = "volei.sheets.conectado.v1";
let cadastroAtletas = [];
let sheetsConectado = localStorage.getItem(STORAGE_SHEETS_CONECTADO) === "true";
const filtrosCadastro = { nivel: "", sexo: "" };
const ORDEM_CADASTRO = ["C1", "M1", "F1", "M2", "F2", "LM1", "LF1"];

function salvarCadastro() { localStorage.setItem(STORAGE_CADASTRO, JSON.stringify(cadastroAtletas)); }

function payloadCadastro() {
  return { atletas: cadastroAtletas.map((atleta, ordem) => ({ ...atleta, ordem, atualizado_em: new Date().toISOString() })) };
}

function mensagemSheets(texto, erro = false) {
  $("msg-sheets").textContent = texto;
  $("msg-sheets").className = erro ? "msg erro" : "msg";
}

async function executarSheets(acao) {
  try { return await acao(); } catch (erro) { mensagemSheets(erro.message, true); return null; }
}

$("btn-conectar-sheets").addEventListener("click", () => executarSheets(async () => {
  if (!confirm("Conectar apagará todas as abas e dados atuais da planilha Google e criará a aba Nivelamento. Deseja continuar?")) return;
  await api.enviar("/api/nivelamento/conectar", "POST");
  sheetsConectado = true;
  localStorage.setItem(STORAGE_SHEETS_CONECTADO, "true");
  mensagemSheets("Planilha conectada e preparada.");
}));
$("btn-desconectar-sheets").addEventListener("click", () => {
  sheetsConectado = false;
  localStorage.removeItem(STORAGE_SHEETS_CONECTADO);
  mensagemSheets("Google Sheets desconectado neste navegador.");
});
$("btn-sincronizar-sheets").addEventListener("click", () => executarSheets(async () => {
  if (!sheetsConectado) throw new Error("Conecte o Google Sheets antes de sincronizar.");
  const resposta = await api.enviar("/api/nivelamento/sincronizar", "POST", payloadCadastro());
  mensagemSheets(`${resposta.adicionados} novos e ${resposta.atualizados} atualizados na planilha.`);
}));
$("btn-importar-sheets").addEventListener("click", () => executarSheets(async () => {
  if (!sheetsConectado) throw new Error("Conecte o Google Sheets antes de importar.");
  if (!confirm("Importar substituirá o Cadastro local pelos dados da planilha. Deseja continuar?")) return;
  const resposta = await api.get("/api/nivelamento/importar");
  cadastroAtletas = resposta.atletas.sort((a, b) => a.ordem - b.ordem).map(({ ordem, atualizado_em, ...atleta }) => atleta);
  salvarCadastro();
  renderCadastro();
  mensagemSheets(`${cadastroAtletas.length} atletas importados do Google Sheets.`);
}));

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

function migrarCadastroLegado() {
  if (cadastroAtletas.length || !participantes.length) return;
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
    .filter((atleta) => (!filtrosCadastro.nivel || atleta.pote === filtrosCadastro.nivel) && (!filtrosCadastro.sexo || atleta.sexo === filtrosCadastro.sexo))
    .sort((a, b) => ((ORDEM_CADASTRO.indexOf(a.pote) < 0 ? ORDEM_CADASTRO.length : ORDEM_CADASTRO.indexOf(a.pote)) - (ORDEM_CADASTRO.indexOf(b.pote) < 0 ? ORDEM_CADASTRO.length : ORDEM_CADASTRO.indexOf(b.pote))) || (cadastroAtletas.indexOf(a) - cadastroAtletas.indexOf(b)));
  exibidos.forEach((atleta, indice) => {
    const item = document.createElement("div");
    item.className = "atleta-cadastro";
    item.draggable = true;
    item.dataset.cadastroId = atleta.id;
    const opcoes = NIVEIS.map((pote) => `<option value="${pote}" ${atleta.pote === pote ? "selected" : ""}>${pote}</option>`).join("");
    const adicionais = NIVEIS.filter((pote) => pote !== atleta.pote).map((pote) => `<label><input type="checkbox" data-pote-adicional="${pote}" ${atleta.potesAdicionais.includes(pote) ? "checked" : ""} />${pote}</label>`).join("");
    item.innerHTML = `<div class="cabecalho-cadastro"><span>${indice + 1}. <input data-cadastro-nome value="${esc(atleta.nome)}" maxlength="80" /></span><span>Arraste</span></div><div class="linha"><select data-cadastro-sexo><option value="" ${!atleta.sexo ? "selected" : ""}>Sexo</option><option value="F" ${atleta.sexo === "F" ? "selected" : ""}>F</option><option value="M" ${atleta.sexo === "M" ? "selected" : ""}>M</option></select><select data-cadastro-pote><option value="">Pote principal</option>${opcoes}</select></div><div class="det-cadastro">Nomes vinculados: ${atleta.aliases.length ? atleta.aliases.map(esc).join(", ") : "nenhum"}</div><div class="potes-adicionais"><span class="det-cadastro">Também pode atuar em:</span>${adicionais}</div>`;
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
    (!filtrosParticipantes.nivel || p.nivel === filtrosParticipantes.nivel)
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
    item.innerHTML = `
      <div>
        <div class="nome">${esc(p.nome)}</div>
      <div class="det">${p.sexo || "Sexo não definido"} · ${p.nivel || "Pote não definido"} · posição geral ${p.ranking || "não definida"}</div>
      </div>`;
    lista.appendChild(item);
  });
}

function renderResumoParticipantes() {
  const resumo = $("resumo-niveis");
  if (!resumo) return;
  const niveis = ["C1", "M1", "M2", "F1", "F2", "LM1", "LF1"];
  const ativos = participantes.filter((p) => p.status === "ativo");
  const linhas = [...niveis, "Sem nível"];
  const contar = (nivel, sexo) => ativos.filter((p) =>
    (nivel === "__total__" || (nivel === "Sem nível" ? !p.nivel : p.nivel === nivel)) && p.sexo === sexo
  ).length;
  const contarSemGenero = (nivel) => ativos.filter((p) =>
    (nivel === "Sem nível" ? !p.nivel : p.nivel === nivel) && !p.sexo
  ).length;
  const celulas = linhas.map((nivel) => {
    const feminino = contar(nivel, "F");
    const masculino = contar(nivel, "M");
    const semGenero = contarSemGenero(nivel);
    return `<tr><th scope="row">${nivel}</th><td>${feminino}</td><td>${masculino}</td><td>${semGenero}</td><td>${feminino + masculino + semGenero}</td></tr>`;
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
  const ordemNiveis = ["C1", "M1", "M2", "F1", "F2", "LM1", "LF1"];
  const ativos = participantes.filter((p) => p.status === "ativo");
  const grupos = ordemNiveis.map((nivel) => ({
    nivel,
    atletas: ativos
      .filter((p) => p.nivel === nivel)
      .sort((a, b) => (a.ranking || Number.MAX_SAFE_INTEGER) - (b.ranking || Number.MAX_SAFE_INTEGER)),
  })).filter((grupo) => grupo.atletas.length);
  const semNivel = ativos
    .filter((p) => !p.nivel)
    .sort((a, b) => (a.ranking || Number.MAX_SAFE_INTEGER) - (b.ranking || Number.MAX_SAFE_INTEGER));

  const secoes = grupos.map((grupo) => [
    `*${grupo.nivel}*`,
    ...grupo.atletas.map((p, index) => `${index + 1}. ${p.nome}`),
  ].join("\n"));
  if (semNivel.length) {
    secoes.push(["*Sem nível definido*", ...semNivel.map((p, index) => `${index + 1}. ${p.nome}`)].join("\n"));
  }
  return ["*Lista de participantes - Vôlei Djalma*", ...secoes].join("\n\n");
}

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
let presenca = { assinatura: "", atletas: {}, ordem: [] };
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
  if (!confirm("Tem certeza que deseja apagar todos os participantes e times? Essa ação não pode ser desfeita.")) return;
  localStorage.removeItem(STORAGE_PARTICIPANTES);
  localStorage.removeItem(STORAGE_TIMES);
  localStorage.removeItem(STORAGE_CASAIS);
  localStorage.removeItem(STORAGE_CASAIS_ATIVOS);
  localStorage.removeItem(STORAGE_CASAIS_CONFIG);
  localStorage.removeItem(STORAGE_PRESENCA);
  localStorage.removeItem(STORAGE_CADASTRO);
  localStorage.removeItem(STORAGE_SHEETS_CONECTADO);
  participantes = [];
  participanteId = new Map();
  times = [];
  presenca = { assinatura: "", atletas: {}, ordem: [] };
  sorteioComCasais = false;
  casaisConfigurados = CASAIS_PADRAO.map((casal) => [...casal]);
  casaisAtivos = casaisConfigurados.map(() => true);
  cadastroAtletas = [];
  sheetsConectado = false;
  atualizarBotaoCasais();
  filtrosParticipantes.sexo = "";
  filtrosParticipantes.nivel = "";
  renderParticipantes();
  renderCadastro();
  renderTimes();
  renderPresenca();
  document.querySelectorAll(".atalho-nivel").forEach((item) => item.classList.toggle("ativo", item.dataset.nivel === ""));
  document.querySelectorAll(".atalho-sexo").forEach((item) => item.classList.toggle("ativo", item.dataset.sexo === ""));
  $("msg-limpar-dados").textContent = "Todos os dados foram apagados.";
});

async function carregarTimes() {
  try { times = JSON.parse(localStorage.getItem(STORAGE_TIMES) || "[]"); } catch { times = []; }
  renderTimes();
  carregarPresenca();
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
      li.innerHTML = `<span>${esc(p.nome)}</span><span class="pilha-nivel">${p.nivel || "-"}</span>`;
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

function montarTimesLocais() {
  const ativos = participantes.filter((p) => p.status === "ativo");
  const problemas = [];
  if (ativos.length !== 24) problemas.push(`- Atletas ativos: ${ativos.length}; são necessários 24.`);
  const cadastroPorId = new Map(cadastroAtletas.map((atleta, indice) => [atleta.id, { atleta, indice }]));
  ativos.forEach((p) => {
    const registro = cadastroPorId.get(p.id);
    if (!registro) { problemas.push(`- ${p.nome}: atleta não cadastrado.`); return; }
    p.nome = registro.atleta.nome;
    p.sexo = registro.atleta.sexo;
    p.nivel = registro.atleta.pote || null;
    p.potes_adicionais = registro.atleta.potesAdicionais;
    p.ranking = registro.indice + 1;
  });
  ativos.filter((p) => !p.nivel).forEach((p) => problemas.push(`- ${p.nome}: pote principal não definido no Cadastro.`));
  ativos.filter((p) => !p.sexo).forEach((p) => problemas.push(`- ${p.nome}: sexo não definido no Cadastro.`));
  if (problemas.length) throw new Error(`Não foi possível sortear os times.\n${problemas.join("\n")}`);

  const forcaNivel = { C1: 7, M1: 6, M2: 5, F1: 4, F2: 3, LM1: 2, LF1: 1 };
  ["C1", "M1", "F1"].forEach((pote) => {
    const falta = 4 - ativos.filter((p) => p.nivel === pote).length;
    if (falta <= 0) return;
    const candidatos = ativos.filter((p) => p.nivel === "M2" && p.potes_adicionais.includes(pote)).sort((a, b) => a.ranking - b.ranking);
    if (candidatos.length < falta) {
      throw new Error(`Não foi possível completar o pote ${pote}.\nFaltam ${falta} atleta(s) M2 com permissão para atuar em ${pote}.`);
    }
    candidatos.slice(0, falta).forEach((p) => { p.nivel = pote; p.promovido_de = "M2"; });
  });
  const forcaGlobal = (p) => ativos.length - p.ranking + 1;
  const potes = ["C1", "M1", "F1"].map((nivel) =>
    ativos.filter((p) => p.nivel === nivel).sort((a, b) => a.ranking - b.ranking)
  );
  const m2f2 = ativos
    .filter((p) => p.nivel === "M2" || p.nivel === "F2")
    .sort((a, b) => forcaNivel[b.nivel] - forcaNivel[a.nivel] || a.ranking - b.ranking);
  if (![4, 8, 12].includes(m2f2.length)) {
    throw new Error(`Não foi possível sortear os times.\nM2 + F2 precisam totalizar 4, 8 ou 12 atletas. Quantidade atual: ${m2f2.length}.`);
  }
  potes.push(m2f2);
  const levantadores = ativos
    .filter((p) => p.nivel === "LM1" || p.nivel === "LF1")
    .sort((a, b) => a.ranking - b.ranking);
  potes.push(levantadores);
  const faltantes = ["C1", "M1", "F1"].filter((nivel, index) => potes[index].length < 4);
  if (faltantes.length) throw new Error(`Não foi possível sortear os times.\nPotes com menos de 4 atletas: ${faltantes.join(", ")}.`);
  const novos = [0, 1, 2, 3].map((indice) => ({ id: novoId(), nome: `Time ${indice + 1}`, jogadores: [], nivel_medio: "0.00" }));
  if (!sorteioComCasais) {
    potes.forEach((pote) => {
      const inicio = Math.floor(Math.random() * 4);
      pote.forEach((atleta, index) => novos[(inicio + index) % 4].jogadores.push(atleta));
    });
  } else {
    const porNome = new Map(ativos.map((p) => [normalizarNome(p.nome), p]));
    const unidades = [];
    const usados = new Set();
    const ausentes = [];
    casaisConfigurados.forEach((casal, indice) => {
      if (!casaisAtivos[indice]) return;
      const primeiro = porNome.get(normalizarNome(casal[0]));
      const segundo = porNome.get(normalizarNome(casal[1]));
      if (!primeiro || !segundo) { ausentes.push(`${casal[0]} e ${casal[1]}`); return; }
      unidades.push([primeiro, segundo]);
      usados.add(primeiro.id); usados.add(segundo.id);
    });
    ativos.filter((p) => !usados.has(p.id)).forEach((p) => unidades.push([p]));
    const categoria = (p) => {
      if (p.nivel === "M2" || p.nivel === "F2") return "M2F2";
      if (p.nivel === "LM1" || p.nivel === "LF1") return "levantadores";
      return p.nivel;
    };
    const embaralhar = (itens) => [...itens].sort(() => Math.random() - 0.5);
    const metas = {};
    const grupos = ["C1", "M1", "F1", "M2F2", "levantadores"];
    const totaisPorTime = Array(4).fill(0);
    grupos.forEach((grupo) => {
      const total = ativos.filter((p) => categoria(p) === grupo).length;
      metas[grupo] = Array(4).fill(Math.floor(total / 4));
      totaisPorTime.forEach((_, time) => { totaisPorTime[time] += metas[grupo][time]; });
    });
    embaralhar(grupos).forEach((grupo) => {
      const total = ativos.filter((p) => categoria(p) === grupo).length;
      const escolhidos = new Set();
      for (let extra = 0; extra < total % 4; extra += 1) {
        const menorTotal = Math.min(...totaisPorTime.filter((_, time) => !escolhidos.has(time)));
        const candidatos = embaralhar([0, 1, 2, 3].filter((time) => !escolhidos.has(time) && totaisPorTime[time] === menorTotal));
        const time = candidatos[0];
        metas[grupo][time] += 1;
        totaisPorTime[time] += 1;
        escolhidos.add(time);
      }
    });
    const distribuicao = novos.map(() => ({ C1: 0, M1: 0, F1: 0, M2F2: 0, levantadores: 0 }));
    unidades.sort((a, b) => b.length - a.length || b.reduce((s, p) => s + forcaGlobal(p), 0) - a.reduce((s, p) => s + forcaGlobal(p), 0));
    let tentativas = 0;
    const distribuir = (indice) => {
      if (indice === unidades.length) return true;
      if (++tentativas > 100000) return false;
      const unidade = unidades[indice];
      const porGrupo = unidade.reduce((totais, p) => {
        const grupo = categoria(p);
        totais[grupo] = (totais[grupo] || 0) + 1;
        return totais;
      }, {});
      const candidatos = [0, 1, 2, 3].filter((time) => novos[time].jogadores.length + unidade.length <= 6 &&
        Object.entries(porGrupo).every(([grupo, quantidade]) => distribuicao[time][grupo] + quantidade <= metas[grupo][time])
      ).sort((a, b) => {
        const forcaA = novos[a].jogadores.reduce((s, p) => s + forcaGlobal(p), 0);
        const forcaB = novos[b].jogadores.reduce((s, p) => s + forcaGlobal(p), 0);
        return forcaA - forcaB || Math.random() - 0.5;
      });
      return candidatos.some((time) => {
        novos[time].jogadores.push(...unidade);
        Object.entries(porGrupo).forEach(([grupo, quantidade]) => { distribuicao[time][grupo] += quantidade; });
        if (distribuir(indice + 1)) return true;
        novos[time].jogadores.splice(-unidade.length);
        Object.entries(porGrupo).forEach(([grupo, quantidade]) => { distribuicao[time][grupo] -= quantidade; });
        return false;
      });
    };
    if (!distribuir(0)) {
      throw new Error('Não foi possível sortear mantendo os casais ativos e o nivelamento dos potes.\nRevise os casais em "Editar casais" e desative algum casal para continuar.');
    }
    $("msg-casais").textContent = ausentes.length ? `Casais não encontrados: ${ausentes.join(", ")}.` : "Casais ativos permanecem no mesmo time.";
  }
  if (novos.some((time) => time.jogadores.length !== 6)) {
    throw new Error(`Não foi possível sortear os times.\nDistribuição final: ${novos.map((time) => `${time.nome}: ${time.jogadores.length} atletas`).join(", ")}.`);
  }
  novos.forEach((time) => {
    time.jogadores.sort((a, b) => forcaNivel[b.nivel] - forcaNivel[a.nivel] || a.ranking - b.ranking);
    time.nivel_medio = (time.jogadores.reduce((sum, p) => sum + forcaGlobal(p), 0) / 6).toFixed(2);
  });
  return novos;
}

$("btn-montar").addEventListener("click", async () => {
  try {
    times = montarTimesLocais();
    salvarTimesLocais();
    reiniciarPresenca();
    $("msg-montar").textContent = "Times montados com sucesso.";
    $("msg-montar").className = "msg";
    renderTimes();
  } catch (e) {
    $("msg-montar").textContent = e.message;
    $("msg-montar").className = "msg erro";
  }
});

async function atualizarDados() {
  await Promise.all([carregarParticipantes(), carregarTimes()]);
  $("indicador-sync").textContent = "Local";
}

// ---- Inicialização ---------------------------------------------------
(async function init() {
  carregarCadastro();
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
    $("msg-importar").textContent = `${nomes.length} titulares encontrados.`;
    $("msg-importar").className = "msg";
  });

  $("btn-confirmar-importar").addEventListener("click", async () => {
    const texto = $("whatsapp-texto").value.trim();
    const nomes = extrairTitulares(texto);

    try {
      $("btn-confirmar-importar").disabled = true;
      $("msg-importar").textContent = "Importando e limpando lista anterior...";
      const semCadastro = nomes.filter((nome) => !encontrarCadastro(nome));
      if (semCadastro.length) throw new Error(`Nomes sem cadastro: ${semCadastro.join(", ")}. Cadastre ou vincule esses nomes antes de importar.`);
      const atletas = nomes.map((nome) => encontrarCadastro(nome));
      const repetidos = atletas.filter((atleta, indice) => atletas.findIndex((item) => item.id === atleta.id) !== indice);
      if (repetidos.length) throw new Error(`A lista contém nomes vinculados ao mesmo atleta: ${[...new Set(repetidos.map((atleta) => atleta.nome))].join(", ")}.`);
      participantes = atletas.map((atleta) => ({
        id: atleta.id,
        nome: atleta.nome,
        sexo: atleta.sexo,
        nivel: atleta.pote || null,
        ranking: cadastroAtletas.findIndex((item) => item.id === atleta.id) + 1,
        potes_adicionais: atleta.potesAdicionais,
        status: "ativo",
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }));
      salvarParticipantesLocais();
      $("msg-importar").textContent = `✅ ${nomes.length} importados localmente. Lista anterior removida.`;
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
