// Interface: Lista Master, Lista (confirmados), Times, Presença (chegada na quadra) e Amistoso.

import {
  carregar, salvar, adicionarAtleta, atualizarAtleta, adicionarAlias, removerAtleta, moverAtleta,
  previaImportacao, aplicarImportacao, aplicarListaGrupo, resolverPendente,
  confirmadosParaSorteio, casaisParaSorteio, encontrarAtleta, definirTimes, desfazerTimes,
  aplicarTimesColados, alternarCheckin, chegou, zerarCheckin,
} from "./dados.js";
import { NIVEIS, POTES_ORDEM, TOTAL_ATLETAS, sortearTimes, problemasParaSortear, nomePoteSorteio } from "./sorteio.js";
import { gerarMensagemMaster, lerMensagemMaster, extrairListaGrupo, gerarMensagemTimes, lerMensagemTimes } from "./mensagem.js";
import {
  OPCOES, EM_QUADRA, carregarAmistoso, salvarAmistoso, configurarAmistoso, aplicarTimesAmistoso, comecarAmistosos,
  alternarPresencaAmistoso, confirmado, comecarConfrontos, escalar, opcoesAdversario, trocarAdversario, iniciarPartida,
  situacao, sacador, marcarPonto, desfazerPonto, substituir, encerrarPartida, encerrarAmistosos,
} from "./amistoso.js";

const CHAVE_TELA = "djalmer.tela";
const TELAS = ["master", "lista", "times", "presenca", "amistoso"];
const estado = carregar(localStorage);
const amistoso = carregarAmistoso(localStorage);
const ui = {
  tela: TELAS.includes(localStorage.getItem(CHAVE_TELA)) ? localStorage.getItem(CHAVE_TELA) : "lista",
  buscaMaster: "",
  buscaLista: "",
  folha: null, // folha aberta com edição ao vivo: { tipo: "atleta", id }, { tipo: "casais" } ou { tipo: "amistoso-presenca" }
  saqueAmistoso: null, // lado escolhido para começar sacando na próxima partida
  rodou: null, // lado que acabou de rodar, para animar a quadra
};

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const esc = (texto) => String(texto ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

const ICONES = {
  casais: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="13" r="5.5"/><circle cx="15" cy="11" r="5.5"/></svg>',
  mais: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  colar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4.5h6v2.5H9zM9 11h6M9 15h4"/></svg>',
  seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>',
  bola: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5c.8 3.6-.2 6.6-3.2 8.9M20.4 13.4c-3.4-1.4-6.6-1-9.4 1.3M6.3 18.3c.6-3.6 2.6-6.1 5.7-7.4"/></svg>',
  presenca: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8 12.2l2.7 2.7L16.2 9.4"/></svg>',
};

// ---- Infraestrutura ---------------------------------------------------

function executar(acao, { renderizar = true } = {}) {
  try {
    const resultado = acao();
    salvar(localStorage, estado);
    salvarAmistoso(localStorage, amistoso);
    if (renderizar) render();
    return resultado ?? true;
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
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, erro ? 6000 : 3000);
}

/** Abre a folha. Resolve true quando o botão de confirmar é usado. */
function abrirFolha({ titulo, conteudo, ok = "OK", cancelar = "Cancelar", folha = null }) {
  const dialogo = $("#folha");
  ui.folha = folha;
  $("#folha-titulo").textContent = titulo;
  $("#folha-conteudo").innerHTML = conteudo;
  $("#folha-ok").textContent = ok;
  $("#folha-cancelar").textContent = cancelar || "";
  $("#folha-cancelar").hidden = !cancelar;
  dialogo.returnValue = "";
  dialogo.showModal();
  $("textarea", dialogo)?.focus();
  return new Promise((resolver) => {
    dialogo.addEventListener("close", () => {
      ui.folha = null;
      resolver(dialogo.returnValue === "ok");
    }, { once: true });
  });
}

/** Fecha a folha aberta e espera o fechamento terminar. */
function fecharFolha() {
  const dialogo = $("#folha");
  if (!dialogo.open) return Promise.resolve();
  return new Promise((resolver) => {
    dialogo.addEventListener("close", () => setTimeout(resolver), { once: true });
    dialogo.close();
  });
}

async function confirmar(titulo, texto, ok) {
  return abrirFolha({ titulo, conteudo: `<p class="folha-texto">${esc(texto)}</p>`, ok });
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

const opcoes = (lista, selecionado) => lista.map(([valor, rotulo]) =>
  `<option value="${esc(valor)}" ${valor === selecionado ? "selected" : ""}>${esc(rotulo)}</option>`).join("");
const opcoesPote = (selecionado) => opcoes([["", "Sem pote"], ...POTES_ORDEM.map((p) => [p, p])], selecionado);
const opcoesSexo = (selecionado) => opcoes([["", "Não definido"], ["M", "Masculino"], ["F", "Feminino"]], selecionado);

const topo = (titulo, subtitulo, botoes = "") => `
  <div class="barra">${botoes}</div>
  <h1 class="titulo-grande">${esc(titulo)}</h1>
  ${subtitulo ? `<p class="subtitulo">${esc(subtitulo)}</p>` : ""}`;

const botaoBarra = (acao, icone, rotulo) =>
  `<button class="botao-icone" data-acao="${acao}" aria-label="${rotulo}" title="${rotulo}">${ICONES[icone]}</button>`;

const grupo = ({ cabecalho = "", rodape = "", celulas, classe = "" }) => `
  <section class="grupo ${classe}">
    ${cabecalho ? `<h2 class="grupo-cabecalho">${cabecalho}</h2>` : ""}
    <ul class="celulas">${celulas}</ul>
    ${rodape ? `<p class="grupo-rodape">${rodape}</p>` : ""}
  </section>`;

const celulaAcao = (acao, texto, { perigo = false, extra = "", desativado = false } = {}) =>
  `<li><button class="celula celula-acao${perigo ? " perigo" : ""}" data-acao="${acao}" ${extra} ${desativado ? "disabled" : ""}>${esc(texto)}</button></li>`;

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

// ---- Lista (confirmados do dia) --------------------------------------

function situacaoLista() {
  const confirmados = confirmadosParaSorteio(estado);
  const pendentes = estado.lista.pendentes.length;
  const problemas = problemasParaSortear(confirmados);
  const n = confirmados.length;
  let resumo = `${n} de ${TOTAL_ATLETAS} confirmados`;
  if (n < TOTAL_ATLETAS) resumo += `, ${TOTAL_ATLETAS - n === 1 ? "falta 1" : `faltam ${TOTAL_ATLETAS - n}`}`;
  if (n > TOTAL_ATLETAS) resumo += `, ${n - TOTAL_ATLETAS === 1 ? "sobra 1" : `sobram ${n - TOTAL_ATLETAS}`}`;
  if (pendentes) problemas.unshift(`Resolva ${plural(pendentes, "nome não encontrado", "nomes não encontrados")} na aba Lista.`);
  return { confirmados, resumo, problemas, pronto: !problemas.length };
}

function renderLista() {
  const situacao = situacaoLista();
  // Só aparecem os nomes importados da lista do grupo, na ordem da mensagem.
  const celula = (atleta, indice) => `<li class="celula" data-busca="${esc(`${atleta.nome} ${atleta.aliases.join(" ")}`.toLowerCase())}">
      <span class="rank">${indice + 1}</span>
      <span class="celula-texto">${esc(atleta.nome)}</span>
      <span class="celula-detalhe">${atleta.pote || "Sem pote"}</span>
    </li>`;
  const marcados = estado.lista.ids.map((id) => estado.atletas.find((a) => a.id === id)).filter(Boolean);
  const opcoesVinculo = estado.atletas.map((a) => [a.id, a.nome]);

  $("#tela-lista").innerHTML = `
    ${topo("Lista", situacao.resumo)}
    ${grupo({
      celulas: celulaAcao("colar-lista", "Colar lista do grupo"),
      rodape: "Cole a mensagem de confirmados do WhatsApp. Ela substitui a lista atual.",
    })}
    ${estado.lista.pendentes.length ? grupo({
      cabecalho: "Não estão na Lista Master",
      classe: "pendencias",
      rodape: "Escolha quem é a pessoa (o nome vira apelido dela) ou cadastre.",
      celulas: estado.lista.pendentes.map((nome) => `<li class="celula celula-pendente">
        <span class="celula-texto">${esc(nome)}</span>
        <select data-acao="vincular-pendente" data-nome="${esc(nome)}" aria-label="Quem é ${esc(nome)}">
          <option value="">É o atleta…</option>${opcoes(opcoesVinculo, "")}</select>
        <span class="pendente-acoes">
          <button class="botao-texto" data-acao="cadastrar-pendente" data-nome="${esc(nome)}">Cadastrar</button>
          <button class="botao-texto perigo" data-acao="descartar-pendente" data-nome="${esc(nome)}">Descartar</button>
        </span>
      </li>`).join(""),
    }) : ""}
    ${marcados.length ? `
      <input type="search" class="busca" id="busca-lista" placeholder="Buscar" value="${esc(ui.buscaLista)}" aria-label="Buscar atleta" />
      ${grupo({ cabecalho: "Confirmados", celulas: marcados.map(celula).join("") })}
    ` : (estado.lista.pendentes.length ? "" : `<p class="vazio">Nenhum nome ainda. Toque em Colar lista do grupo.</p>`)}
    ${estado.lista.ids.length || estado.lista.pendentes.length ? grupo({
      celulas: celulaAcao("limpar-lista", "Limpar lista", { perigo: true }) + celulaAcao("nova-lista", "Nova lista"),
      rodape: "Nova lista apaga os nomes e abre a colagem da próxima lista do grupo.",
    }) : ""}
  `;
  filtrar("#tela-lista", ui.buscaLista);
}

function filtrar(tela, termo) {
  const busca = termo.trim().toLowerCase();
  document.querySelectorAll(`${tela} li[data-busca]`).forEach((item) => {
    item.hidden = Boolean(busca) && !item.dataset.busca.includes(busca);
  });
  document.querySelectorAll(`${tela} .grupo`).forEach((secao) => {
    const itens = secao.querySelectorAll("li[data-busca]");
    if (itens.length) secao.hidden = [...itens].every((item) => item.hidden);
  });
}

async function colarLista() {
  const colou = await abrirFolha({
    titulo: "Colar lista",
    conteudo: `<textarea id="texto-colado" rows="12" placeholder="1. Roger Silva ✅&#10;2. Ton ✅&#10;..." aria-label="Lista do grupo"></textarea>`,
    ok: "Marcar",
  });
  if (!colou) return;
  const nomes = extrairListaGrupo($("#texto-colado").value);
  if (!nomes.length) { avisar("Nenhum nome encontrado. A lista precisa ter linhas como \"1. Nome\".", true); return; }
  const resultado = executar(() => aplicarListaGrupo(estado, nomes));
  if (resultado) {
    const extra = resultado.pendentes.length ? `, ${plural(resultado.pendentes.length, "nome não encontrado", "nomes não encontrados")}` : "";
    avisar(`${plural(resultado.marcados, "confirmado", "confirmados")}${extra}.`);
  }
}

// ---- Times ------------------------------------------------------------

function renderTimes() {
  const situacao = situacaoLista();
  const pode = situacao.pronto;
  const times = estado.times;
  const casaisAtivos = casaisParaSorteio(estado).length;

  $("#tela-times").innerHTML = `
    ${topo("Times", times ? plural(times.length, "time", "times") : "Nenhum time ainda", botaoBarra("colar-times", "colar", "Colar times"))}
    ${pode ? "" : grupo({
      cabecalho: "Ainda não dá para sortear",
      classe: "pendencias",
      celulas: `${situacao.problemas.map((p) => `<li class="celula"><span class="celula-texto">${esc(p)}</span></li>`).join("")}
        ${celulaAcao("ir", "Abrir a Lista", { extra: 'data-tela="lista"' })}`,
    })}
    <div class="bloco-botao">
      <button class="botao-cheio" data-acao="sortear" ${pode ? "" : "disabled"}>${times ? "Sortear de novo" : "Sortear times"}</button>
      ${casaisAtivos ? `<p class="grupo-rodape">${plural(casaisAtivos, "casal fica junto", "casais ficam juntos")} no sorteio.</p>` : ""}
    </div>
    ${times ? `
      ${times.map((time) => grupo({
        cabecalho: esc(time.nome),
        celulas: time.jogadores.map((j) => {
          const promovido = j.poteSorteio && j.pote && j.poteSorteio !== j.pote && !(j.poteSorteio === "levantadores" && ["LM1", "LF1"].includes(j.pote));
          return `<li class="celula">
            <span class="celula-texto">${esc(j.nome)}</span>
            <span class="celula-detalhe">${j.poteSorteio ? nomePoteSorteio(j.poteSorteio) : "Sem pote"}${promovido ? ` (era ${j.pote})` : ""}</span>
          </li>`;
        }).join(""),
      })).join("")}
      ${grupo({ celulas: celulaAcao("compartilhar-times", "Enviar no WhatsApp") + (estado.timesAnterior ? celulaAcao("desfazer-sorteio", "Desfazer") : "") })}
    ` : `<p class="vazio">Sorteie os times ou cole a mensagem de times do WhatsApp.</p>`}
  `;
}

async function colarTimes() {
  const colou = await abrirFolha({
    titulo: "Colar times",
    conteudo: `<textarea id="texto-colado" rows="14" placeholder="*Times - Vôlei Djalmer*&#10;&#10;*Time Fulano*&#10;1. Nome&#10;..." aria-label="Mensagem de times"></textarea>
      <p class="folha-texto">Os times atuais, a lista de confirmados e a presença serão trocados pelos da mensagem.</p>`,
    ok: "Usar times",
  });
  if (!colou) return;
  let lidos;
  try { lidos = lerMensagemTimes($("#texto-colado").value); } catch (erro) { avisar(erro.message, true); return; }
  const resultado = executar(() => aplicarTimesColados(estado, lidos));
  if (!resultado) return;
  const extra = resultado.pendentes.length ? ` ${plural(resultado.pendentes.length, "nome não está", "nomes não estão")} na Lista Master: resolva na aba Lista.` : "";
  avisar(`${plural(resultado.times, "time carregado", "times carregados")}.${extra}`, Boolean(resultado.pendentes.length));
}

// ---- Presença (chegada na quadra) ------------------------------------

function renderPresenca() {
  const times = estado.times;
  if (!times) {
    $("#tela-presenca").innerHTML = `${topo("Presença", "")}
      <p class="vazio">Sorteie ou cole os times para marcar quem chegou.</p>
      ${grupo({ celulas: celulaAcao("ir", "Abrir Times", { extra: 'data-tela="times"' }) })}`;
    return;
  }
  const total = times.reduce((s, t) => s + t.jogadores.length, 0);
  const chegaram = times.reduce((s, t) => s + t.jogadores.filter((j) => chegou(estado, j)).length, 0);
  $("#tela-presenca").innerHTML = `
    ${topo("Presença", `${chegaram} de ${total} chegaram`)}
    ${times.map((time, indice) => {
      const posicao = estado.checkin.ordem.indexOf(indice);
      const presentes = time.jogadores.filter((j) => chegou(estado, j)).length;
      return `<section class="grupo time-presenca${posicao >= 0 ? " completo" : ""}">
        <h2 class="grupo-cabecalho cabecalho-time">
          ${posicao >= 0 ? `<span class="ordem-quadra" aria-label="${posicao + 1}º em quadra">${posicao + 1}º</span>` : ""}
          <span class="nome-time">${esc(time.nome)}</span>
          <span class="estado-time">${posicao >= 0 ? "em quadra" : `${presentes} de ${time.jogadores.length}`}</span>
        </h2>
        <ul class="celulas">${time.jogadores.map((j, i) => {
          const marcado = chegou(estado, j);
          return `<li><button class="celula celula-checkin" data-acao="checkin" data-time="${indice}" data-jogador="${i}" aria-pressed="${marcado}">
            <span class="circulo">${marcado ? ICONES.check : ""}</span>
            <span class="celula-texto">${esc(j.nome)}</span>
          </button></li>`;
        }).join("")}</ul>
      </section>`;
    }).join("")}
    ${estado.checkin.ids.length ? grupo({ celulas: celulaAcao("zerar-presenca", "Zerar presença", { perigo: true }) }) : ""}
  `;
}

// ---- Lista Master -----------------------------------------------------

const detalheAtleta = (atleta) => [
  atleta.sexo || "Sexo?",
  ...atleta.potesAdicionais.map((p) => `+${p}`),
].join(" ");

function renderMaster() {
  const grupos = [...POTES_ORDEM, ""].map((pote) => ({ pote, atletas: estado.atletas.filter((a) => a.pote === pote) }))
    .filter((g) => g.atletas.length);
  const casais = estado.casais.ativado ? casaisParaSorteio(estado).length : 0;

  $("#tela-master").innerHTML = `
    ${topo("Lista Master", plural(estado.atletas.length, "atleta", "atletas"),
      `${botaoBarra("abrir-casais", "casais", `Casais${casais ? `, ${plural(casais, "ativo", "ativos")}` : ""}`)}${botaoBarra("novo-atleta", "mais", "Adicionar atleta")}`)}
    ${grupo({ celulas: celulaAcao("exportar", "Exportar lista", { desativado: !estado.atletas.length }) + celulaAcao("importar", "Importar lista") })}
    ${estado.atletas.length ? `
      <input type="search" class="busca" id="busca-master" placeholder="Buscar" value="${esc(ui.buscaMaster)}" aria-label="Buscar atleta" />
      ${grupos.map(({ pote, atletas }) => grupo({
        cabecalho: `${pote || "Sem pote"} <span class="contagem">${atletas.length}</span>`,
        classe: "grupo-pote",
        celulas: atletas.map((atleta, posicao) => `<li class="atleta" data-id="${atleta.id}" data-busca="${esc(`${atleta.nome} ${atleta.aliases.join(" ")}`.toLowerCase())}">
          <div class="celula celula-atleta">
            <span class="alca" data-alca title="Arraste para mudar o ranking" aria-hidden="true"></span>
            <span class="rank">${posicao + 1}</span>
            <button class="atleta-abrir" data-acao="editar" data-id="${atleta.id}">
              <span class="celula-texto">${esc(atleta.nome)}</span>
              <span class="celula-subtexto${atleta.sexo ? "" : " alerta"}">${esc(detalheAtleta(atleta))}</span>
            </button>
            <span class="ordem">
              <button data-acao="mover" data-direcao="-1" data-id="${atleta.id}" aria-label="Subir ${esc(atleta.nome)}" ${posicao === 0 ? "disabled" : ""}>${ICONES.seta}</button>
              <button data-acao="mover" data-direcao="1" data-id="${atleta.id}" aria-label="Descer ${esc(atleta.nome)}" ${posicao === atletas.length - 1 ? "disabled" : ""}>${ICONES.seta}</button>
            </span>
          </div></li>`).join(""),
      })).join("")}
      <p class="grupo-rodape solto">A ordem dentro de cada pote é o ranking. Arraste pela alça ou use as setas.</p>
    ` : `<p class="vazio">Nenhum atleta ainda. Toque em + para adicionar ou importe a mensagem da Lista Master.</p>`}
  `;
  filtrar("#tela-master", ui.buscaMaster);
}

function conteudoAtleta(atleta) {
  const adicionais = POTES_ORDEM.filter((pote) => pote !== atleta.pote).map((pote) => `
    <label class="ficha-opcao"><input type="checkbox" data-acao="adicional" data-id="${atleta.id}" value="${pote}" ${atleta.potesAdicionais.includes(pote) ? "checked" : ""} /><span>${pote}</span></label>`).join("");
  return `
    ${grupo({ celulas: `
      <li class="celula celula-campo"><label for="campo-nome">Nome</label><input id="campo-nome" data-acao="editar-campo" data-campo="nome" data-id="${atleta.id}" value="${esc(atleta.nome)}" maxlength="80" /></li>
      <li class="celula celula-campo"><label for="campo-sexo">Sexo</label><select id="campo-sexo" data-acao="editar-campo" data-campo="sexo" data-id="${atleta.id}">${opcoesSexo(atleta.sexo)}</select></li>
      <li class="celula celula-campo"><label for="campo-pote">Pote</label><select id="campo-pote" data-acao="editar-campo" data-campo="pote" data-id="${atleta.id}">${opcoesPote(atleta.pote)}</select></li>` })}
    <section class="grupo">
      <h2 class="grupo-cabecalho">Também pode jogar como</h2>
      <div class="fichas">${adicionais}</div>
    </section>
    ${grupo({
      cabecalho: "Outros nomes na lista do grupo",
      celulas: `${atleta.aliases.map((alias, i) => `<li class="celula"><span class="celula-texto">${esc(alias)}</span>
          <button class="botao-texto perigo" data-acao="remover-alias" data-id="${atleta.id}" data-indice="${i}">Remover</button></li>`).join("")}
        <li class="celula celula-campo"><input id="novo-alias" placeholder="Novo apelido" aria-label="Novo apelido" />
          <button class="botao-texto" data-acao="adicionar-alias" data-id="${atleta.id}">Adicionar</button></li>`,
    })}
    ${grupo({ celulas: celulaAcao("excluir-atleta", "Excluir atleta", { perigo: true, extra: `data-id="${atleta.id}"` }) })}`;
}

function conteudoCasais() {
  const nomes = estado.atletas.map((a) => [a.nome, a.nome]);
  return `
    ${grupo({
      celulas: `<li class="celula"><label class="chave"><span class="celula-texto">Manter casais juntos</span>
        <input type="checkbox" role="switch" data-acao="casais-ativado" ${estado.casais.ativado ? "checked" : ""} /></label></li>`,
      rodape: "Ligado, cada casal ativo cai no mesmo time no sorteio.",
    })}
    ${estado.casais.lista.length ? grupo({
      cabecalho: "Casais",
      celulas: estado.casais.lista.map((casal, i) => `<li class="celula">
        <label class="chave"><span class="celula-texto">${esc(casal.a)} e ${esc(casal.b)}${encontrarAtleta(estado.atletas, casal.a) && encontrarAtleta(estado.atletas, casal.b) ? "" : ' <span class="celula-subtexto alerta">fora da lista</span>'}</span>
          <input type="checkbox" role="switch" data-acao="casal-ativo" data-indice="${i}" ${casal.ativo ? "checked" : ""} aria-label="Casal ativo" /></label>
        <button class="botao-texto perigo" data-acao="remover-casal" data-indice="${i}">Remover</button></li>`).join(""),
    }) : ""}
    ${estado.atletas.length >= 2 ? grupo({
      cabecalho: "Novo casal",
      celulas: `<li class="celula celula-campo"><label for="casal-a">Pessoa 1</label><select id="casal-a">${opcoes([["", "Escolha"], ...nomes], "")}</select></li>
        <li class="celula celula-campo"><label for="casal-b">Pessoa 2</label><select id="casal-b">${opcoes([["", "Escolha"], ...nomes], "")}</select></li>
        ${celulaAcao("adicionar-casal", "Adicionar casal")}`,
    }) : ""}`;
}

/** Atualiza o conteúdo da folha aberta depois de uma alteração. */
function renderFolha() {
  if (!ui.folha) return;
  const conteudo = $("#folha-conteudo");
  const focado = document.activeElement?.id;
  if (ui.folha.tipo === "casais") conteudo.innerHTML = conteudoCasais();
  if (ui.folha.tipo === "amistoso-presenca") conteudo.innerHTML = conteudoPresencaAmistoso();
  if (ui.folha.tipo === "atleta") {
    const atleta = estado.atletas.find((a) => a.id === ui.folha.id);
    if (atleta) conteudo.innerHTML = conteudoAtleta(atleta);
    else fecharFolha();
  }
  if (focado) document.getElementById(focado)?.focus();
}

async function novoAtleta() {
  const salvarNovo = await abrirFolha({
    titulo: "Novo atleta",
    conteudo: grupo({ celulas: `
      <li class="celula celula-campo"><label for="novo-nome">Nome</label><input id="novo-nome" maxlength="80" autocomplete="off" /></li>
      <li class="celula celula-campo"><label for="novo-sexo">Sexo</label><select id="novo-sexo">${opcoesSexo("")}</select></li>
      <li class="celula celula-campo"><label for="novo-pote">Pote</label><select id="novo-pote">${opcoesPote("")}</select></li>` }),
    ok: "Adicionar",
  });
  if (!salvarNovo) return;
  const dados = { nome: $("#novo-nome").value, sexo: $("#novo-sexo").value, pote: $("#novo-pote").value };
  const atleta = executar(() => adicionarAtleta(estado, dados));
  if (atleta) avisar(`${atleta.nome} entrou no fim do grupo ${atleta.pote || "Sem pote"}.`);
}

async function importarMaster() {
  const colou = await abrirFolha({
    titulo: "Importar lista",
    conteudo: `<textarea id="texto-colado" rows="14" placeholder="*Lista Master - Vôlei Djalmer*" aria-label="Mensagem da Lista Master"></textarea>
      <p class="folha-texto">Cole a mensagem gerada por Exportar lista.</p>`,
    ok: "Continuar",
  });
  if (!colou) return;
  let lido;
  try { lido = lerMensagemMaster($("#texto-colado").value); } catch (erro) { avisar(erro.message, true); return; }
  const previa = previaImportacao(estado, lido);
  if (previa.repetidos.length) { avisar(`Nomes repetidos na mensagem: ${[...new Set(previa.repetidos)].join(", ")}.`, true); return; }
  const linha = (rotulo, nomes) => `<li class="celula"><span class="celula-texto">${rotulo}</span><span class="celula-detalhe">${nomes.length}</span></li>
    ${nomes.length ? `<li class="celula"><span class="celula-subtexto">${nomes.map(esc).join(", ")}</span></li>` : ""}`;
  const substituir = await abrirFolha({
    titulo: "Substituir lista",
    conteudo: grupo({
      celulas: `<li class="celula"><span class="celula-texto">Atletas na mensagem</span><span class="celula-detalhe">${previa.total}</span></li>
        ${linha("Novos", previa.novos)}${linha("Saem da lista", previa.removidos)}
        <li class="celula"><span class="celula-texto">Casais</span><span class="celula-detalhe">${previa.casais}</span></li>`,
      rodape: "A Lista Master atual será trocada pela da mensagem.",
    }),
    ok: "Substituir",
  });
  if (!substituir) return;
  if (executar(() => aplicarImportacao(estado, lido))) avisar(`Lista importada: ${plural(previa.total, "atleta", "atletas")}.`);
}

// ---- Amistoso -----------------------------------------------------------

const nomeTime = (time) => amistoso.times[time]?.nome ?? "";

/** "Maria Clara Batista" vira "Maria B." para caber na quadra. */
const nomeCurto = (nome) => {
  const partes = nome.trim().split(/\s+/);
  return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0];
};

const segmentado = (campo, rotulo) => `<li class="celula celula-segmento">
    <span class="celula-texto">${rotulo}</span>
    <span class="segmentado" role="radiogroup" aria-label="${rotulo}">${OPCOES[campo].map((valor) => `
      <button role="radio" aria-checked="${amistoso.config[campo] === valor}" data-acao="amistoso-config" data-campo="${campo}" data-valor="${valor}">${valor}</button>`).join("")}
    </span>
  </li>`;

const celulaEscolha = (acao, texto, marcado, extra = "") =>
  `<li><button class="celula celula-escolha" data-acao="${acao}" ${extra} aria-pressed="${marcado}">
    <span class="celula-texto">${texto}</span><span class="marca">${marcado ? ICONES.check : ""}</span>
  </button></li>`;

function conteudoPresencaAmistoso() {
  return amistoso.times.map((time, indice) => {
    const posicao = amistoso.ordem.indexOf(indice);
    const presentes = amistoso.presentes[indice];
    const faltam = EM_QUADRA - presentes.length;
    return `<section class="grupo time-presenca${posicao >= 0 ? " completo" : ""}">
      <h2 class="grupo-cabecalho cabecalho-time">
        ${posicao >= 0 ? `<span class="ordem-quadra" aria-label="${posicao + 1}º confirmado">${posicao + 1}º</span>` : ""}
        <span class="nome-time">${esc(time.nome)}</span>
        <span class="estado-time">${confirmado(amistoso, indice) ? `${presentes.length} de ${time.jogadores.length}` : `${faltam === 1 ? "falta 1" : `faltam ${faltam}`} para confirmar`}</span>
      </h2>
      <ul class="celulas">${time.jogadores.map((nome) => {
        const marcado = presentes.includes(nome);
        return `<li><button class="celula celula-checkin" data-acao="amistoso-presenca" data-time="${indice}" data-nome="${esc(nome)}" aria-pressed="${marcado}">
          <span class="circulo">${marcado ? ICONES.check : ""}</span>
          <span class="celula-texto">${esc(nome)}</span>
        </button></li>`;
      }).join("")}</ul>
    </section>`;
  }).join("");
}

/*
 * Quadra vista da linha de fundo de baixo. Índices 0..5 = posições 1..6.
 * Time de cima (espelhado): fundo 1 6 5, rede 2 3 4. Time de baixo: rede 4 3 2, fundo 5 6 1.
 */
const FILEIRAS = {
  superior: [["fundo", [0, 5, 4]], ["ataque", [1, 2, 3]]],
  inferior: [["ataque", [3, 2, 1]], ["fundo", [4, 5, 0]]],
};

function meiaQuadra(lado, quadra, { acao, sacando }) {
  const metade = lado === 0 ? "superior" : "inferior";
  return `<div class="meia-quadra ${metade}${ui.rodou === lado ? " rodou" : ""}">${FILEIRAS[metade].map(([fileira, posicoes]) => `
    <div class="fileira ${fileira}">${posicoes.map((p) => {
      const nome = quadra[p];
      const saca = sacando && p === 0;
      return `<button class="posicao${nome ? "" : " vazia"}${saca ? " sacando" : ""}" data-acao="${acao}" data-lado="${lado}" data-posicao="${p}"
          aria-label="Posição ${p + 1}: ${nome ? esc(nome) : "vazia"}${saca ? ", sacando" : ""}">
        <span class="numero-posicao">${p + 1}</span>
        <span class="nome-posicao">${nome ? esc(nomeCurto(nome)) : "Escolher"}</span>
        ${saca ? `<span class="bola">${ICONES.bola}</span>` : ""}
      </button>`;
    }).join("")}</div>`).join("")}
  </div>`;
}

function quadraDesenhada(times, quadras, { acao, saque = null, pontas }) {
  return `<div class="partida">
    ${pontas(0)}
    <div class="zona-livre"><div class="campo">
      ${meiaQuadra(0, quadras[0], { acao, sacando: saque === 0 })}
      <div class="rede" role="presentation"></div>
      ${meiaQuadra(1, quadras[1], { acao, sacando: saque === 1 })}
    </div></div>
    ${pontas(1)}
  </div>`;
}

function historicoAmistoso() {
  if (!amistoso.partidas.length) return "";
  return grupo({
    cabecalho: "Partidas",
    celulas: [...amistoso.partidas].reverse().map((partida) => {
      const lado = (i) => `<span class="${partida.times[i] === partida.vencedor ? "venceu" : ""}">${esc(nomeTime(partida.times[i]))} ${partida.placar[i]}</span>`;
      return `<li class="celula"><span class="rank">${partida.numero}</span><span class="celula-texto">${lado(0)} × ${lado(1)}</span></li>`;
    }).join(""),
  });
}

const rodapeAmistoso = () => `${historicoAmistoso()}
  ${grupo({ celulas: celulaAcao("amistoso-encerrar", "Encerrar amistosos", { perigo: true }), rodape: "Apaga times, presença e partidas e volta ao formulário." })}`;

const botaoPresenca = () => botaoBarra("amistoso-ver-presenca", "presenca", "Presença");

function renderAmistoso() {
  const tela = $("#tela-amistoso");
  const fase = amistoso.fase;

  if (fase === "config") {
    tela.innerHTML = `
      ${topo("Amistoso", amistoso.times.length ? plural(amistoso.times.length, "time pronto", "times prontos") : "Monte os times do amistoso")}
      ${grupo({
        cabecalho: "Formato",
        celulas: segmentado("times", "Times") + segmentado("maxAtletas", "Atletas por time") + segmentado("pontos", "Pontos"),
        rodape: "Ao colar a mensagem, times e atletas se ajustam a ela.",
      })}
      ${grupo({
        celulas: celulaAcao("amistoso-colar", amistoso.times.length ? "Colar outra mensagem" : "Colar times"),
        rodape: "Use a mensagem gerada por Enviar no WhatsApp na aba Times.",
      })}
      ${amistoso.times.map((time) => grupo({
        cabecalho: `${esc(time.nome)} <span class="contagem">${time.jogadores.length}</span>`,
        celulas: time.jogadores.map((nome) => `<li class="celula"><span class="celula-texto">${esc(nome)}</span></li>`).join(""),
      })).join("")}
      <div class="bloco-botao">
        <button class="botao-cheio" data-acao="amistoso-comecar" ${amistoso.times.length ? "" : "disabled"}>Começar amistosos</button>
      </div>`;
    return;
  }

  if (fase === "presenca") {
    const confirmados = amistoso.ordem.length;
    tela.innerHTML = `
      ${topo("Amistoso", `${confirmados} de ${amistoso.times.length} times confirmados`)}
      ${conteudoPresencaAmistoso()}
      <div class="bloco-botao">
        <button class="botao-cheio" data-acao="amistoso-confrontos" ${confirmados >= 2 ? "" : "disabled"}>Começar Partida 1</button>
        <p class="grupo-rodape">Um time confirma com ${EM_QUADRA} presentes. Os 2 primeiros abrem a Partida 1.</p>
      </div>
      ${rodapeAmistoso()}`;
    return;
  }

  const numero = amistoso.partidas.length + 1;

  if (fase === "escalacao") {
    const times = amistoso.proxima.times;
    const quadras = times.map((t) => amistoso.escalacoes[t] || Array(EM_QUADRA).fill(null));
    const opcoesTimes = opcoesAdversario(amistoso);
    const pronto = quadras.every((q) => q.every(Boolean)) && ui.saqueAmistoso !== null;
    tela.innerHTML = `
      ${topo(`Partida ${numero}`, `${nomeTime(times[0])} × ${nomeTime(times[1])}`, botaoPresenca())}
      ${amistoso.retorno !== null ? `<p class="aviso-partida">${esc(nomeTime(amistoso.retorno))} venceu 2 seguidas, descansa esta e volta contra o vencedor.</p>` : ""}
      ${opcoesTimes.length ? grupo({
        cabecalho: `Quem enfrenta o ${esc(nomeTime(times[0]))}`,
        celulas: opcoesTimes.map((t, i) => celulaEscolha("amistoso-adversario", `${esc(nomeTime(t))}${i === 0 ? ' <span class="celula-subtexto">próximo da fila</span>' : ""}`, t === times[1], `data-time="${t}"`)).join(""),
      }) : ""}
      <p class="grupo-rodape solto">Toque numa posição para escalar. Só aparecem atletas marcados como presentes.</p>
      ${quadraDesenhada(times, quadras, {
        acao: "amistoso-slot",
        pontas: (lado) => `<div class="ponta"><span class="ponta-nome">${esc(nomeTime(times[lado]))}</span><span class="ponta-detalhe">${quadras[lado].filter(Boolean).length} de ${EM_QUADRA}</span></div>`,
      })}
      ${grupo({
        cabecalho: "Quem começa sacando",
        celulas: times.map((t, lado) => celulaEscolha("amistoso-saque", esc(nomeTime(t)), ui.saqueAmistoso === lado, `data-lado="${lado}"`)).join(""),
      })}
      <div class="bloco-botao">
        <button class="botao-cheio" data-acao="amistoso-iniciar" ${pronto ? "" : "disabled"}>Começar partida</button>
      </div>
      ${rodapeAmistoso()}`;
    return;
  }

  // Jogo em andamento ou terminado (antes de seguir para a próxima).
  const atual = amistoso.atual;
  const { alvo, desempate, vencedor } = situacao(amistoso);
  const fim = vencedor !== null;
  const status = fim
    ? `<div class="resultado"><p><strong>${esc(nomeTime(atual.times[vencedor]))}</strong> venceu ${atual.placar[vencedor]} × ${atual.placar[1 - vencedor]}</p>
        <button class="botao-cheio" data-acao="amistoso-proxima">Próxima partida</button></div>`
    : `<p class="saque-linha">Saque: <strong>${esc(sacador(amistoso))}</strong> (${esc(nomeTime(atual.times[atual.saque]))})</p>
       ${desempate ? `<p class="desempate">Desempate: primeiro a ${alvo}</p>` : ""}`;
  tela.innerHTML = `
    ${topo(`Partida ${numero}`, `Jogo de ${amistoso.config.pontos} pontos`, botaoPresenca())}
    ${status}
    ${quadraDesenhada(atual.times, atual.quadras, {
      acao: "amistoso-substituir",
      saque: fim ? null : atual.saque,
      pontas: (lado) => {
        const info = `<div class="ponta${atual.saque === lado && !fim ? " com-saque" : ""}">
          <span class="ponta-nome">${esc(nomeTime(atual.times[lado]))}${atual.saque === lado && !fim ? ICONES.bola : ""}</span>
          <span class="ponta-placar">${atual.placar[lado]}</span></div>`;
        const botao = `<button class="botao-cheio botao-ponto" data-acao="amistoso-ponto" data-lado="${lado}" ${fim ? "disabled" : ""}>+ Ponto ${esc(nomeTime(atual.times[lado]))}</button>`;
        return lado === 0 ? info + botao : botao + info;
      },
    })}
    ${grupo({
      celulas: celulaAcao("amistoso-desfazer", "Desfazer último ponto", { desativado: !atual.desfazer.length }),
      rodape: fim ? "" : "Toque num atleta na quadra para substituir.",
    })}
    ${rodapeAmistoso()}`;
  ui.rodou = null;
}

async function colarTimesAmistoso() {
  const colou = await abrirFolha({
    titulo: "Colar times",
    conteudo: `<textarea id="texto-colado" rows="14" placeholder="*Times - Vôlei Djalmer*&#10;&#10;*Time Fulano*&#10;1. Nome&#10;..." aria-label="Mensagem de times"></textarea>
      <p class="folha-texto">De 2 a 4 times, cada um com 6 a 10 atletas.</p>`,
    ok: "Usar times",
  });
  if (!colou) return;
  let lidos;
  try { lidos = lerMensagemTimes($("#texto-colado").value); } catch (erro) { avisar(erro.message, true); return; }
  const resultado = executar(() => aplicarTimesAmistoso(amistoso, lidos));
  if (resultado) avisar(`${plural(resultado.times, "time carregado", "times carregados")}.${resultado.ajustado ? " Formato ajustado à mensagem." : ""}`);
}

/** Folha com uma lista de atletas para tocar e escolher. */
function escolherAtleta({ titulo, nomes, detalhe = () => "", acao, dados, vazio }) {
  const celulas = nomes.map((nome) => `<li><button class="celula celula-acao" data-acao="${acao}" ${dados} data-nome="${esc(nome)}">
      <span class="celula-texto">${esc(nome)}</span><span class="celula-detalhe">${detalhe(nome)}</span></button></li>`).join("");
  return abrirFolha({
    titulo,
    conteudo: nomes.length ? grupo({ celulas }) : `<p class="vazio">${esc(vazio)}</p>`,
    ok: "Fechar",
    cancelar: null,
  });
}

const acoesAmistoso = {
  "amistoso-config": (b) => executar(() => configurarAmistoso(amistoso, b.dataset.campo, b.dataset.valor)),
  "amistoso-colar": colarTimesAmistoso,
  "amistoso-comecar": () => executar(() => comecarAmistosos(amistoso)),
  "amistoso-presenca": (b) => executar(() => alternarPresencaAmistoso(amistoso, Number(b.dataset.time), b.dataset.nome)),
  "amistoso-ver-presenca": async () => {
    await abrirFolha({ titulo: "Presença", conteudo: conteudoPresencaAmistoso(), ok: "OK", cancelar: null, folha: { tipo: "amistoso-presenca" } });
    render();
  },
  "amistoso-confrontos": () => { ui.saqueAmistoso = null; executar(() => comecarConfrontos(amistoso)); },
  "amistoso-adversario": (b) => executar(() => trocarAdversario(amistoso, Number(b.dataset.time))),
  "amistoso-slot": (b) => {
    const lado = Number(b.dataset.lado);
    const posicao = Number(b.dataset.posicao);
    const time = amistoso.proxima.times[lado];
    const quadra = amistoso.escalacoes[time] || [];
    escolherAtleta({
      titulo: `${nomeTime(time)}, posição ${posicao + 1}`,
      nomes: amistoso.presentes[time].filter((nome) => quadra[posicao] !== nome),
      detalhe: (nome) => (quadra.includes(nome) ? `posição ${quadra.indexOf(nome) + 1}` : ""),
      acao: "amistoso-escalar",
      dados: `data-time="${time}" data-posicao="${posicao}"`,
      vazio: "Nenhum outro atleta presente. Marque a presença pelo botão no topo.",
    });
  },
  "amistoso-escalar": async (b) => {
    executar(() => escalar(amistoso, Number(b.dataset.time), Number(b.dataset.posicao), b.dataset.nome));
    await fecharFolha();
  },
  "amistoso-saque": (b) => { ui.saqueAmistoso = Number(b.dataset.lado); render(); },
  "amistoso-iniciar": () => {
    if (executar(() => iniciarPartida(amistoso, ui.saqueAmistoso))) ui.saqueAmistoso = null;
  },
  "amistoso-ponto": (b) => {
    const lado = Number(b.dataset.lado);
    ui.rodou = amistoso.atual.saque === lado ? null : lado;
    executar(() => marcarPonto(amistoso, lado));
  },
  "amistoso-desfazer": () => executar(() => desfazerPonto(amistoso)),
  "amistoso-substituir": (b) => {
    const lado = Number(b.dataset.lado);
    const posicao = Number(b.dataset.posicao);
    const time = amistoso.atual.times[lado];
    const quadra = amistoso.atual.quadras[lado];
    escolherAtleta({
      titulo: `Substituir ${quadra[posicao]}`,
      nomes: amistoso.presentes[time].filter((nome) => !quadra.includes(nome)),
      acao: "amistoso-trocar",
      dados: `data-lado="${lado}" data-posicao="${posicao}"`,
      vazio: `Nenhum reserva presente no ${nomeTime(time)}.`,
    });
  },
  "amistoso-trocar": async (b) => {
    const saiu = executar(() => substituir(amistoso, Number(b.dataset.lado), Number(b.dataset.posicao), b.dataset.nome));
    await fecharFolha();
    if (saiu) avisar(`${b.dataset.nome} entra, ${saiu} sai.`);
  },
  "amistoso-proxima": () => {
    const resultado = executar(() => encerrarPartida(amistoso));
    ui.saqueAmistoso = null;
    if (resultado?.descanso) avisar(`${nomeTime(resultado.vencedor)} venceu 2 seguidas e descansa esta partida.`);
    window.scrollTo(0, 0);
  },
  "amistoso-encerrar": async () => {
    if (await confirmar("Encerrar amistosos", "Times, presença, partidas e histórico do Amistoso serão apagados.", "Encerrar")) {
      ui.saqueAmistoso = null;
      executar(() => encerrarAmistosos(amistoso));
    }
  },
};

// ---- Eventos ----------------------------------------------------------

const acoesClique = {
  "ir": (b) => irPara(b.dataset.tela),
  "colar-lista": colarLista,
  "cadastrar-pendente": (b) => {
    const atleta = executar(() => resolverPendente(estado, b.dataset.nome, null));
    if (atleta) abrirEditor(atleta.id, `${atleta.nome} cadastrado. Defina sexo e pote.`);
  },
  "descartar-pendente": (b) => executar(() => {
    estado.lista.pendentes = estado.lista.pendentes.filter((nome) => nome !== b.dataset.nome);
  }),
  "limpar-lista": async () => {
    if (await confirmar("Limpar lista", "Todos os nomes saem da lista.", "Limpar")) {
      executar(() => { estado.lista = { ids: [], pendentes: [] }; });
    }
  },
  "nova-lista": async () => {
    if (!await confirmar("Nova lista", "Todos os nomes saem da lista. Em seguida, cole a lista do grupo com os 24 nomes.", "Começar")) return;
    executar(() => { estado.lista = { ids: [], pendentes: [] }; });
    await fecharFolha();
    colarLista();
  },
  "sortear": () => {
    const resultado = executar(() => {
      const { times, casaisAusentes } = sortearTimes(confirmadosParaSorteio(estado), { casais: casaisParaSorteio(estado) });
      definirTimes(estado, times);
      return { casaisAusentes };
    });
    if (!resultado) return;
    avisar(resultado.casaisAusentes.length ? `Casais sem os dois confirmados: ${resultado.casaisAusentes.join(", ")}.` : "Times sorteados.");
  },
  "colar-times": colarTimes,
  "desfazer-sorteio": () => { if (executar(() => desfazerTimes(estado))) avisar("Times anteriores restaurados."); },
  "compartilhar-times": () => compartilhar(gerarMensagemTimes(estado.times)),
  "checkin": (b) => executar(() => alternarCheckin(estado, estado.times[b.dataset.time].jogadores[b.dataset.jogador])),
  "zerar-presenca": async () => {
    if (await confirmar("Zerar presença", "Todos voltam a não ter chegado e a ordem em quadra é apagada.", "Zerar")) {
      executar(() => zerarCheckin(estado));
    }
  },
  "exportar": () => compartilhar(gerarMensagemMaster(estado.atletas, estado.casais.lista)),
  "importar": importarMaster,
  "novo-atleta": novoAtleta,
  "abrir-casais": async () => {
    await abrirFolha({ titulo: "Casais", conteudo: conteudoCasais(), ok: "OK", cancelar: null, folha: { tipo: "casais" } });
    render();
  },
  "editar": (b) => abrirEditor(b.dataset.id),
  "mover": (b) => {
    const atleta = estado.atletas.find((a) => a.id === b.dataset.id);
    const doPote = estado.atletas.filter((a) => a.pote === atleta.pote);
    const vizinho = doPote[doPote.indexOf(atleta) + Number(b.dataset.direcao)];
    if (!vizinho) return;
    executar(() => moverAtleta(estado, atleta.id, vizinho.id));
    const mesmo = $(`[data-acao="mover"][data-direcao="${b.dataset.direcao}"][data-id="${atleta.id}"]`);
    (mesmo && !mesmo.disabled ? mesmo : $(`[data-acao="mover"][data-id="${atleta.id}"]:not([disabled])`))?.focus();
  },
  "adicionar-alias": (b) => executar(() => { adicionarAlias(estado, b.dataset.id, $("#novo-alias").value); }),
  "remover-alias": (b) => executar(() => {
    estado.atletas.find((a) => a.id === b.dataset.id)?.aliases.splice(Number(b.dataset.indice), 1);
  }),
  "excluir-atleta": async (b) => {
    const atleta = estado.atletas.find((a) => a.id === b.dataset.id);
    if (!atleta) return;
    await fecharFolha();
    if (await confirmar(`Excluir ${atleta.nome}`, "O atleta sai da Lista Master e da lista de confirmados.", "Excluir")) {
      executar(() => removerAtleta(estado, atleta.id));
    }
  },
  "remover-casal": (b) => executar(() => { estado.casais.lista.splice(Number(b.dataset.indice), 1); }),
  "adicionar-casal": () => executar(() => {
    const a = $("#casal-a").value;
    const b = $("#casal-b").value;
    if (!a || !b) throw new Error("Escolha as duas pessoas do casal.");
    if (a === b) throw new Error("Escolha duas pessoas diferentes.");
    const ocupado = estado.casais.lista.find((c) => [c.a, c.b].includes(a) || [c.a, c.b].includes(b));
    if (ocupado) throw new Error(`${ocupado.a} e ${ocupado.b} já formam um casal.`);
    estado.casais.lista.push({ a, b, ativo: true });
  }),
  ...acoesAmistoso,
};

async function abrirEditor(id, aviso) {
  const atleta = estado.atletas.find((a) => a.id === id);
  if (!atleta) return;
  if (aviso) avisar(aviso);
  await abrirFolha({ titulo: "Atleta", conteudo: conteudoAtleta(atleta), ok: "OK", cancelar: null, folha: { tipo: "atleta", id } });
  render();
}

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
    const marcados = [...document.querySelectorAll(`[data-acao="adicional"][data-id="${el.dataset.id}"]:checked`)].map((c) => c.value);
    atualizarAtleta(estado, el.dataset.id, { potesAdicionais: NIVEIS.filter((p) => marcados.includes(p)) });
  }),
};

document.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-acao]");
  if (!botao || !acoesClique[botao.dataset.acao]) return;
  evento.preventDefault();
  acoesClique[botao.dataset.acao](botao);
});
document.addEventListener("change", (evento) => {
  const el = evento.target.closest("[data-acao]");
  if (el && acoesMudanca[el.dataset.acao]) acoesMudanca[el.dataset.acao](el);
});
document.addEventListener("input", (evento) => {
  if (evento.target.id === "busca-lista") { ui.buscaLista = evento.target.value; filtrar("#tela-lista", ui.buscaLista); }
  if (evento.target.id === "busca-master") { ui.buscaMaster = evento.target.value; filtrar("#tela-master", ui.buscaMaster); }
});
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Enter") return;
  if (evento.target.id === "novo-alias") { evento.preventDefault(); $("[data-acao=adicionar-alias]")?.click(); }
  if (evento.target.id === "campo-nome") { evento.preventDefault(); evento.target.blur(); return; }
  // Enter num campo da folha confirma (sem isso o navegador usaria o primeiro botão: Cancelar).
  if (evento.target.matches("#folha input")) { evento.preventDefault(); $("#folha-ok").click(); }
});

// Arrastar pela alça (dedo ou mouse), só dentro do mesmo pote.
let arrasto = null;
document.addEventListener("pointerdown", (evento) => {
  const alca = evento.target.closest("[data-alca]");
  if (!alca) return;
  evento.preventDefault();
  const item = alca.closest("li.atleta");
  arrasto = { id: item.dataset.id, item, alvo: null, grupo: item.closest(".grupo") };
  item.classList.add("arrastando");
  alca.setPointerCapture(evento.pointerId);
});
document.addEventListener("pointermove", (evento) => {
  if (!arrasto) return;
  const sob = document.elementFromPoint(evento.clientX, evento.clientY)?.closest("li.atleta");
  const alvo = sob && sob !== arrasto.item && sob.closest(".grupo") === arrasto.grupo ? sob : null;
  if (arrasto.alvo && arrasto.alvo !== alvo) arrasto.alvo.classList.remove("alvo");
  arrasto.alvo = alvo;
  alvo?.classList.add("alvo");
});
const soltar = () => {
  if (!arrasto) return;
  const { id, alvo, item } = arrasto;
  arrasto = null;
  item.classList.remove("arrastando");
  if (alvo) executar(() => moverAtleta(estado, id, alvo.dataset.id));
};
document.addEventListener("pointerup", soltar);
document.addEventListener("pointercancel", soltar);

// ---- Render -----------------------------------------------------------

function render() {
  ({ master: renderMaster, lista: renderLista, times: renderTimes, presenca: renderPresenca, amistoso: renderAmistoso })[ui.tela]();
  renderFolha();
}

irPara(ui.tela);
