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
  ));
  $("contador-filtros").textContent = `${exibidos.length} de ${participantes.length} participantes`;
  if (!exibidos.length) {
    lista.innerHTML = '<div class="card">Nenhum participante ainda. Adicione acima.</div>';
    return;
  }
  exibidos.forEach((p) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <div class="nome">${esc(p.nome)}</div>
        <div class="det">${p.sexo || "Sexo não definido"} · ${p.nivel || "Nível não definido"} · ${p.ranking ? `${p.ranking}º` : "Ranking não definido"} · ${p.status}</div>
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
        <select data-status="${p.id}" title="Status">
          <option value="ativo" ${p.status === "ativo" ? "selected" : ""}>Ativo</option>
          <option value="inativo" ${p.status === "inativo" ? "selected" : ""}>Inativo</option>
        </select>
        <button class="remover" data-id="${p.id}" title="Remover">🗑️</button>
      </div>`;
    lista.appendChild(item);
  });

  lista.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const p = participantes.find((item) => item.id === sel.dataset.status);
      if (p) { p.status = sel.value; p.atualizado_em = new Date().toISOString(); salvarParticipantesLocais(); }
      await carregarParticipantes();
    });
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

  lista.querySelectorAll(".remover[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remover este participante?")) return;
      participantes = participantes.filter((item) => item.id !== btn.dataset.id);
      salvarParticipantesLocais();
      await carregarParticipantes();
    });
  });
}

async function editarParticipante(id, alteracoes) {
  try {
    const p = participantes.find((item) => item.id === id);
    if (!p) return;
    Object.assign(p, alteracoes, { atualizado_em: new Date().toISOString() });
    salvarParticipantesLocais();
    await carregarParticipantes();
  } catch (e) {
    alert(e.message);
  }
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

$("filtro-sexo").addEventListener("change", (event) => {
  filtrosParticipantes.sexo = event.target.value;
  renderParticipantes();
});

$("filtro-nivel").addEventListener("change", (event) => {
  filtrosParticipantes.nivel = event.target.value;
  renderParticipantes();
});

$("btn-limpar-filtros").addEventListener("click", () => {
  filtrosParticipantes.sexo = "";
  filtrosParticipantes.nivel = "";
  $("filtro-sexo").value = "";
  $("filtro-nivel").value = "";
  renderParticipantes();
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

  $("btn-sincronizar").addEventListener("click", async () => {
    try {
      $("btn-sincronizar").disabled = true;
      $("msg-sincronizar").textContent = "Sincronizando...";
      const r = await api.enviar("/api/participantes/sincronizar", "POST", { participantes });
      $("msg-sincronizar").textContent = `${r.sincronizados} participantes enviados para a planilha.`;
    } catch (e) {
      $("msg-sincronizar").textContent = `Falha na sincronização: ${e.message}`;
      $("msg-sincronizar").className = "msg erro";
    } finally {
      $("btn-sincronizar").disabled = false;
    }
  });

  $("btn-exportar").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ participantes }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "volei-backup.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $("arquivo-backup").addEventListener("change", async (event) => {
    const arquivo = event.target.files[0];
    if (!arquivo) return;
    try {
      const dados = JSON.parse(await arquivo.text());
      if (!Array.isArray(dados.participantes)) throw new Error("Backup inválido.");
      participantes = dados.participantes;
      salvarParticipantesLocais();
      await carregarParticipantes();
      $("msg-sincronizar").textContent = "Backup restaurado localmente.";
    } catch (e) {
      $("msg-sincronizar").textContent = `Falha ao restaurar backup: ${e.message}`;
      $("msg-sincronizar").className = "msg erro";
    }
  });
})();
