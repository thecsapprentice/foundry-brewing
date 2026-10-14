// Automatic brew names from the editable "Brew Name …" roll tables. Read-only: it only reads tables and ingredients.
//   Brew Name Theme: <X>   Biome: / Keyword: / Fallback: lines decide when a theme applies; Place/Person/Adjective/Force are words
//   Brew Name Moods        Good|Bad|Mixed Adjective / Feeling lines
//   Brew Name Adventurers  plain names
//   Brew Name Patterns     weighted patterns like "{Force}'s {Feeling} {Style}"
//   Brew Name Style: <X>   the last word; a Keg's skin picks the style
// World tables override the module's compendium tables of the same name, and new world tables with these prefixes join in.
import { MODULE_ID } from "./constants.mjs";
import { strip, tableRange } from "./util.mjs";
import { forageableIngredients } from "./forage.mjs";

const NAMES_PACK = `${MODULE_ID}.microbrew-names`;
const PREFIX = { theme: "Brew Name Theme:", style: "Brew Name Style:" };
const MOODS = "Brew Name Moods", ADVENTURERS = "Brew Name Adventurers", PATTERNS = "Brew Name Patterns";
const MAX_WORDS = 4;

/** All "Brew Name …" tables, by name: compendium first, then world tables (which win). */
async function nameTables() {
  const byName = new Map();
  const pack = game.packs.get(NAMES_PACK);
  if (pack) for (const t of await pack.getDocuments()) byName.set(t.name, t);
  for (const t of game.tables) if (t.name.startsWith("Brew Name")) byName.set(t.name, t);
  return byName;
}

/** A table's results as [{ kind, word, weight }]; "Kind: Word" lines, or plain words (kind ""). */
function lines(table) {
  const rs = table?.results?.contents ?? [...(table?.results ?? [])];
  return rs.map((r) => {
    const text = strip(r.text ?? r.description ?? "").replace(/<[^>]*>/g, "").trim();
    const i = text.indexOf(":");
    const hasKind = i > 0 && !text.startsWith("{") && /^[A-Za-z ]+$/.test(text.slice(0, i));
    return { kind: hasKind ? text.slice(0, i).trim().toLowerCase() : "", word: (hasKind ? text.slice(i + 1) : text).trim(), weight: Math.max(0, Number(r.weight ?? 1)) };
  }).filter((l) => l.word);
}

const pickWeighted = (list, rand) => {
  const total = list.reduce((s, l) => s + (l.weight ?? 1), 0);
  if (!list.length || total <= 0) return list[0];
  let r = rand() * total;
  for (const l of list) if ((r -= l.weight ?? 1) < 0) return l;
  return list.at(-1);
};

/** Names of the available styles (for the Reskin dialog). */
export async function nameStyles() {
  const t = await nameTables();
  return [...t.keys()].filter((n) => n.startsWith(PREFIX.style)).map((n) => n.slice(PREFIX.style.length).trim()).sort();
}

/**
 * How good and how bad the brew is, from 0 to 1, using where each roll falls on its table.
 * The default Bad table runs 1 = worst … 30 = mildest.
 */
function score(p, table, invert) {
  if (p?.roll == null || !table) return 0.5;
  const r = tableRange(table);
  if (!r || r.max === r.min) return 0.5;
  const x = (p.roll - r.min) / (r.max - r.min);
  return invert ? 1 - x : x;
}

/**
 * Generate a brew name, or null if the name tables aren't available.
 * @param {object} o
 * @param {string[]} o.ingredients
 * @param {object} o.good, o.bad      the brewed effects ({ roll })
 * @param {object} o.tables           the Keg's { good, bad } tables
 * @param {string} o.style            the Keg's name style ("Ale", "Potion", "Tea", …)
 * @param {Function} [o.rand]
 */
export async function generateBrewName({ ingredients, good, bad, tables = {}, style = "Ale", rand = Math.random }) {
  const t = await nameTables();
  const patterns = lines(t.get(PATTERNS));
  const styleTable = t.get(`${PREFIX.style} ${style}`) ?? t.get(`${PREFIX.style} Ale`);
  if (!patterns.length || !styleTable) return null;

  // ---- Themes: each ingredient votes by biome (2) and by keywords in its name (1)
  const biomeOf = new Map((await forageableIngredients()).map((i) => [i.name.toLowerCase(), i.biome]));
  const themes = [...t.entries()].filter(([n]) => n.startsWith(PREFIX.theme)).map(([n, table]) => {
    const ls = lines(table);
    const words = (k) => ls.filter((l) => l.kind === k);
    return {
      name: n.slice(PREFIX.theme.length).trim(),
      biomes: words("biome").map((l) => l.word.toLowerCase()),
      // a keyword matches at the start or end of a word: "ice" matches "Ice Lily" and "Rice", not "Spiced"
      keywords: words("keyword").map((l) => {
        const k = l.word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${k}|${k}\\b`, "i");
      }),
      fallback: words("fallback").some((l) => /^(yes|true)$/i.test(l.word)),
      place: words("place"), person: words("person"), adjective: words("adjective"), force: words("force"),
    };
  });
  const votes = new Map();
  for (const ing of ingredients) {
    const lower = ing.toLowerCase();
    const biome = biomeOf.get(lower)?.toLowerCase();
    for (const th of themes) {
      let v = 0;
      if (biome && th.biomes.includes(biome)) v += 2;
      if (th.keywords.some((k) => k.test(lower))) v += 1;
      if (v) votes.set(th, (votes.get(th) ?? 0) + v);
    }
  }
  if (!votes.size) {
    const fb = themes.filter((th) => th.fallback);
    if (fb.length) votes.set(fb[Math.floor(rand() * fb.length)], 1);
  }
  const theme = votes.size ? pickWeighted([...votes].map(([th, w]) => ({ th, weight: w })), rand).th : null;
  // a theme missing a kind of word borrows from the strongest other theme that has it
  const ranked = [...votes].sort((a, b) => b[1] - a[1]).map(([th]) => th);
  const themeWord = (kind) => {
    const src = [theme, ...ranked, ...themes.filter((th) => th.fallback)].find((th) => th?.[kind]?.length);
    return src ? pickWeighted(src[kind], rand).word : null;
  };

  // ---- Mood from the effects
  const g = score(good, tables.good, false), b = score(bad, tables.bad, true);
  const mood = g - b >= 0.33 ? "good" : b - g >= 0.33 ? "bad" : ["good", "bad", "mixed", "mixed"][Math.floor(rand() * 4)];
  const moodLines = lines(t.get(MOODS));
  const moodWord = (k) => {
    const ls = moodLines.filter((l) => l.kind === `${mood} ${k}`);
    return ls.length ? pickWeighted(ls, rand).word : null;
  };
  const adventurers = lines(t.get(ADVENTURERS));
  const titled = (s) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

  const fill = {
    Place: themeWord("place"), Person: themeWord("person"), Adjective: themeWord("adjective"), Force: themeWord("force"),
    Mood: moodWord("adjective"), Feeling: moodWord("feeling"),
    Adventurer: adventurers.length ? pickWeighted(adventurers, rand).word : null,
    Style: pickWeighted(lines(styleTable), rand)?.word ?? style,
    Ingredient: ingredients[0] ? titled(ingredients[0]) : null, Ingredient2: ingredients[1] ? titled(ingredients[1]) : null,
  };

  // ---- Pick a pattern that can be filled and isn't too long
  for (let tries = 0; tries < 25; tries++) {
    const pat = pickWeighted(patterns, rand)?.word;
    if (!pat) break;
    let ok = true;
    const name = pat.replace(/\{(\w+)\}/g, (_, k) => {
      if (!(k in fill) || !fill[k]) ok = false;
      return fill[k] ?? "";
    }).replace(/s's\b/g, "s'").replace(/\s+/g, " ").trim();
    const words = name.replace(/'s?\b/g, "").toLowerCase().split(/[\s-]+/).filter((w) => !["the", "&", "of"].includes(w));
    const repeats = words.some((w, i) => words.some((o, j) => j !== i && w.length > 2 && (o.startsWith(w) || w.startsWith(o))));
    if (ok && name && !repeats && name.replace(/'s\b/g, "").split(" ").length <= MAX_WORDS) return name;
  }
  return null;
}
