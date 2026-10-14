// The Recipe Book: recipes live in a world setting; a journal entry shows them readably.
import { MODULE_ID, BOOK_NAME, TABLE_NAMES, FLAG_LEGACY_RECIPES } from "./constants.mjs";
import { esc, textFor, resolveTable } from "./util.mjs";

export const SETTING_RECIPES = "recipes";

export function registerBookSettings() {
  game.settings.register(MODULE_ID, SETTING_RECIPES, {
    scope: "world", config: false, type: Object, default: {},
  });
}

export const getRecipes = () => foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_RECIPES) ?? {});

/** Replace the whole recipe map and refresh the journal page. GM only. */
export async function setRecipes(recipes) {
  await game.settings.set(MODULE_ID, SETTING_RECIPES, recipes);
  await writeRecipePage(recipes);
}

/** Copy recipes recorded by the macro-based version (journal flags) into the setting, once. */
export async function migrateLegacyRecipes() {
  const book = game.journal.getName(BOOK_NAME);
  const legacy = book?.getFlag("world", FLAG_LEGACY_RECIPES);
  if (!legacy || !Object.keys(legacy).length) return 0;
  const current = getRecipes();
  let moved = 0;
  for (const [k, r] of Object.entries(legacy)) {
    if (!current[k]) { current[k] = r; moved++; }
  }
  await game.settings.set(MODULE_ID, SETTING_RECIPES, current);
  await book.update({ [`flags.world.-=${FLAG_LEGACY_RECIPES}`]: null });
  await writeRecipePage(current);
  return moved;
}

async function ensureBook() {
  let book = game.journal.getName(BOOK_NAME);
  if (!book) {
    book = await JournalEntry.create({
      name: BOOK_NAME,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      pages: [{ name: "Recipes", type: "text", text: { content: "" } }],
    });
  }
  return book;
}

/** One effect slot of a recipe as display text: no effect, custom text, or a table roll. */
export async function slotDisplay(r, k) {
  const sl = r[k];
  if (!sl || sl.none) return "<em>No effect</em>";
  if (sl.text != null) return `${sl.text} <small>(custom)</small>`;
  const t = await resolveTable(sl.table ?? r.tables?.[k], k);
  if (!t) return `[${sl.roll}] (table missing)`;
  const main = sl.extra?.length ? sl.extra.map((v) => textFor(t, v)).join(" <em>and</em> ") : textFor(t, sl.roll);
  const named = t.name !== TABLE_NAMES[k] ? ` <small>(${esc(t.name)})</small>` : "";
  return `[${sl.roll}] ${main}${named}`;
}

export async function recipePage(recipes) {
  const rows = [];
  for (const r of Object.values(recipes).sort((a, b) => a.name.localeCompare(b.name))) {
    const note = r.manual ? "<br><small>Added by the DM · any Keg</small>" : "";
    const brewed = r.timesBrewed ? `${r.timesBrewed}×${r.firstBrewer ? ` (first by ${esc(r.firstBrewer)})` : ""}` : "not yet";
    rows.push(`<tr><td><strong>${esc(r.name)}</strong><br><em>${r.ingredients.map(esc).join(", ")}</em>${note}</td>
<td>${await slotDisplay(r, "good")}</td>
<td>${await slotDisplay(r, "bad")}</td>
<td>${await slotDisplay(r, "cosmetic")}</td>
<td>${brewed}</td></tr>`);
  }
  return `<p><em>Kept by the Microbrew Keg. Every combination of three ingredients (in any order) always brews the same results with the same tables. Recipes added by the DM apply to every Keg. This page is rewritten after each change, so edits here won't stick.</em></p>
<table><thead><tr><th>Brew</th><th>Good</th><th>Bad</th><th>Cosmetic</th><th>Brewed</th></tr></thead>
<tbody>${rows.join("\n")}</tbody></table>`;
}

export async function writeRecipePage(recipes) {
  try {
    const book = await ensureBook();
    const content = await recipePage(recipes);
    // Only ever touch the page named "Recipes"; any other pages in the journal are left alone.
    const page = book.pages.getName("Recipes");
    if (page) await page.update({ "text.content": content });
    else await book.createEmbeddedDocuments("JournalEntryPage", [{ name: "Recipes", type: "text", text: { content } }]);
  } catch (e) {
    console.error(`${MODULE_ID} | couldn't update the Recipe Book page`, e);
    ui.notifications.warn("Microbrew: the Recipe Book page couldn't be updated. See the console (F12).");
  }
}
