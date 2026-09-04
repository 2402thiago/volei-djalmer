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

// ---- Navegação entre telas -------------------------------------------
document.querySelectorAll(".aba").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("ativa"));
    document.querySelectorAll(".tela").forEach((t) => t.classList.remove("ativa"));
    btn.classList.add("ativa");
    $("participantes").classList.remove("ativa");
    document.getElementById(btn.dataset.tela).classList.add("ativa");
  });
});

// ---- Participantes ---------------------------------------------------
let participantes = [];
let participanteId = new Map();

async function carregarParticipantes() {
  participantes = await api.get("/api/participantes");
  participanteId = new Map(participantes.map((p) => [p.nome, p.id]));
  renderParticipantes();
}

function renderParticipantes() {
  const lista = $("lista-participantes");
  lista.innerHTML = "";
  if (!participantes.length) {
    lista.innerHTML = '<div class="card">Nenhum participante ainda. Adicione acima.</div>';
    return;
  }
  participantes.forEach((p) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <div class="nome">${esc(p.nome)}</div>
        <div class="det">Nível: ${p.nivel} · ${p.status}</div>
      </div>
      <div class="acoes">
        <select data-status="${p.id}" title="Status">
          <option value="ativo" ${p.status === "ativo" ? "selected" : ""}>Ativo</option>
          <option value="inativo" ${p.status === "inativo" ? "selected" : ""}>Inativo</option>
        </select>
        <button class="ponto" data-nivel="${p.id}" data-atual="${p.nivel}" title="Editar nível">${p.nivel}</button>
      </div>`;
    lista.appendChild(item);
  });

  lista.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await api.enviar(`/api/participantes/${sel.dataset.status}/status`, "PATCH", { status: sel.value });
      await carregarParticipantes();
    });
  });
  lista.querySelectorAll("[data-nivel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const novo = Number(prompt("Novo nível (1–5):", btn.dataset.atual));
      if (novo >= 1 && novo <= 5) {
        await api.enviar(`/api/participantes/${btn.dataset.nivel}`, "PATCH", { nivel: novo });
        await carregarParticipantes();
      }
    });
  });
}

$("btn-adicionar").addEventListener("click", async () => {
  const nome = $("novo-nome").value.trim();
  const nivel = Number($("novo-nivel").value);
  if (!nome) return;
  try {
    await api.enviar("/api/participantes", "POST", { nome, nivel });
    $("novo-nome").value = "";
    await Promise.all([carregarParticipantes(), carregarTimes()]);
  } catch (e) {
    alert(e.message);
  }
});

// ---- Times -----------------------------------------------------------
let times = [];

async function carregarTimes() {
  times = await api.get("/api/times");
  renderTimes();
  preencherSeletores();
}

function renderTimes() {
  const grade = $("lista-times");
  grade.innerHTML = "";
  if (!times.length) {
    grade.innerHTML = '<div class="card">Times ainda não montados.</div>';
    return;
  }
  times.forEach(async (t) => {
    const card = document.createElement("div");
    card.className = "card card-time";
    card.innerHTML = `<h3>${esc(t.nome)}</h3><div class="media">Média ${t.nivel_medio}</div><ul class="jogadores"></ul>`;
    grade.appendChild(card);
    const comp = await api.get(`/api/times/${t.id}/composicao`);
    const ul = card.querySelector(".jogadores");
    comp.participantes.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${esc(p.nome)}</span><span class="pilha-nivel">${p.nivel}</span>`;
      ul.appendChild(li);
    });
  });
}

$("btn-montar").addEventListener("click", async () => {
  const numTimes = Number($("num-times").value);
  try {
    await api.enviar("/api/times/montar", "POST", { num_times: numTimes });
    $("msg-montar").textContent = "Times montados com sucesso.";
    $("msg-montar").className = "msg";
    await carregarTimes();
  } catch (e) {
    $("msg-montar").textContent = e.message;
    $("msg-montar").className = "msg erro";
  }
});

// ---- Partida ---------------------------------------------------------
let partidaAtual = null;

function preencherSeletores() {
  const selA = $("partida-a");
  const selB = $("partida-b");
  const opcoes = times.map((t) => `<option value="${t.id}">${esc(t.nome)}</option>`).join("");
  selA.innerHTML = opcoes;
  selB.innerHTML = opcoes;
}

async function criarPartida() {
  const a = $("partida-a").value;
  const b = $("partida-b").value;
  if (!a || !b) return;
  try {
    partidaAtual = await api.enviar("/api/partidas", "POST", { time_a_id: a, time_b_id: b });
    atualizarPlacarUI();
  } catch (e) {
    alert(e.message);
  }
}

$("btn-nova-partida").addEventListener("click", criarPartida);

document.querySelectorAll(".pontos button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!partidaAtual) return;
    partidaAtual = await api.enviar(
      `/api/partidas/${partidaAtual.id}/placar`, "PATCH",
      { time: btn.dataset.time, delta: Number(btn.dataset.delta) }
    );
    atualizarPlacarUI();
  });
});

function atualizarPlacarUI() {
  if (!partidaAtual) {
    $("nome-a").textContent = "—";
    $("nome-b").textContent = "—";
    $("pontos-a").textContent = "0";
    $("pontos-b").textContent = "0";
    $("btn-concluir").disabled = true;
    return;
  }
  const timeA = times.find((t) => t.id === partidaAtual.time_a_id);
  const timeB = times.find((t) => t.id === partidaAtual.time_b_id);
  $("nome-a").textContent = timeA ? timeA.nome : "Time A";
  $("nome-b").textContent = timeB ? timeB.nome : "Time B";
  $("pontos-a").textContent = partidaAtual.placar_a;
  $("pontos-b").textContent = partidaAtual.placar_b;
  $("btn-concluir").disabled = false;
}

$("btn-concluir").addEventListener("click", async () => {
  if (!partidaAtual) return;
  await api.enviar(`/api/partidas/${partidaAtual.id}/status`, "PATCH", { status: "concluida" });
  partidaAtual = null;
  await carregarHistorico();
  atualizarPlacarUI();
});

// ---- Histórico -------------------------------------------------------
async function carregarHistorico() {
  const [classificacao, partidas] = await Promise.all([
    api.get("/api/classificacao"),
    api.get("/api/partidas"),
  ]);
  const nomes = new Map(times.map((t) => [t.id, t.nome]));

  const cLista = $("classificacao");
  cLista.innerHTML = classificacao.length
    ? classificacao.map((c, i) => `
        <div class="item">
          <span class="posicao">${i + 1}º</span>
          <span class="nome">${esc(nomes.get(c.time_id) || c.time_id)}</span>
          <span class="det">${c.vitorias}V · ${c.pontos}pts</span>
        </div>`).join("")
    : '<div class="card">Nenhuma partida concluída.</div>';

  const pLista = $("lista-partidas");
  pLista.innerHTML = partidas.length
    ? partidas.map((p) => `
        <div class="item">
          <span class="nome">${esc(nomes.get(p.time_a_id) || "?")} ${p.placar_a} × ${p.placar_b} ${esc(nomes.get(p.time_b_id) || "?")}</span>
          <span class="det">${p.status_partida}</span>
        </div>`).join("")
    : '<div class="card">Nenhuma partida registrada.</div>';
}

// ---- Sincronização ---------------------------------------------------
// A planilha é a fonte única de dados. O navegador recarrega as listas
// periodicamente para refletir edições feitas manualmente na planilha.
const INTERVALO_REFRESH_MS = 30000;

async function atualizarDados() {
  try {
    await Promise.all([
      carregarParticipantes(), carregarTimes(), carregarHistorico(),
    ]);
    atualizarPlacarUI();
    $("indicador-sync").textContent = "Sincronizado";
  } catch {
    $("indicador-sync").textContent = "Offline";
  }
}

// ---- Inicialização ---------------------------------------------------
(async function init() {
  await atualizarDados();
  setInterval(atualizarDados, INTERVALO_REFRESH_MS);
})();