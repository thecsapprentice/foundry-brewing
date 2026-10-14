import { MODULE_ID, TABLE_NAMES, TABLE_PACK } from "./constants.mjs";

export const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));
export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

/** Strip a single wrapping <p>…</p> from table result text. */
export const strip = (t) => String(t ?? "").trim().replace(/^<p>/i, "").replace(/<\/p>$/i, "");
export const resultText = (r) => strip(r?.getChatText?.() ?? r?.text ?? r?.description ?? "");

/** Text of the result a table gives for a roll value. */
export function textFor(table, value) {
  if (!table) return "(table missing)";
  const [res] = table.getResultsForRoll(value);
  return res ? resultText(res) : `(No result found for ${value}.)`;
}

/** Ingredient names → an order-independent key ("Honey, Ash" and "ash, HONEY" match). */
export const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
export const ingKey = (ings) => ings.map(slug).sort().join("__");

/** Smallest and largest values a table's results cover. */
export function tableRange(t) {
  const rs = t?.results?.contents ?? [...(t?.results ?? [])];
  if (!rs.length) return null;
  return { min: Math.min(...rs.map((r) => r.range[0])), max: Math.max(...rs.map((r) => r.range[1])) };
}

export const dieOf = (t) => (t?.formula || `1d${tableRange(t)?.max ?? "?"}`).replace(/^1d/i, "d");

export async function rollOn(t) {
  const roll = await new Roll(t.formula || `1d${tableRange(t).max}`).evaluate();
  return roll.total;
}

export const saysRollTwice = (text) => /roll twice more/i.test(text);

/** A roll plus, for "roll twice more" results, two extra distinct rolls. */
export async function rollWithExtras(table, value) {
  const extra = [];
  if (saysRollTwice(textFor(table, value))) {
    for (let tries = 0; extra.length < 2 && tries < 50; tries++) {
      const v = await rollOn(table);
      if (!saysRollTwice(textFor(table, v)) && !extra.includes(v)) extra.push(v);
    }
  }
  return extra;
}

/**
 * Resolve a table reference: a UUID ("RollTable.x" / "Compendium.…"), a bare world id
 * (older data), or — as a fallback for a slot — the default-named table (world first,
 * then this module's compendium).
 */
const tableCache = new Map();
export async function resolveTable(ref, fallbackKey = null) {
  if (ref) {
    if (tableCache.has(ref)) return tableCache.get(ref);
    const t = ref.includes(".") ? await fromUuid(ref) : game.tables.get(ref);
    if (t) {
      if (t.pack) tableCache.set(ref, t);
      return t;
    }
  }
  if (!fallbackKey) return null;
  return game.tables.getName(TABLE_NAMES[fallbackKey]) ?? (await defaultPackTable(fallbackKey));
}

export async function defaultPackTable(key) {
  const pack = game.packs.get(TABLE_PACK);
  if (!pack) return null;
  const idx = await pack.getIndex();
  const entry = idx.find((e) => e.name === TABLE_NAMES[key]);
  return entry ? pack.getDocument(entry._id) : null;
}

/** Every roll table available: world tables, then tables in compendiums. */
export async function allTables() {
  const out = game.tables.contents.map((t) => ({ uuid: t.uuid, name: t.name, source: "World" }));
  for (const p of game.packs.filter((p) => p.documentName === "RollTable")) {
    const idx = await p.getIndex();
    for (const e of idx) out.push({ uuid: e.uuid ?? `Compendium.${p.collection}.RollTable.${e._id}`, name: e.name, source: p.title });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

/** A promise-based Dialog with buttons. Resolves to { action, html } (action "close" if dismissed). */
export function buttonDialog({ title, content, buttons, defaultButton, render, width }) {
  return new Promise((resolve) => {
    const btns = {};
    for (const [key, b] of Object.entries(buttons)) {
      btns[key] = { icon: b.icon, label: b.label, callback: (html) => resolve({ action: key, html: html[0] ?? html }) };
    }
    new Dialog({ title, content, buttons: btns, default: defaultButton, render, close: () => resolve({ action: "close" }) }, width ? { width } : {}).render(true);
  });
}

export function readForm(root) {
  const form = root.querySelector("form");
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  for (const el of form.querySelectorAll('input[type="checkbox"]')) data[el.name] = el.checked;
  return data;
}

export const titleCase = (s) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/**
 * Let an input accept a dragged Item (from the Items sidebar, a compendium or a character sheet)
 * and fill in the item's name. Read-only: the dropped item is looked up, never changed.
 * Anything that isn't an Item is ignored, and the browser's default text drop is suppressed
 * so the raw drag data never ends up in the field.
 */
export function acceptItemDrop(input) {
  if (!input) return;
  input.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    input.classList.add("microbrew-drop-hover");
  });
  input.addEventListener("dragleave", () => input.classList.remove("microbrew-drop-hover"));
  input.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    input.classList.remove("microbrew-drop-hover");
    const name = await droppedItemName(ev);
    if (!name) return ui.notifications.warn("Microbrew: drop an Item here to use its name.");
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The name of the Item in a drop event, or null. */
export async function droppedItemName(ev) {
  let data;
  try {
    data = globalThis.TextEditor?.getDragEventData?.(ev) ?? JSON.parse(ev.dataTransfer?.getData("text/plain") || "null");
  } catch (e) {
    return null;
  }
  if (data?.type !== "Item") return null;
  if (data.data?.name) return String(data.data.name).trim() || null; // item data dragged directly
  if (!data.uuid) return null;
  try {
    const item = globalThis.fromUuidSync?.(data.uuid) ?? (await fromUuid(data.uuid));
    return item?.name ? String(item.name).trim() : null;
  } catch (e) {
    return null;
  }
}
