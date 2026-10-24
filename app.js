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

  async function healthCheck() {
    if (!config.appsScriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\//.test(config.appsScriptUrl)) {
      throw new Error("URL oficial do Apps Script não configurado.");
    }
    const url = new URL(config.appsScriptUrl);
    url.searchParams.set("action", "health");
    const response = await fetch(url.toString(), { method: "GET", redirect: "follow", cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (data.status !== "ok" || data.service !== "espaco-angelica-apps-script") {
      throw new Error("A implantação respondeu, mas não corresponde ao contrato de saúde esperado.");
    }
    return data;
  }

  async function initialize() {
    const status = $("#booking-status");
    $("#booking-entry").hidden = false;
    showMessage($("#services"), "Catálogo ainda não ligado nesta fase. Não serão mostrados serviços fictícios.");
    showMessage($("#gallery"), "A galeria será ligada à pasta oficial do Drive após confirmar o identificador da pasta e os acessos.");
    $("#studio-address").textContent = "O endereço será carregado da configuração oficial depois de validar o contrato de leitura.";

    try {
      const health = await healthCheck();
      showMessage(status, "Apps Script acessível (" + new Date(health.timestamp).toLocaleString("pt-BR") + "). Nesta fase só testamos conectividade; não lemos dados pessoais nem gravamos na planilha.");
    } catch (error) {
      showMessage(status, "Não foi possível confirmar a ligação ao Apps Script: " + error.message + ". Serviços, preços, galeria e agendamentos permanecem desativados.");
    }
  }

  $("#admin-open").addEventListener("click", () => $("#admin-dialog").showModal());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();