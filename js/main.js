// Interface: Lista Master, Presença e Times.

import {
  carregar, salvar, adicionarAtleta, atualizarAtleta, adicionarAlias, removerAtleta, moverAtleta,
  previaImportacao, aplicarImportacao, aplicarListaGrupo, alternarPresenca, resolverPendente,
  presentesParaSorteio, casaisParaSorteio, encontrarAtleta,
} from "./dados.js";
import { NIVEIS, TOTAL_ATLETAS, sortearTimes, problemasParaSortear, nomePoteSorteio } from "./sorteio.js";
import { gerarMensagemMaster, lerMensagemMaster, extrairListaGrupo, gerarMensagemTimes } from "./mensagem.js";

const CHAVE_TELA = "djalmer.tela";
const estado = carregar(localStorage);
const ui = {
  tela: localStorage.getItem(CHAVE_TELA) || "presenca",
  filtroPote: null,
  filtroSexo: "",
  editando: null,
  busca: "",
  revelar: false,
};

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const esc = (texto) => String(texto ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// ---- Infraestrutura ---------------------------------------------------

function executar(acao, { renderizar = true } = {}) {
  try {
    const resultado = acao();
    salvar(localStorage, estado);
    if (renderizar) render();
    return resultado;
  } catch (erro) {
    avisar(erro.message, true);
    return undefined;
  }
}

let temporizadorAviso;
function avisar(texto, erro = false) {
  const aviso = $("#aviso");
  aviso.textContent = texto;
  aviso.classList.toggle("erro", erro);
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, erro ? 6000 : 3500);
}

function perguntar({ titulo, conteudo, ok = "Confirmar", cancelar = "Cancelar" }) {
  const dialogo = $("#dialogo");
  $("#dialogo-titulo").textContent = titulo;
  $("#dialogo-conteudo").innerHTML = conteudo;
  $("#dialogo-ok").textContent = ok;
  $("#dialogo-cancelar").textContent = cancelar;
  dialogo.returnValue = "";
  dialogo.showModal();
  $("textarea, input", dialogo)?.focus();
  return new Promise((resolver) => {
    dialogo.addEventListener("close", () => resolver(dialogo.returnValue === "ok"), { once: true });
  });
}

async function compartilhar(texto) {
  try {
    if (navigator.share) {
      await navigator.share({ text: texto });
      return;
    }
  } catch (erro) {
    if (erro.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    avisar("Mensagem copiada. Cole no WhatsApp.");
  } catch {
    // Sem área de transferência, o link do WhatsApp ainda leva o texto.
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

const rotuloSexo = (sexo) => ({ M: "Masculino", F: "Feminino" }[sexo] || "Sexo não definido");

function opcoesPote(selecionado, vazio = "Sem pote") {
  return [`<option value="">${vazio}</option>`, ...NIVEIS.map((pote) =>
    `<option value="${pote}" ${pote === selecionado ? "selected" : ""}>${pote}</option>`)].join("");
}

function opcoesSexo(selecionado) {
  return [["", "Sexo"], ["M", "M"], ["F", "F"]].map(([valor, rotulo]) =>
    `<option value="${valor}" ${valor === selecionado ? "selected" : ""}>${rotulo}</option>`).join("");
}

// ---- Navegação --------------------------------------------------------

function irPara(tela) {
  ui.tela = tela;
  localStorage.setItem(CHAVE_TELA, tela);
  document.querySelectorAll(".aba").forEach((aba) => {
    if (aba.dataset.tela === tela) aba.setAttribute("aria-current", "page");
    else aba.removeAttribute("aria-current");
  });
  document.querySelectorAll(".tela").forEach((secao) => { secao.hidden = secao.id !== `tela-${tela}`; });
  render();
  window.scrollTo(0, 0);
}

document.querySelectorAll(".aba").forEach((aba) => aba.addEventListener("click", () => irPara(aba.dataset.tela)));

// ---- Presença ---------------------------------------------------------

function situacaoPresenca() {
  const presentes = presentesParaSorteio(estado);
  const pendentes = estado.presenca.pendentes.length;
  const problemas = problemasParaSortear(presentes);
  let legenda;
  let nivel = "falta";
  if (pendentes) legenda = `Resolva ${plural(pendentes, "nome não encontrado", "nomes não encontrados")} antes de sortear.`;
  else if (presentes.length < TOTAL_ATLETAS) legenda = `${TOTAL_ATLETAS - presentes.length === 1 ? "Falta 1" : `Faltam ${TOTAL_ATLETAS - presentes.length}`} para fechar os times.`;
  else if (presentes.length > TOTAL_ATLETAS) { legenda = `${presentes.length - TOTAL_ATLETAS === 1 ? "Sobra 1" : `Sobram ${presentes.length - TOTAL_ATLETAS}`}. Desmarque para ficar com ${TOTAL_ATLETAS}.`; nivel = "sobra"; }
  else if (problemas.length) legenda = `${plural(problemas.length, "atleta precisa", "atletas precisam")} de pote ou sexo na Lista Master.`;
  else { legenda = "Pronto para sortear."; nivel = "pronto"; }
  return { presentes, problemas: pendentes ? [legenda, ...problemas] : problemas, legenda, nivel };
}

function placar(situacao, compacto = false) {
  return `<div class="placar placar-${situacao.nivel}${compacto ? " compacto" : ""}" role="group" aria-label="${situacao.presentes.length} de ${TOTAL_ATLETAS} presentes">
    <span class="placar-numero">${situacao.presentes.length}</span><span class="placar-total">/${TOTAL_ATLETAS}</span>
    <p class="placar-legenda">${esc(situacao.legenda)}</p>
  </div>`;
}

function renderPresenca() {
  const situacao = situacaoPresenca();
  const presentes = new Set(estado.presenca.ids);
  const linha = (atleta, indice) => `<li data-nome="${esc(atleta.nome.toLowerCase())} ${esc(atleta.aliases.join(" ").toLowerCase())}">
    <button class="presenca${presentes.has(atleta.id) ? " marcada" : ""}" data-acao="alternar-presenca" data-id="${atleta.id}" aria-pressed="${presentes.has(atleta.id)}">
      <span class="rank">${indice + 1}</span>
      <span class="presenca-nome">${esc(atleta.nome)}</span>
      <span class="pote">${atleta.pote || "?"}</span>
    </button></li>`;
  const comIndice = estado.atletas.map((atleta, indice) => [atleta, indice]);
  const marcados = comIndice.filter(([a]) => presentes.has(a.id));
  const ausentes = comIndice.filter(([a]) => !presentes.has(a.id));
  const opcoesVinculo = estado.atletas.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join("");

  $("#tela-presenca").innerHTML = `
    ${placar(situacao)}
    <details class="colar" ${estado.presenca.ids.length ? "" : "open"}>
      <summary>Colar lista do grupo</summary>
      <label class="rotulo" for="texto-grupo">Cole a lista de confirmados do WhatsApp. A presença atual será trocada por ela.</label>
      <textarea id="texto-grupo" rows="6" placeholder="1. Ana ✅&#10;2. Beto&#10;..."></textarea>
      <button class="botao primario" data-acao="marcar-grupo">Marcar presença</button>
    </details>
    ${estado.presenca.pendentes.length ? `<section class="bloco pendencias" aria-labelledby="titulo-pendentes">
      <h2 id="titulo-pendentes">Não estão na Lista Master</h2>
      <p class="nota">Escolha quem é a pessoa (o nome vira apelido dela) ou cadastre.</p>
      <ul class="lista-pendentes">${estado.presenca.pendentes.map((nome) => `<li>
        <span class="pendente-nome">${esc(nome)}</span>
        <select data-acao="vincular-pendente" data-nome="${esc(nome)}" aria-label="Vincular ${esc(nome)} a um atleta"><option value="">É o atleta…</option>${opcoesVinculo}</select>
        <button class="botao secundario" data-acao="cadastrar-pendente" data-nome="${esc(nome)}">Cadastrar</button>
        <button class="botao fantasma" data-acao="descartar-pendente" data-nome="${esc(nome)}" aria-label="Descartar ${esc(nome)}">Descartar</button>
      </li>`).join("")}</ul>
    </section>` : ""}
    ${estado.atletas.length ? `
      <input type="search" class="busca" id="busca-presenca" placeholder="Buscar atleta" value="${esc(ui.busca)}" aria-label="Buscar atleta" />
      ${marcados.length ? `<h2 class="subtitulo">Presentes</h2><ul class="lista-presenca">${marcados.map(([a, i]) => linha(a, i)).join("")}</ul>` : ""}
      ${ausentes.length ? `<h2 class="subtitulo">Ausentes</h2><ul class="lista-presenca">${ausentes.map(([a, i]) => linha(a, i)).join("")}</ul>` : ""}
      ${estado.presenca.ids.length || estado.presenca.pendentes.length ? `<button class="botao fantasma largo" data-acao="limpar-presenca">Limpar presença</button>` : ""}
    ` : `<p class="vazio">A Lista Master está vazia. Cadastre os atletas ou importe a lista em <button class="link" data-acao="ir" data-tela="master">Lista Master</button>.</p>`}
  `;
  filtrarPresenca();
}

function filtrarPresenca() {
  const termo = ui.busca.trim().toLowerCase();
  document.querySelectorAll(".lista-presenca li").forEach((item) => {
    item.hidden = Boolean(termo) && !item.dataset.nome.includes(termo);
  });
}

// ---- Times ------------------------------------------------------------

function renderTimes() {
  const situacao = situacaoPresenca();
  const pode = !situacao.problemas.length && situacao.presentes.length === TOTAL_ATLETAS;
  const casaisAtivos = estado.casais.lista.filter((c) => c.ativo).length;
  const times = estado.times;

  $("#tela-times").innerHTML = `
    ${pode ? "" : `${placar(situacao, true)}
      ${situacao.problemas.length > 1 ? `<ul class="problemas">${situacao.problemas.slice(1).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      <button class="botao secundario largo" data-acao="ir" data-tela="presenca">Ajustar presença</button>`}
    <div class="controle-sorteio">
      <label class="chave">
        <input type="checkbox" data-acao="casais-ativado" ${estado.casais.ativado ? "checked" : ""} ${estado.casais.lista.length ? "" : "disabled"} />
        <span class="chave-trilho" aria-hidden="true"></span>
        <span>Manter casais juntos <span class="nota">${estado.casais.lista.length ? plural(casaisAtivos, "casal ativo", "casais ativos") : "nenhum casal cadastrado"}</span></span>
      </label>
      <button class="botao primario grande" data-acao="sortear" ${pode ? "" : "disabled"}>${times ? "Sortear de novo" : "Sortear times"}</button>
    </div>
    ${times ? `
      <div class="grade-times${ui.revelar ? " revelar" : ""}">${times.map((time, indice) => `
        <article class="time" style="--ordem:${indice}">
          <h2 class="time-nome">${esc(time.nome)}</h2>
          <ol class="time-jogadores">${time.jogadores.map((j) => {
            const promovido = j.poteSorteio !== j.pote && !(j.poteSorteio === "levantadores" && ["LM1", "LF1"].includes(j.pote));
            return `<li><span class="jogador-nome">${esc(j.nome)}</span>
              <span class="sexo" title="${rotuloSexo(j.sexo)}">${j.sexo}</span>
              <span class="pote${promovido ? " promovido" : ""}">${nomePoteSorteio(j.poteSorteio)}${promovido ? `<small>era ${j.pote}</small>` : ""}</span></li>`;
          }).join("")}</ol>
        </article>`).join("")}
      </div>
      <div class="acoes">
        <button class="botao primario" data-acao="compartilhar-times">Enviar no WhatsApp</button>
        ${estado.timesAnterior ? `<button class="botao secundario" data-acao="desfazer-sorteio">Desfazer sorteio</button>` : ""}
      </div>
    ` : (pode ? `<p class="vazio">Os 24 estão confirmados. Toque em Sortear times.</p>` : "")}
  `;
  ui.revelar = false;
}

function sortear() {
  const { times, casaisAusentes } = sortearTimes(presentesParaSorteio(estado), { casais: casaisParaSorteio(estado) });
  estado.timesAnterior = estado.times;
  estado.times = times;
  if (casaisAusentes.length) avisar(`Casais sem os dois presentes: ${casaisAusentes.join(", ")}.`);
  else avisar("Times sorteados.");
  ui.revelar = true;
}

// ---- Lista Master -----------------------------------------------------

function atletasVisiveis() {
  return estado.atletas
    .map((atleta, indice) => ({ atleta, indice }))
    .filter(({ atleta }) => (ui.filtroPote === null || atleta.pote === ui.filtroPote || atleta.potesAdicionais.includes(ui.filtroPote))
      && (!ui.filtroSexo || atleta.sexo === ui.filtroSexo));
}

function editorAtleta(atleta) {
  const adicionais = NIVEIS.filter((pote) => pote !== atleta.pote).map((pote) => `
    <label class="marcador"><input type="checkbox" data-acao="adicional" data-id="${atleta.id}" value="${pote}" ${atleta.potesAdicionais.includes(pote) ? "checked" : ""} /><span>${pote}</span></label>`).join("");
  return `<div class="editor">
    <label class="rotulo">Nome<input data-acao="editar-campo" data-campo="nome" data-id="${atleta.id}" value="${esc(atleta.nome)}" maxlength="80" /></label>
    <div class="linha">
      <label class="rotulo">Sexo<select data-acao="editar-campo" data-campo="sexo" data-id="${atleta.id}">${opcoesSexo(atleta.sexo)}</select></label>
      <label class="rotulo">Pote principal<select data-acao="editar-campo" data-campo="pote" data-id="${atleta.id}">${opcoesPote(atleta.pote)}</select></label>
    </div>
    <fieldset class="adicionais"><legend>Também pode jogar como</legend>${adicionais}</fieldset>
    <div class="apelidos">
      <span class="rotulo">Outros nomes na lista do grupo</span>
      <div class="fichas">${atleta.aliases.map((alias, i) => `<span class="ficha">${esc(alias)}<button data-acao="remover-alias" data-id="${atleta.id}" data-indice="${i}" aria-label="Remover ${esc(alias)}">×</button></span>`).join("") || `<span class="nota">Nenhum</span>`}</div>
      <div class="linha"><input id="novo-alias" placeholder="Ex.: Joãozinho" aria-label="Novo apelido" /><button class="botao secundario" data-acao="adicionar-alias" data-id="${atleta.id}">Adicionar</button></div>
    </div>
    <div class="acoes">
      <button class="botao perigo" data-acao="excluir-atleta" data-id="${atleta.id}">Excluir atleta</button>
      <button class="botao secundario" data-acao="fechar-editor">Fechar</button>
    </div>
  </div>`;
}

function renderMaster() {
  const visiveis = atletasVisiveis();
  const filtroPote = (valor, rotulo) => `<button class="filtro" data-acao="filtro-pote" data-valor="${valor ?? "todos"}" aria-pressed="${ui.filtroPote === valor}">${rotulo}</button>`;
  const filtroSexo = (valor, rotulo) => `<button class="filtro" data-acao="filtro-sexo" data-valor="${valor}" aria-pressed="${ui.filtroSexo === valor}">${rotulo}</button>`;
  const opcoesCasal = estado.atletas.map((a) => `<option value="${esc(a.nome)}">${esc(a.nome)}</option>`).join("");

  $("#tela-master").innerHTML = `
    <div class="cabecalho-tela">
      <h2>Lista Master</h2>
      <p class="nota">${plural(estado.atletas.length, "atleta", "atletas")}. A ordem da lista é o ranking.</p>
    </div>
    <div class="acoes">
      <button class="botao primario" data-acao="exportar" ${estado.atletas.length ? "" : "disabled"}>Exportar lista</button>
      <button class="botao secundario" data-acao="importar">Importar lista</button>
    </div>

    <form class="novo-atleta" data-acao="novo-atleta">
      <input name="nome" placeholder="Nome do atleta" aria-label="Nome do atleta" maxlength="80" required />
      <select name="sexo" aria-label="Sexo">${opcoesSexo("")}</select>
      <select name="pote" aria-label="Pote principal">${opcoesPote("", "Pote")}</select>
      <button class="botao secundario">Adicionar</button>
    </form>

    <div class="filtros" role="group" aria-label="Filtrar por pote">
      ${filtroPote(null, "Todos")}${NIVEIS.map((p) => filtroPote(p, p)).join("")}${filtroPote("", "Sem pote")}
    </div>
    <div class="filtros" role="group" aria-label="Filtrar por sexo">
      ${filtroSexo("", "M e F")}${filtroSexo("M", "M")}${filtroSexo("F", "F")}
    </div>

    ${visiveis.length ? `<ol class="lista-master">${visiveis.map(({ atleta, indice }, posicao) => `
      <li class="atleta${ui.editando === atleta.id ? " editando" : ""}" data-id="${atleta.id}">
        <div class="atleta-linha">
          <span class="alca" data-alca title="Arraste para mudar o ranking" aria-hidden="true"></span>
          <span class="rank">${indice + 1}</span>
          <button class="atleta-info" data-acao="editar" data-id="${atleta.id}" aria-expanded="${ui.editando === atleta.id}">
            <span class="atleta-nome">${esc(atleta.nome)}</span>
            <span class="atleta-meta">
              <span class="sexo${atleta.sexo ? "" : " faltando"}" title="${rotuloSexo(atleta.sexo)}">${atleta.sexo || "?"}</span>
              <span class="pote${atleta.pote ? "" : " faltando"}">${atleta.pote || "sem pote"}</span>
              ${atleta.potesAdicionais.map((p) => `<span class="pote extra">+${p}</span>`).join("")}
            </span>
          </button>
          <span class="ordem">
            <button data-acao="mover" data-direcao="-1" data-id="${atleta.id}" aria-label="Subir ${esc(atleta.nome)}" ${posicao === 0 ? "disabled" : ""}>▲</button>
            <button data-acao="mover" data-direcao="1" data-id="${atleta.id}" aria-label="Descer ${esc(atleta.nome)}" ${posicao === visiveis.length - 1 ? "disabled" : ""}>▼</button>
          </span>
        </div>
        ${ui.editando === atleta.id ? editorAtleta(atleta) : ""}
      </li>`).join("")}</ol>`
    : `<p class="vazio">${estado.atletas.length ? "Nenhum atleta neste filtro." : "Nenhum atleta ainda. Adicione acima ou importe a mensagem da Lista Master."}</p>`}

    <section class="bloco casais" aria-labelledby="titulo-casais">
      <h2 id="titulo-casais">Casais</h2>
      <p class="nota">Com "Manter casais juntos" ligado na tela Times, cada casal ativo cai no mesmo time.</p>
      ${estado.casais.lista.length ? `<ul class="lista-casais">${estado.casais.lista.map((casal, i) => `<li>
        <label class="chave">
          <input type="checkbox" data-acao="casal-ativo" data-indice="${i}" ${casal.ativo ? "checked" : ""} />
          <span class="chave-trilho" aria-hidden="true"></span>
          <span>${esc(casal.a)} &amp; ${esc(casal.b)}${encontrarAtleta(estado.atletas, casal.a) && encontrarAtleta(estado.atletas, casal.b) ? "" : ` <span class="nota alerta">fora da lista</span>`}</span>
        </label>
        <button class="botao fantasma" data-acao="remover-casal" data-indice="${i}" aria-label="Remover casal ${esc(casal.a)} e ${esc(casal.b)}">Remover</button>
      </li>`).join("")}</ul>` : ""}
      ${estado.atletas.length >= 2 ? `<form class="novo-casal" data-acao="novo-casal">
        <select name="a" aria-label="Primeira pessoa do casal" required><option value="">Pessoa 1</option>${opcoesCasal}</select>
        <select name="b" aria-label="Segunda pessoa do casal" required><option value="">Pessoa 2</option>${opcoesCasal}</select>
        <button class="botao secundario">Adicionar casal</button>
      </form>` : ""}
    </section>
  `;
}

async function importarMaster() {
  const colou = await perguntar({
    titulo: "Importar Lista Master",
    conteudo: `<label class="rotulo" for="texto-master">Cole a mensagem gerada por "Exportar lista".</label>
      <textarea id="texto-master" rows="10" placeholder="*Lista Master - Vôlei Djalmer*"></textarea>`,
    ok: "Ver prévia",
  });
  if (!colou) return;
  let lido;
  try { lido = lerMensagemMaster($("#texto-master").value); } catch (erro) { avisar(erro.message, true); return; }
  const previa = previaImportacao(estado, lido);
  if (previa.repetidos.length) { avisar(`Nomes repetidos na mensagem: ${[...new Set(previa.repetidos)].join(", ")}.`, true); return; }
  const listar = (nomes) => nomes.length ? `<span class="nota">${nomes.map(esc).join(", ")}</span>` : "";
  const confirmou = await perguntar({
    titulo: "Substituir a Lista Master?",
    conteudo: `<ul class="previa">
      <li><strong>${previa.total}</strong> ${previa.total === 1 ? "atleta" : "atletas"} na mensagem</li>
      <li><strong>${previa.novos.length}</strong> ${previa.novos.length === 1 ? "novo" : "novos"} ${listar(previa.novos)}</li>
      <li><strong>${previa.removidos.length}</strong> ${previa.removidos.length === 1 ? "sai" : "saem"} da lista ${listar(previa.removidos)}</li>
      <li><strong>${previa.casais}</strong> ${previa.casais === 1 ? "casal" : "casais"}</li>
    </ul><p class="nota">A lista atual será trocada pela da mensagem.</p>`,
    ok: "Substituir lista",
  });
  if (!confirmou) return;
  executar(() => aplicarImportacao(estado, lido));
  avisar(`Lista Master importada: ${plural(previa.total, "atleta", "atletas")}.`);
}

// ---- Eventos ----------------------------------------------------------

const acoesClique = {
  "ir": (b) => irPara(b.dataset.tela),
  "alternar-presenca": (b) => executar(() => alternarPresenca(estado, b.dataset.id)),
  "marcar-grupo": () => {
    const nomes = extrairListaGrupo($("#texto-grupo").value);
    if (!nomes.length) { avisar("Nenhum nome encontrado. A lista precisa ter linhas como \"1. Nome\".", true); return; }
    const resultado = executar(() => aplicarListaGrupo(estado, nomes));
    if (resultado) avisar(`${plural(resultado.marcados, "presença marcada", "presenças marcadas")}${resultado.pendentes.length ? `, ${plural(resultado.pendentes.length, "nome não encontrado", "nomes não encontrados")}` : ""}.`);
  },
  "cadastrar-pendente": (b) => {
    const atleta = executar(() => resolverPendente(estado, b.dataset.nome, null), { renderizar: false });
    if (!atleta) return;
    ui.editando = atleta.id;
    ui.filtroPote = null;
    ui.filtroSexo = "";
    irPara("master");
    avisar(`${atleta.nome} cadastrado. Defina sexo e pote.`);
  },
  "descartar-pendente": (b) => executar(() => {
    estado.presenca.pendentes = estado.presenca.pendentes.filter((nome) => nome !== b.dataset.nome);
  }),
  "limpar-presenca": async () => {
    if (await perguntar({ titulo: "Limpar presença?", conteudo: "<p>Todos ficam como ausentes.</p>", ok: "Limpar" })) {
      executar(() => { estado.presenca = { ids: [], pendentes: [] }; });
    }
  },
  "sortear": () => executar(sortear),
  "desfazer-sorteio": () => executar(() => {
    estado.times = estado.timesAnterior;
    estado.timesAnterior = null;
    avisar("Sorteio anterior restaurado.");
  }),
  "compartilhar-times": () => compartilhar(gerarMensagemTimes(estado.times)),
  "exportar": () => compartilhar(gerarMensagemMaster(estado.atletas, estado.casais.lista)),
  "importar": importarMaster,
  "filtro-pote": (b) => { ui.filtroPote = b.dataset.valor === "todos" ? null : b.dataset.valor; render(); },
  "filtro-sexo": (b) => { ui.filtroSexo = b.dataset.valor; render(); },
  "editar": (b) => { ui.editando = ui.editando === b.dataset.id ? null : b.dataset.id; render(); },
  "fechar-editor": () => { ui.editando = null; render(); },
  "mover": (b) => {
    const visiveis = atletasVisiveis();
    const posicao = visiveis.findIndex(({ atleta }) => atleta.id === b.dataset.id);
    const vizinho = visiveis[posicao + Number(b.dataset.direcao)];
    if (!vizinho) return;
    executar(() => moverAtleta(estado, b.dataset.id, vizinho.atleta.id));
    const mesmo = $(`[data-acao="mover"][data-direcao="${b.dataset.direcao}"][data-id="${b.dataset.id}"]`);
    (mesmo && !mesmo.disabled ? mesmo : $(`[data-acao="mover"][data-id="${b.dataset.id}"]:not([disabled])`))?.focus();
  },
  "adicionar-alias": (b) => executar(() => { adicionarAlias(estado, b.dataset.id, $("#novo-alias").value); }),
  "remover-alias": (b) => executar(() => {
    estado.atletas.find((a) => a.id === b.dataset.id)?.aliases.splice(Number(b.dataset.indice), 1);
  }),
  "excluir-atleta": async (b) => {
    const atleta = estado.atletas.find((a) => a.id === b.dataset.id);
    if (!atleta) return;
    if (await perguntar({ titulo: `Excluir ${atleta.nome}?`, conteudo: "<p>O atleta sai da Lista Master e da presença.</p>", ok: "Excluir" })) {
      ui.editando = null;
      executar(() => removerAtleta(estado, atleta.id));
    }
  },
  "remover-casal": (b) => executar(() => { estado.casais.lista.splice(Number(b.dataset.indice), 1); }),
};

const acoesMudanca = {
  "vincular-pendente": (el) => {
    if (!el.value) return;
    const atleta = executar(() => resolverPendente(estado, el.dataset.nome, el.value));
    if (atleta) avisar(`"${el.dataset.nome}" agora é apelido de ${atleta.nome}.`);
  },
  "casais-ativado": (el) => executar(() => { estado.casais.ativado = el.checked; }),
  "casal-ativo": (el) => executar(() => { estado.casais.lista[Number(el.dataset.indice)].ativo = el.checked; }),
  "editar-campo": (el) => executar(() => atualizarAtleta(estado, el.dataset.id, { [el.dataset.campo]: el.value })),
  "adicional": (el) => executar(() => {
    const atleta = estado.atletas.find((a) => a.id === el.dataset.id);
    const marcados = [...document.querySelectorAll(`[data-acao="adicional"][data-id="${el.dataset.id}"]:checked`)].map((c) => c.value);
    atualizarAtleta(estado, atleta.id, { potesAdicionais: NIVEIS.filter((p) => marcados.includes(p)) });
  }),
};

const acoesFormulario = {
  "novo-atleta": (form) => {
    const dados = Object.fromEntries(new FormData(form));
    if (executar(() => adicionarAtleta(estado, dados), { renderizar: false })) {
      render();
      avisar(`${dados.nome.trim()} entrou no fim da lista.`);
      $(".novo-atleta input[name=nome]")?.focus();
    }
  },
  "novo-casal": (form) => {
    const { a, b } = Object.fromEntries(new FormData(form));
    executar(() => {
      if (a === b) throw new Error("Escolha duas pessoas diferentes.");
      const ocupado = estado.casais.lista.find((c) => [c.a, c.b].includes(a) || [c.a, c.b].includes(b));
      if (ocupado) throw new Error(`${ocupado.a} e ${ocupado.b} já formam um casal.`);
      estado.casais.lista.push({ a, b, ativo: true });
    });
  },
};

const main = $("main");
main.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-acao]");
  if (botao && acoesClique[botao.dataset.acao]) acoesClique[botao.dataset.acao](botao);
});
main.addEventListener("change", (evento) => {
  const el = evento.target.closest("[data-acao]");
  if (el && acoesMudanca[el.dataset.acao]) acoesMudanca[el.dataset.acao](el);
});
main.addEventListener("submit", (evento) => {
  const form = evento.target.closest("form[data-acao]");
  if (!form) return;
  evento.preventDefault();
  acoesFormulario[form.dataset.acao]?.(form);
});
main.addEventListener("input", (evento) => {
  if (evento.target.id !== "busca-presenca") return;
  ui.busca = evento.target.value;
  filtrarPresenca();
});
main.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && evento.target.id === "novo-alias") {
    evento.preventDefault();
    $("[data-acao=adicionar-alias]")?.click();
  }
});

// Arrastar pela alça (funciona com dedo e mouse).
let arrasto = null;
main.addEventListener("pointerdown", (evento) => {
  const alca = evento.target.closest("[data-alca]");
  if (!alca) return;
  evento.preventDefault();
  const item = alca.closest("li.atleta");
  arrasto = { id: item.dataset.id, item, alvo: null };
  item.classList.add("arrastando");
  alca.setPointerCapture(evento.pointerId);
});
main.addEventListener("pointermove", (evento) => {
  if (!arrasto) return;
  const alvo = document.elementFromPoint(evento.clientX, evento.clientY)?.closest("li.atleta");
  if (arrasto.alvo && arrasto.alvo !== alvo) arrasto.alvo.classList.remove("alvo");
  arrasto.alvo = alvo && alvo !== arrasto.item ? alvo : null;
  arrasto.alvo?.classList.add("alvo");
});
const soltar = () => {
  if (!arrasto) return;
  const { id, alvo, item } = arrasto;
  arrasto = null;
  item.classList.remove("arrastando");
  if (alvo) executar(() => moverAtleta(estado, id, alvo.dataset.id));
};
main.addEventListener("pointerup", soltar);
main.addEventListener("pointercancel", soltar);

// ---- Render -----------------------------------------------------------

function render() {
  ({ presenca: renderPresenca, times: renderTimes, master: renderMaster })[ui.tela]();
  const situacao = situacaoPresenca();
  $("#aba-presenca").dataset.contagem = `${situacao.presentes.length}`;
}

if (!["presenca", "times", "master"].includes(ui.tela)) ui.tela = "presenca";
irPara(ui.tela);
