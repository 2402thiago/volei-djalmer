(() => {
  const api = async (url, options = {}) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Não foi possível concluir a operação.");
    return body;
  };
  const esc = (value) => String(value || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const slug = location.pathname.match(/^\/lista\/([^/]+)$/)?.[1];
  const authorizeDrive = error => {
    if (/login novamente|autoriza.*google drive|autoriza.*drive/i.test(error.message)) {
      location.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`;
      return true;
    }
    return false;
  };

  const confirmed = value => value === "confirmado" || value === "promovido";
  const numbered = (items, status) => items.length ? items.map((item, index) => `${index + 1}. ${item.nome}${confirmed(item[status]) ? " ✅" : ""}`).join("\n") : "Nenhum";
  function whatsapp(data) {
    const event = data.event;
    const principal = data.registrations.filter(r => r.lista === "principal");
    const reserve = data.registrations.filter(r => r.lista === "reserva");
    const dataFormatada = event.data.split("-").reverse().join("/");
    return `https://wa.me/?text=${encodeURIComponent(`${event.titulo} ${dataFormatada}\n${event.hora_inicio}-${event.hora_fim}\nR$${event.valor || "a combinar"} pix: ${event.pix || "a informar"}\n\n${numbered(principal, "pagamento")}\n\nEspera Grupo\n${numbered(reserve, "pagamento")}\n\nConvidados\n${numbered(data.guests, "status")}`)}`;
  }
  async function publicPage() {
    const root = document.querySelector("#pagina-lista");
    const list = (items, status, empty) => items.map(item => `<li>${esc(item.nome)} ${confirmed(item[status]) ? "✅" : ""}</li>`).join("") || `<li>${empty}</li>`;
    const render = async () => {
      let data;
      try { data = await api(`/api/public/events/${encodeURIComponent(slug)}`); }
      catch (error) { root.innerHTML = `<h1>Lista indisponível</h1><p>${esc(error.message)}</p>`; return; }
      const event = data.event;
      root.innerHTML = `<h1>${esc(event.titulo)}</h1><p>${esc(event.data)} · ${esc(event.hora_inicio)} às ${esc(event.hora_fim)}</p><p>${event.maps_url ? `<a href="${esc(event.maps_url)}" target="_blank" rel="noopener">Como chegar</a>` : ""}</p><p>Valor: R$ ${esc(event.valor || "a combinar")}<br>PIX: ${esc(event.pix || "a informar")}</p><div class="linha linha-acoes"><button id="join" class="primario">Entrar na lista com Google</button><button id="refresh" class="secundario">Verificar lista atual</button><a id="share" class="secundario link-botao" href="${whatsapp(data)}" target="_blank" rel="noopener">Compartilhar no WhatsApp</a></div><div id="minha-inscricao"></div><h2>Lista principal</h2><ol>${list(data.registrations.filter(r => r.lista === "principal"), "pagamento", "Nenhum participante")}</ol><h2>Espera Grupo</h2><ol>${list(data.registrations.filter(r => r.lista === "reserva"), "pagamento", "Sem reserva")}</ol><h2>Convidados</h2><ol>${list(data.guests, "status", "Sem convidados")}</ol>`;
      document.querySelector("#refresh").onclick = render;
      bindJoinAndMine();
    };
    const bindJoinAndMine = async () => {
    document.querySelector("#join").onclick = async () => {
      try { await api(`/api/public/events/${encodeURIComponent(slug)}/join`, {method:"POST"}); location.reload(); }
      catch (error) { if (/login/i.test(error.message)) location.href = `/auth/login?next=${encodeURIComponent(location.pathname)}`; else alert(error.message); }
    };
    try {
      const mine = await api(`/api/public/events/${encodeURIComponent(slug)}/mine`);
      if (mine.registration) {
        document.querySelector("#join").textContent = "Você já está na lista";
        document.querySelector("#join").disabled = true;
        document.querySelector("#minha-inscricao").innerHTML = `<h2>Minha inscrição</h2><form id="proof"><input type="file" accept="image/jpeg,image/png,application/pdf" required /><button class="secundario">Enviar meu comprovante</button></form><form id="guest"><input maxlength="80" placeholder="Nome do convidado" required /><button class="secundario">Adicionar convidado</button></form><p>${mine.guests.map(g => `${esc(g.nome)} (${esc(g.status)})`).join("<br>")}</p>`;
        document.querySelector("#proof").onsubmit = async e => { e.preventDefault(); const form = new FormData(); form.append("subject_id", mine.registration.id); form.append("file", e.currentTarget.querySelector("input").files[0]); try { await api(`/api/public/events/${slug}/proofs`, {method:"POST", body:form}); alert("Comprovante enviado."); } catch (error) { if (!authorizeDrive(error)) alert(error.message); } };
        document.querySelector("#guest").onsubmit = async e => { e.preventDefault(); try { await api(`/api/public/events/${slug}/guests`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({nome:e.currentTarget.querySelector("input").value})}); location.reload(); } catch (error) { alert(error.message); } };
      }
    } catch (_) { /* A visitor may view the public list without a session. */ }
    };
    render();
  }
  async function organizerPage() {
    const message = document.querySelector("#msg-organizacao"), user = document.querySelector("#org-usuario");
    if (!message) return;
    const form = document.querySelector("#form-evento");
    const eventosAbertos = document.querySelector("#eventos-abertos");
    const bloquearFormulario = (bloquear) => form.querySelectorAll("input, button").forEach(element => { element.disabled = bloquear; });
    const carregarEventosAbertos = async () => {
      try {
        const eventos = await api("/api/organizacao/events");
        eventosAbertos.innerHTML = eventos.length ? eventos.map(evento => {
          const url = `${location.origin}/lista/${evento.slug}`;
          return `<article class="evento-aberto"><h3>${esc(evento.titulo)}</h3><p>${esc(evento.data)} · ${esc(evento.hora_inicio)}-${esc(evento.hora_fim)}</p><p>${evento.principais} de ${evento.capacidade} vagas principais · ${evento.reservas} na reserva</p><div class="linha linha-acoes"><a class="secundario link-botao" href="${url}" target="_blank" rel="noopener">Abrir lista</a><button class="secundario" data-gerenciar-evento="${esc(evento.slug)}">Gerenciar</button></div></article>`;
        }).join("") : '<p class="msg">Nenhum evento em aberto.</p>';
        eventosAbertos.querySelectorAll("[data-gerenciar-evento]").forEach(button => button.onclick = () => {
          document.querySelector("#comissao-slug").value = button.dataset.gerenciarEvento;
          document.querySelector("#btn-carregar-comprovantes").click();
        });
      } catch (error) { eventosAbertos.innerHTML = `<p class="msg erro">${esc(error.message)}</p>`; }
    };
    bloquearFormulario(true);
    try {
      const me = await api("/api/auth/me");
      user.textContent = me.email;
      const access = await api("/api/organizacao/access");
      if (access.allowed) {
        bloquearFormulario(false);
        message.textContent = "E-mail autorizado. Preencha os dados para criar a lista pública.";
        message.className = "msg";
        carregarEventosAbertos();
      } else {
        message.textContent = `O e-mail ${me.email} não está autorizado. Adicione-o na aba Acessos com ativo = sim.`;
        message.className = "msg erro";
      }
    } catch (error) {
      message.textContent = error.message.includes("Faça login") ? "Entre com Google para liberar a criação de eventos." : error.message;
      message.className = "msg erro";
    }
    document.querySelector("#btn-login-organizacao").onclick = () => location.href = "/auth/login?next=/";
    document.querySelector("#form-evento").onsubmit = async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.currentTarget));
      try {
        const event = await api("/api/organizacao/events", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
        const url = `${location.origin}/lista/${event.slug}`;
        message.innerHTML = `Evento criado: <a href="${url}" target="_blank" rel="noopener">${url}</a>`;
        carregarEventosAbertos();
      } catch (error) { message.textContent = error.message; message.className = "msg erro"; }
    };
    document.querySelector("#btn-carregar-comprovantes").onclick = async () => {
      const eventSlug = document.querySelector("#comissao-slug").value.trim();
      const list = document.querySelector("#lista-comprovantes");
      try {
        const details = await api(`/api/organizacao/events/${encodeURIComponent(eventSlug)}/details`);
        list.innerHTML = `<h3>Convidados</h3>${details.guests.map(g => g.status === "pendente" ? `<form class="proof-guest" data-guest="${g.id}"><strong>${esc(g.nome)}</strong> (${esc(g.status)}) <input type="file" accept="image/jpeg,image/png,application/pdf" required><button class="secundario">Enviar comprovante</button></form>` : `<p><strong>${esc(g.nome)}</strong> (${esc(g.status)})</p>`).join("") || "Nenhum."}<h3>Comprovantes privados</h3>${details.proofs.map(p => `<p><strong>${esc(p.subject_name)}</strong>: ${esc(p.nome_arquivo)} (${esc(p.status)}) <a href="/api/organizacao/proofs/${p.id}/download">Baixar</a> <button data-proof="${p.id}" ${p.status === "aprovado" ? "disabled" : ""}>Aprovar</button></p>`).join("") || "Nenhum comprovante."}`;
        list.querySelectorAll("form.proof-guest").forEach(form => form.onsubmit = async e => { e.preventDefault(); const body = new FormData(); body.append("file", form.querySelector("input").files[0]); try { await api(`/api/organizacao/events/${encodeURIComponent(eventSlug)}/guests/${form.dataset.guest}/proofs`, {method:"POST", body}); document.querySelector("#btn-carregar-comprovantes").click(); } catch (error) { if (!authorizeDrive(error)) alert(error.message); } });
        list.querySelectorAll("button[data-proof]").forEach(button => button.onclick = async () => { try { await api(`/api/organizacao/proofs/${button.dataset.proof}/approve`, {method:"POST"}); button.disabled = true; } catch (error) { alert(error.message); } });
      } catch (error) { list.textContent = error.message; }
    };
  }
  if (slug) publicPage(); else organizerPage();
})();
