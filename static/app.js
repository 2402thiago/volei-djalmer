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
  });
});

// ---- Participantes ---------------------------------------------------
let participantes = [];
let participanteId = new Map();
const filtrosParticipantes = { sexo: "", nivel: "" };

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
  renderParticipantes();
}

function renderParticipantes() {
  const lista = $("lista-participantes");
  lista.innerHTML = "";
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
    item.draggable = Boolean(filtrosParticipantes.nivel && p.nivel === filtrosParticipantes.nivel);
    item.dataset.participanteId = p.id;
    item.innerHTML = `
      <div>
        <div class="nome">${esc(p.nome)}</div>
        <div class="det">${p.sexo || "Sexo não definido"} · ${p.nivel || "Nível não definido"} · ${p.ranking ? `${p.ranking}º` : "Ranking não definido"}</div>
      </div>
      <div class="acoes">
        <input class="edicao-nome" data-nome="${p.id}" value="${esc(p.nome)}" maxlength="80" title="Nome" />
        <select data-sexo="${p.id}" title="Sexo">
          <option value="" ${!p.sexo ? "selected" : ""}>Sexo</option>
          <option value="F" ${p.sexo === "F" ? "selected" : ""}>F</option>
          <option value="M" ${p.sexo === "M" ? "selected" : ""}>M</option>
        </select>
        <select data-nivel="${p.id}" title="Nível">
          <option value="" ${!p.nivel ? "selected" : ""}>Nível</option>
          <option value="C1" ${p.nivel === "C1" ? "selected" : ""}>C1</option>
          <option value="M1" ${p.nivel === "M1" ? "selected" : ""}>M1</option>
          <option value="M2" ${p.nivel === "M2" ? "selected" : ""}>M2</option>
          <option value="F1" ${p.nivel === "F1" ? "selected" : ""}>F1</option>
          <option value="F2" ${p.nivel === "F2" ? "selected" : ""}>F2</option>
          <option value="LM1" ${p.nivel === "LM1" ? "selected" : ""}>LM1</option>
          <option value="LF1" ${p.nivel === "LF1" ? "selected" : ""}>LF1</option>
        </select>
        <input class="edicao-ranking" data-ranking="${p.id}" type="number" min="1" placeholder="#" value="${p.ranking || ""}" title="Ranking no nível" />
      </div>`;
    lista.appendChild(item);
  });

  lista.querySelectorAll("[data-nome]").forEach((input) => {
    input.addEventListener("change", () => editarParticipante(input.dataset.nome, { nome: input.value }));
  });
  lista.querySelectorAll("[data-sexo]").forEach((select) => {
    select.addEventListener("change", () => editarParticipante(select.dataset.sexo, { sexo: select.value }));
  });
  lista.querySelectorAll("[data-nivel]").forEach((select) => {
    select.addEventListener("change", () => editarParticipante(select.dataset.nivel, { nivel: select.value }));
  });
  lista.querySelectorAll("[data-ranking]").forEach((input) => {
    input.addEventListener("change", () => editarParticipante(input.dataset.ranking, { ranking: input.value }));
  });

  if (filtrosParticipantes.nivel) {
    let marcadorArraste = null;
    lista.querySelectorAll(".participante-item[draggable='true']").forEach((item) => {
      item.addEventListener("dragstart", (event) => {
        item.classList.add("arrastando");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.dataset.participanteId);
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("arrastando");
        marcadorArraste?.remove();
        marcadorArraste = null;
        lista.querySelectorAll(".alvo-arraste").forEach((alvo) => alvo.classList.remove("alvo-arraste"));
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        const origem = lista.querySelector(".arrastando");
        if (!origem || origem === item) return;
        const rect = item.getBoundingClientRect();
        const depois = event.clientY > rect.top + rect.height / 2;
        if (!marcadorArraste) {
          marcadorArraste = document.createElement("div");
          marcadorArraste.className = "marcador-arraste";
          marcadorArraste.textContent = depois ? "Soltar abaixo" : "Soltar acima";
        }
        marcadorArraste.textContent = depois ? "Soltar abaixo" : "Soltar acima";
        item.classList.add("alvo-arraste");
        if (depois) item.after(marcadorArraste);
        else item.before(marcadorArraste);
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        const origem = lista.querySelector(".arrastando");
        if (!origem || origem === item) return;
        const rect = item.getBoundingClientRect();
        const depois = event.clientY > rect.top + rect.height / 2;
        if (depois) item.after(origem);
        else item.before(origem);
        marcadorArraste?.remove();
        marcadorArraste = null;
        item.classList.remove("alvo-arraste");
        salvarRankingDoNivel();
      });
    });
  }
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

$("btn-adicionar").addEventListener("click", async () => {
  const nome = $("novo-nome").value.trim();
  const sexo = $("novo-sexo").value;
  const nivel = $("novo-nivel").value || null;
  if (!nome) return;
  try {
    participantes.push({ id: novoId(), nome, sexo, nivel, ranking: null, status: "ativo", criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
    salvarParticipantesLocais();
    $("novo-nome").value = "";
    await Promise.all([carregarParticipantes(), carregarTimes()]);
  } catch (e) {
    alert(e.message);
  }
});

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
function salvarTimesLocais() { localStorage.setItem(STORAGE_TIMES, JSON.stringify(times)); }

async function carregarTimes() {
  try { times = JSON.parse(localStorage.getItem(STORAGE_TIMES) || "[]"); } catch { times = []; }
  renderTimes();
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

function montarTimesLocais() {
  const ativos = participantes.filter((p) => p.status === "ativo");
  if (ativos.length !== 24) throw new Error(`É necessário ter exatamente 24 atletas ativos. Atual: ${ativos.length}.`);
  const pendencias = ativos.filter((p) => !p.nivel || !p.ranking);
  if (pendencias.length) throw new Error(`Há atletas sem nível ou ranking: ${pendencias.map((p) => p.nome).join(", ")}.`);
  const niveis = ["C1", "M1", "M2", "F1", "F2", "LM1", "LF1"];
  const forcaNivel = { C1: 7, M1: 6, M2: 5, F1: 4, F2: 3, LM1: 2, LF1: 1 };
  const potes = niveis.map((nivel) => ativos.filter((p) => p.nivel === nivel).sort((a, b) => a.ranking - b.ranking));
  const faltantes = ["C1", "M1", "M2", "F1", "F2"].filter((nivel) => potes[niveis.indexOf(nivel)].length < 4);
  if (faltantes.length) throw new Error(`Potes com menos de 4 atletas: ${faltantes.join(", ")}.`);
  const novos = [0, 1, 2, 3].map((indice) => ({ id: novoId(), nome: `Time ${indice + 1}`, jogadores: [], nivel_medio: "0.00" }));
  potes.forEach((pote) => pote.forEach((atleta, index) => {
    novos[index % 4].jogadores.push(atleta);
  }));
  if (novos.some((time) => time.jogadores.length !== 6)) throw new Error("Não foi possível formar 4 times com 6 atletas.");
  novos.forEach((time) => {
    time.jogadores.sort((a, b) => forcaNivel[b.nivel] - forcaNivel[a.nivel] || a.ranking - b.ranking);
    time.nivel_medio = (time.jogadores.reduce((sum, p) => sum + forcaNivel[p.nivel], 0) / 6).toFixed(2);
  });
  return novos;
}

$("btn-montar").addEventListener("click", async () => {
  try {
    times = montarTimesLocais();
    salvarTimesLocais();
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
      participantes = nomes.map((nome) => ({ id: novoId(), nome, sexo: "", nivel: null, ranking: null, status: "ativo", criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }));
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
