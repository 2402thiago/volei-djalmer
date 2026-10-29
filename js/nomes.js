// Utilidades de nomes e identificadores compartilhadas pelos módulos.

export const normalizarNome = (nome) => String(nome || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const novoId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
