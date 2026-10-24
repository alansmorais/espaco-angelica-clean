(() => {
  const config = window.ANGELICA_CONFIG || {};
  const $ = selector => document.querySelector(selector);
  $("#year").textContent = String(new Date().getFullYear());

  function showMessage(target, message) {
    if (!target) return;
    target.replaceChildren();
    const p = document.createElement("p");
    p.textContent = message;
    target.appendChild(p);
  }

  async function readAction(action) {
    if (!config.appsScriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\//.test(config.appsScriptUrl)) {
      throw new Error("URL oficial do Apps Script não configurado.");
    }
    const url = new URL(config.appsScriptUrl);
    url.searchParams.set("action", action);
    const response = await fetch(url.toString(), { method: "GET", redirect: "follow", cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("Resposta JSON inválida.");
    return payload;
  }

  function listFrom(payload, keys) {
    for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
    if (payload.data && typeof payload.data === "object") {
      for (const key of keys) if (Array.isArray(payload.data[key])) return payload.data[key];
    }
    return null;
  }

  function renderServices(items) {
    const root = $("#services"); root.replaceChildren();
    const active = items.filter(item => item && item.active !== false);
    if (!active.length) { showMessage(root, "Nenhum serviço ativo devolvido pela planilha oficial."); return; }
    active.forEach(item => {
      const card = document.createElement("article"); card.className = "service-card";
      const title = document.createElement("h3"); title.textContent = String(item.title || item.name || item.nome || "Serviço");
      const description = document.createElement("p"); description.textContent = String(item.description || item.descricao || "");
      const price = document.createElement("p"); price.className = "service-price";
      const value = item.price ?? item.preco ?? item.valor;
      price.textContent = value === undefined || value === null || value === "" ? "Preço não informado na resposta." : (item.priceFormatted || ("R$ " + String(value)));
      card.append(title, description, price); root.appendChild(card);
    });
  }

  function renderGallery(items) {
    const root = $("#gallery"); root.replaceChildren();
    items.forEach(item => {
      const src = typeof item === "string" ? item : (item.url || item.imageUrl || item.thumbnailUrl || item.src);
      if (typeof src !== "string" || !/^https:\/\//.test(src)) return;
      const card = document.createElement("figure"); card.className = "gallery-card";
      const img = document.createElement("img"); img.loading = "lazy"; img.src = src; img.alt = "Foto oficial do Espaço Angélica do Carmo";
      card.appendChild(img); root.appendChild(card);
    });
    if (!root.children.length) showMessage(root, "Nenhuma foto oficial utilizável foi devolvida. Sem imagens de exemplo.");
  }

  async function initialize() {
    const status = $("#booking-status");
    let failCount = 0;
    const tasks = [
      readAction("getServices").then(payload => {
        if (payload.status === "error" || payload.success === false) throw new Error(payload.message || payload.error || "Falha no catálogo.");
        const items = listFrom(payload, ["services", "servicos", "items"]);
        if (!items) throw new Error("A resposta de serviços não contém uma lista reconhecida.");
        renderServices(items);
      }).catch(error => { failCount++; showMessage($("#services"), "Catálogo indisponível: " + error.message); }),
      readAction("getPublicStudioAddress").then(payload => {
        if (payload.status === "error" || payload.success === false) throw new Error(payload.message || payload.error || "Falha no endereço.");
        const address = payload.address || payload.studioAddress || payload.data?.address;
        $("#studio-address").textContent = typeof address === "string" && address.trim() ? address : "Resposta sem campo de endereço reconhecido.";
      }).catch(error => { failCount++; $("#studio-address").textContent = "Endereço indisponível: " + error.message; }),
      readAction("getPublicGalleryPhotos").then(payload => {
        if (payload.status === "error" || payload.success === false) throw new Error(payload.message || payload.error || "Falha na galeria.");
        const items = listFrom(payload, ["photos", "images", "gallery", "items"]);
        if (!items) throw new Error("A resposta da galeria não contém uma lista reconhecida.");
        renderGallery(items);
      }).catch(error => { failCount++; showMessage($("#gallery"), "Galeria indisponível: " + error.message); })
    ];
    await Promise.allSettled(tasks);
    $("#booking-entry").hidden = false;
    showMessage(status, failCount ? "A leitura ainda precisa ser compatibilizada com a resposta real do Apps Script. Nenhum agendamento foi criado; operações de escrita continuam desativadas." : "Leituras concluídas. Pré-visualização em modo de leitura: agendamentos e gravações permanecem desativados.");
  }

  $("#admin-open").addEventListener("click", () => $("#admin-dialog").showModal());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})();