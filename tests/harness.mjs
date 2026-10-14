// Minimal mock of Foundry v12 + dnd5e 4 for exercising the Microbrew module in Node.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
export const log = [];
const note = (m) => log.push(m);

// ---------- update semantics (dotted paths, -= deletion) ----------
export function applyUpdate(obj, u) {
  for (const [path, val] of Object.entries(u)) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] ??= {}; o = o[parts[i]]; }
    const last = parts.at(-1);
    if (last.startsWith("-=")) delete o[last.slice(2)];
    else if (val && typeof val === "object" && !Array.isArray(val) && o[last] && typeof o[last] === "object") Object.assign(o[last], structuredClone(val));
    else o[last] = structuredClone(val);
  }
}
const coll = (arr) => Object.assign(arr, {
  get: (id) => arr.find((d) => d.id === id || d._id === id),
  getName: (n) => arr.find((d) => d.name === n),
  get contents() { return arr; },
});

// ---------- tables from the built pack ----------
function readPack(name) {
  // Read a temporary copy: opening a LevelDB rewrites its bookkeeping files, and the committed packs must not change.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "microbrew-pack-"));
  fs.cpSync(`${REPO}/packs/${name}`, tmp, { recursive: true });
  try {
    const out = execFileSync(`${REPO}/tools/ldbpack`, ["dump", tmp]).toString().trim().split("\n");
    return out.map((l) => { const i = l.indexOf("\t"); return [l.slice(0, i), JSON.parse(l.slice(i + 1))]; });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
export const packData = { tables: readPack("microbrew-tables"), items: readPack("microbrew-items"), macros: readPack("microbrew-macros"), names: readPack("microbrew-names") };

function mkTable(d, results, pack = null) {
  const t = { ...d, id: d._id, documentName: "RollTable", pack, uuid: pack ? `Compendium.${pack}.RollTable.${d._id}` : `RollTable.${d._id}`,
    ownership: { default: 0 }, results: { contents: results },
    getResultsForRoll: (v) => results.filter((r) => r.range[0] <= v && v <= r.range[1]).map((r) => ({ text: r.text })),
    async update(u) { applyUpdate(this, u); } };
  return t;
}
const packTables = (() => {
  const res = Object.fromEntries(packData.tables.filter(([k]) => k.startsWith("!tables.results!")).map(([k, v]) => [k.split("!")[2], v]));
  return packData.tables.filter(([k]) => k.startsWith("!tables!")).map(([, d]) =>
    mkTable(d, d.results.map((rid) => res[`${d._id}.${rid}`]), "microbrew.microbrew-tables"));
})();
export const customTable = mkTable({ _id: "aleBoons00000001", name: "Ale Boons", formula: "1d6" },
  [1, 2, 3, 4, 5].map((i) => ({ range: [i, i], text: `<p>Boon ${i}</p>` })).concat([{ range: [6, 6], text: "<p>Roll twice more on this table.</p>" }]));

// ---------- items / actors ----------
let idn = 0;
export function mkItem(data, actor = null) {
  const d = structuredClone(data);
  d._id ??= `item${String(++idn).padStart(12, "0")}`;
  const item = {
    ...d, id: d._id, documentName: "Item", actor, data: d,
    get name() { return this.data.name; }, get img() { return this.data.img; }, get flags() { return this.data.flags; }, get type() { return this.data.type; },
    get uuid() { return actor ? `Actor.${actor.id}.Item.${this.id}` : `Item.${this.id}`; },
    get isOwner() { return game.user.isGM || actor?.ownerId === game.user.id; },
    get system() { const s = this.data.system; return { ...s, activities: { get: (id) => s.activities?.[id] }, quantity: s.quantity }; },
    getFlag(scope, key) { if (!["world", "core", "dnd5e", "microbrew", "activity-macro"].includes(scope)) throw new Error(`Flag scope "${scope}" is not valid`); return this.data.flags?.[scope]?.[key]; },
    async update(u) { applyUpdate(this.data, u); },
    toObject() { return structuredClone(this.data); },
    async delete() { actor.items.splice(actor.items.indexOf(this), 1); },
  };
  return item;
}
export function mkActor(name, ownerId) {
  const a = { name, id: `actor${name}`, documentName: "Actor", ownerId, items: coll([]),
    async createEmbeddedDocuments(type, arr) { const made = arr.map((d) => mkItem(d, a)); a.items.push(...made); return made; },
    getActiveTokens: () => [] };
  return a;
}

// ---------- globals ----------
export const hooks = {};
export const sockets = { handlers: {}, emitted: [] };
export const dialogQueue = [];
export const dialogLog = [];
export const chat = [];
export const settings = {};
let book = null;
export const getBook = () => book;

export function installGlobals({ actors, worldItems = [], worldTables = [], users }) {
  globalThis.Handlebars = { escapeExpression: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") };
  globalThis.Hooks = {
    once: (n, f) => ((hooks[n] ??= []).push(f)), on: (n, f) => ((hooks[n] ??= []).push(f)),
  };
  globalThis.CONFIG = { TextEditor: { enrichers: [] } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  globalThis.foundry = { utils: {
    deepClone: (o) => structuredClone(o),
    isNewerVersion: (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return false; },
    randomID: () => Math.random().toString(36).slice(2, 18).padEnd(16, "0"),
  } };
  const listeners = [];
  globalThis.document = {
    addEventListener: (t, f) => listeners.push(f), _listeners: listeners,
    createElement: () => ({ classList: { list: [], add(c) { this.list.push(c); } }, dataset: {}, innerHTML: "" }),
  };
  globalThis.ui = { notifications: { info: (m) => note("INFO " + m), warn: (m) => note("WARN " + m), error: (m) => note("ERROR " + m) }, windows: {} };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.Roll = class { constructor(f) { this.f = f; } async evaluate() { this.total = 1 + Math.floor(Math.random() * +this.f.split("d")[1]); return this; } };
  globalThis.FormData = class { constructor(form) { this.d = form._data; } entries() { return Object.entries(this.d).filter(([, v]) => typeof v !== "boolean"); } };
  globalThis.Dialog = class {
    constructor(o) { this.o = o; }
    static async confirm(o) { const step = dialogQueue.shift(); dialogLog.push({ title: o.title, step: step?.action }); return step?.action === "yes"; }
    close() { this.o.close?.(); }
    render() {
      const step = dialogQueue.shift();
      if (!step) throw new Error(`Unexpected dialog: ${this.o.title}`);
      dialogLog.push({ title: this.o.title, buttons: Object.values(this.o.buttons).map((b) => b.label), step: step.action, error: /notification error/.test(this.o.content), content: this.o.content });
      if (step.action === "hold") return this; // stays open until the code closes it
      setTimeout(() => {
        if (step.action === "close") return this.o.close();
        const checkboxes = Object.entries(step.data ?? {}).filter(([, v]) => typeof v === "boolean").map(([name, checked]) => ({ name, checked }));
        const root = { querySelector: (sel) => (sel === "form" ? { _data: step.data ?? {}, querySelectorAll: () => checkboxes } : null), querySelectorAll: () => [] };
        this.o.buttons[step.action].callback([root]);
        this.o.close();
      });
      return this;
    }
  };
  const messages = coll([]);
  globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id, alias: actor?.name }),
    getSpeakerActor: (sp) => actors.find((a) => a.id === sp?.actor) ?? null,
    async create(data) {
      const m = { ...structuredClone(data), id: `msg${messages.length}`, author: game.user.id,
        getFlag(sc, k) { return this.flags?.[sc]?.[k]; },
        async update(u) { if (u.content) this.content = u.content; const r = { ...u }; delete r.content; applyUpdate(this, r); } };
      messages.push(m); chat.push(m); return m;
    },
  };
  globalThis.JournalEntry = {
    async create(d) {
      const pages = coll(d.pages.map((p) => ({ ...p, text: { ...p.text }, async update(u) { applyUpdate(this, u); } })));
      book = { ...d, flags: d.flags ?? {}, pages, getFlag(sc, k) { return this.flags?.[sc]?.[k]; }, async update(u) { applyUpdate(this, u); },
        async createEmbeddedDocuments(type, arr) { for (const p of arr) pages.push({ ...p, text: { ...p.text }, async update(u) { applyUpdate(this, u); } }); } };
      journal.push(book); return book;
    },
  };
  const journal = coll([]);
  const tables = coll([...worldTables]);
  const tablePack = {
    collection: "microbrew.microbrew-tables", documentName: "RollTable", title: "Microbrew: Brewing Tables",
    getIndex: async () => packTables.map((t) => ({ _id: t._id, name: t.name, uuid: t.uuid })),
    getDocument: async (id) => packTables.find((t) => t._id === id),
  };
  const packItems = packData.items.filter(([k]) => k.startsWith("!items!")).map(([, v]) => v);
  const itemPack = {
    collection: "microbrew.microbrew-items", documentName: "Item", title: "Microbrew: Kegs & Ingredients",
    getIndex: async ({ fields = [] } = {}) => packItems.map((v) => {
      const e = { _id: v._id, name: v.name, uuid: `Compendium.microbrew.microbrew-items.Item.${v._id}` };
      for (const f of fields) { const val = f.split(".").reduce((o, k) => o?.[k], v); if (val !== undefined) { let o = e; const ks = f.split("."); ks.slice(0, -1).forEach((k) => (o = o[k] ??= {})); o[ks.at(-1)] = val; } }
      return e;
    }),
  };
  const nameTables = (() => {
    const res = Object.fromEntries(packData.names.filter(([k]) => k.startsWith("!tables.results!")).map(([k, v]) => [k.split("!")[2], v]));
    return packData.names.filter(([k]) => k.startsWith("!tables!")).map(([, d]) => mkTable(d, d.results.map((rid) => res[`${d._id}.${rid}`]), "microbrew.microbrew-names"));
  })();
  const namesPack = {
    collection: "microbrew.microbrew-names", documentName: "RollTable", title: "Microbrew: Brew Names",
    getIndex: async () => nameTables.map((t) => ({ _id: t._id, name: t.name, uuid: t.uuid })),
    getDocuments: async () => nameTables,
    getDocument: async (id) => nameTables.find((t) => t._id === id),
  };
  const packs = coll([tablePack, itemPack, namesPack]);
  packs.get = (c) => packs.find((p) => p.collection === c);
  globalThis.fromUuid = async (u) => {
    const parts = u.split(".");
    if (u.startsWith("Compendium.")) return packTables.find((t) => t.uuid === u) ?? null;
    if (parts[0] === "RollTable") return tables.get(parts[1]) ?? null;
    if (parts[0] === "Actor") { const a = actors.find((x) => x.id === parts[1]); return a?.items.get(parts[3]) ?? null; }
    return null;
  };
  const userList = coll(users);
  globalThis.game = {
    system: { version: "4.4.0" },
    user: userList[0], users: Object.assign(userList, { get activeGM() { return userList.find((x) => x.isGM && x.active) ?? null; } }),
    actors: coll(actors), items: coll(worldItems), tables, journal, messages, packs,
    modules: new Map([["microbrew", { id: "microbrew" }]]),
    settings: {
      register: (m, k, cfg) => (settings[`${m}.${k}`] = structuredClone(cfg.default)),
      get: (m, k) => structuredClone(settings[`${m}.${k}`]),
      set: async (m, k, v) => { if (!game.user.isGM) throw new Error("players can't write world settings"); settings[`${m}.${k}`] = structuredClone(v); },
    },
    socket: { on: (ch, f) => ((sockets.handlers[ch] ??= []).push(f)), emit: (ch, data) => sockets.emitted.push({ ch, data }) },
  };
  globalThis.__journal = journal;
}

export const tick = () => new Promise((r) => setTimeout(r, 5));
export async function runHook(name, ...args) { for (const f of hooks[name] ?? []) await f(...args); }
