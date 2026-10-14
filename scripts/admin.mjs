// GM tools: Give a Keg, and Add / Remove / Clear recipes.
import { KEG_NAME, TABLE_NAMES, FLAG_TABLES, SLOT_LABEL } from "./constants.mjs";
import { esc, ingKey, tableRange, rollOn, rollWithExtras, allTables, resolveTable, buttonDialog, readForm, titleCase } from "./util.mjs";
import { newKegData, isKeg } from "./keg.mjs";
import { getRecipes, setRecipes, slotDisplay } from "./book.mjs";

const gmOnly = () => {
  if (game.user.isGM) return true;
  ui.notifications.warn("Microbrew: only a GM can do that.");
  return false;
};

/** Default choice for a slot: a world table with the default name, else this module's table. */
function defaultUuid(choices, key) {
  const named = choices.filter((c) => c.name === TABLE_NAMES[key]);
  return (named.find((c) => c.source === "World") ?? named[0])?.uuid ?? "";
}
function tableSelect(name, choices, selected, blank = "(choose a table)") {
  const opts = choices.map((c) => `<option value="${esc(c.uuid)}" ${c.uuid === selected ? "selected" : ""}>${esc(c.name)} — ${esc(c.source)}</option>`).join("");
  return `<select name="${name}"><option value="">${blank}</option>${opts}</select>`;
}

/* -------------------------------------------- */
/*  Give a Keg                                  */
/* -------------------------------------------- */

export async function giveKeg() {
  if (!gmOnly()) return;
  const actors = [...new Set(canvas.tokens?.controlled.map((t) => t.actor).filter(Boolean) ?? [])];
  if (!actors.length) return ui.notifications.warn("Microbrew: select the token(s) that should receive a Keg, then try again.");
  const choices = await allTables();
  if (!choices.length) return ui.notifications.warn("Microbrew: no roll tables found. Is the Microbrew module's compendium available?");
  const withKeg = actors.filter((a) => a.items.some(isKeg));
  const row = (k) => `<div class="form-group"><label>${SLOT_LABEL[k]} effects</label>${tableSelect(k, choices, defaultUuid(choices, k))}</div>`;
  const choice = await buttonDialog({
    title: "Microbrew — Give a Keg",
    content: `<form>
  <p>Giving a Microbrew Keg to <strong>${actors.map((a) => esc(a.name)).join(", ")}</strong>. Choose the tables it brews from:</p>
  ${row("good")}${row("bad")}${row("cosmetic")}
  <p class="hint">Tables can come from the world or any compendium. A result that says "roll twice more" draws two extra results from the same table. Tier names (Trivial … Legendary) only appear for the default Brewing Results tables.</p>
  ${withKeg.length ? `<div class="form-group"><label>Update existing Kegs</label><input type="checkbox" name="repoint">
    <p class="hint">${withKeg.map((a) => esc(a.name)).join(", ")} already carr${withKeg.length > 1 ? "y" : "ies"} a Keg. Tick to switch it to these tables instead of skipping. (The current brew stays in the Keg.)</p></div>` : ""}
</form>`,
    buttons: { give: { icon: '<i class="fas fa-gift"></i>', label: "Give Keg" }, cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" } },
    defaultButton: "give",
  });
  if (choice.action !== "give") return;
  const picked = readForm(choice.html);
  const missing = Object.keys(SLOT_LABEL).filter((k) => !picked[k]);
  if (missing.length) return ui.notifications.warn(`Microbrew: choose a table for: ${missing.map((k) => SLOT_LABEL[k]).join(", ")}. No Kegs were given.`);
  const uuids = { good: picked.good, bad: picked.bad, cosmetic: picked.cosmetic };
  const names = (await Promise.all(Object.values(uuids).map((u) => resolveTable(u)))).map((t) => t?.name ?? "?").join(" / ");

  // World tables must be readable by players for the Keg to show results
  for (const u of new Set(Object.values(uuids))) {
    const t = await resolveTable(u);
    if (t && !t.pack && (t.ownership.default ?? 0) < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) {
      await t.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
    }
  }

  const given = [], repointed = [], skipped = [];
  for (const a of actors) {
    const kegs = a.items.filter(isKeg);
    if (kegs.length) {
      if (!picked.repoint) { skipped.push(a.name); continue; }
      for (const k of kegs) await k.update({ [`flags.world.${FLAG_TABLES}`]: uuids });
      repointed.push(a.name);
      continue;
    }
    await a.createEmbeddedDocuments("Item", [newKegData(uuids)]);
    given.push(a.name);
  }
  if (given.length) ui.notifications.info(`Microbrew: gave a Keg to ${given.join(", ")} (${names}).`);
  if (repointed.length) ui.notifications.info(`Microbrew: switched ${repointed.join(", ")}'s Keg to ${names}.`);
  if (skipped.length) ui.notifications.warn(`Microbrew: ${skipped.join(", ")} already carr${skipped.length > 1 ? "y" : "ies"} a Keg, so no new one was added.`);
}

/* -------------------------------------------- */
/*  Add a Recipe                                */
/* -------------------------------------------- */

export async function addRecipe() {
  if (!gmOnly()) return;
  const choices = await allTables();
  const ranges = {};
  const rangeFor = async (uuid) => (ranges[uuid] ??= tableRange(await resolveTable(uuid)));
  const val = (v) => (v === undefined || v === null ? "" : esc(v));

  const slotFields = (k, prev) => {
    const mode = prev[`${k}-mode`] ?? "none";
    const opt = (v, label) => `<option value="${v}" ${mode === v ? "selected" : ""}>${label}</option>`;
    return `
  <fieldset style="margin:6px 0"><legend>${SLOT_LABEL[k]} effect</legend>
    <div class="form-group"><label>Source</label><select name="${k}-mode">${opt("none", "No effect")}${opt("text", "Custom text")}${opt("table", "Table roll")}</select></div>
    <div class="form-group"><label>Custom text</label><textarea name="${k}-text" rows="2" data-slot="${k}" data-mode="text">${val(prev[`${k}-text`])}</textarea></div>
    <div class="form-group"><label>Table</label>${tableSelect(`${k}-table`, choices, prev[`${k}-table`] ?? defaultUuid(choices, k), "(no table)").replace("<select ", `<select data-slot="${k}" data-mode="table" `)}</div>
    <div class="form-group"><label>Roll</label><input type="number" name="${k}-roll" data-slot="${k}" data-mode="table" placeholder="blank = roll it now" value="${val(prev[`${k}-roll`])}"></div>
  </fieldset>`;
  };
  const content = (prev, error) => `
<form class="microbrew-add">
  ${error ? `<p class="notification error" style="margin:0 0 6px">${esc(error)}</p>` : ""}
  <p>Add a recipe by hand. Typing text or entering a roll switches that effect's source automatically.</p>
  ${[1, 2, 3].map((n) => `<div class="form-group"><label>Ingredient ${n}</label><input type="text" name="ing${n}" value="${val(prev[`ing${n}`])}" ${n === 1 ? "autofocus" : ""}></div>`).join("")}
  <div class="form-group"><label>Recipe name</label><input type="text" name="name" placeholder="(automatic)" value="${val(prev.name)}"></div>
  ${Object.keys(SLOT_LABEL).map((k) => slotFields(k, prev)).join("")}
  <p class="hint">This recipe applies to every Keg and replaces anything already recorded for these three ingredients.</p>
</form>`;
  const render = (html) => {
    const root = html[0] ?? html;
    root.querySelectorAll?.("[data-slot]").forEach((el) => {
      const sync = () => {
        const sel = root.querySelector(`select[name="${el.dataset.slot}-mode"]`);
        if (sel && el.tagName !== "SELECT" && String(el.value).trim()) sel.value = el.dataset.mode;
      };
      el.addEventListener("input", sync);
    });
  };
  const validate = async (d) => {
    const ings = [d.ing1, d.ing2, d.ing3].map((x) => (x ?? "").trim());
    if (ings.some((x) => !x)) return "All three ingredients need a name.";
    if (new Set(ings.map((x) => x.toLowerCase())).size < 3) return "The three ingredients must be different.";
    for (const k of Object.keys(SLOT_LABEL)) {
      const mode = d[`${k}-mode`];
      if (mode === "text" && !String(d[`${k}-text`] ?? "").trim()) return `${SLOT_LABEL[k]} effect: type some text, or set its source to "No effect".`;
      if (mode === "table") {
        if (!d[`${k}-table`]) return `${SLOT_LABEL[k]} effect: choose a table.`;
        const r = await rangeFor(d[`${k}-table`]);
        if (!r) return `${SLOT_LABEL[k]} effect: that table has no results.`;
        const raw = String(d[`${k}-roll`] ?? "").trim();
        if (raw) {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < r.min || n > r.max) return `${SLOT_LABEL[k]} effect: the roll must be a whole number from ${r.min} to ${r.max}.`;
        }
      }
    }
    return null;
  };

  let data = null, error = null, prev = {};
  while (true) {
    const choice = await buttonDialog({
      title: "Microbrew — Add a Recipe", content: content(prev, error), render, width: 480, defaultButton: "save",
      buttons: { save: { icon: '<i class="fas fa-book"></i>', label: "Save Recipe" }, cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" } },
    });
    if (choice.action !== "save") return;
    prev = readForm(choice.html);
    error = await validate(prev);
    if (!error) { data = prev; break; }
  }

  const ingredients = [data.ing1, data.ing2, data.ing3].map((s) => s.trim());
  const name = String(data.name ?? "").trim() || `${ingredients.map(titleCase).join(", ")} Ale`;
  const buildSlot = async (k) => {
    const mode = data[`${k}-mode`];
    if (mode === "text") return { text: esc(String(data[`${k}-text`]).trim()).replace(/\r?\n/g, "<br>") };
    if (mode !== "table") return { none: true };
    const t = await resolveTable(data[`${k}-table`]);
    const raw = String(data[`${k}-roll`] ?? "").trim();
    const roll = raw ? Number(raw) : await rollOn(t);
    return { table: t.uuid, roll, extra: await rollWithExtras(t, roll) };
  };
  const record = {
    ingredients, name, manual: true,
    good: await buildSlot("good"), bad: await buildSlot("bad"), cosmetic: await buildSlot("cosmetic"),
    created: Date.now(), timesBrewed: 0,
  };

  const recipes = getRecipes();
  const key = `any__${ingKey(ingredients)}`;
  const clashes = Object.entries(recipes).filter(([, r]) => ingKey(r.ingredients ?? []) === ingKey(ingredients));
  if (clashes.length) {
    const ok = await Dialog.confirm({
      title: "Microbrew — Replace Recipe?",
      content: `<p>The Recipe Book already has ${clashes.length} recipe${clashes.length === 1 ? "" : "s"} for these ingredients:</p>
<ul>${clashes.map(([, r]) => `<li>${esc(r.name)}</li>`).join("")}</ul><p>Replace ${clashes.length === 1 ? "it" : "them"} with <strong>${esc(name)}</strong>?</p>`,
      defaultYes: false,
    });
    if (!ok) return ui.notifications.info("Microbrew: recipe not saved.");
    for (const [k] of clashes) delete recipes[k];
  }
  recipes[key] = record;
  await setRecipes(recipes);

  await ChatMessage.create({
    speaker: { alias: "Microbrew Recipe Book" },
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    content: `<h3>📖 Recipe added: ${esc(name)}</h3>
<p><em>${ingredients.map(esc).join(", ")}</em> (any Keg)</p>
<p><strong>Good:</strong> ${await slotDisplay(record, "good")}</p>
<p><strong>Bad:</strong> ${await slotDisplay(record, "bad")}</p>
<p><strong>Cosmetic:</strong> ${await slotDisplay(record, "cosmetic")}</p>`,
  });
  ui.notifications.info(`Microbrew: added "${name}" to the Recipe Book.`);
  return record;
}

/* -------------------------------------------- */
/*  Remove a Recipe / Clear the Recipe Book     */
/* -------------------------------------------- */

export async function removeRecipe() {
  if (!gmOnly()) return;
  const recipes = getRecipes();
  const entries = Object.entries(recipes).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  if (!entries.length) return ui.notifications.info("Microbrew: the Recipe Book is empty.");
  const note = async (r) => {
    if (r.manual) return " [added by DM, any Keg]";
    const names = await Promise.all(Object.keys(TABLE_NAMES).map(async (k) => (await resolveTable(r.tables?.[k], k))?.name ?? "?"));
    return names.some((n, i) => n !== Object.values(TABLE_NAMES)[i]) ? ` [${names.join(" / ")}]` : "";
  };
  const options = [];
  for (const [key, r] of entries) {
    options.push(`<option value="${esc(key)}">${esc(r.name)} (${r.ingredients.map(esc).join(", ")})${esc(await note(r))}, brewed ${r.timesBrewed ?? 0}×</option>`);
  }
  const choice = await buttonDialog({
    title: "Microbrew — Remove a Recipe",
    content: `<form>
  <div class="form-group"><label>Recipe</label><select name="recipe">${options.join("")}</select></div>
  <p class="hint">The chosen ingredient combination will brew fresh results next time. Brews already in Kegs are not affected.</p>
</form>`,
    buttons: { remove: { icon: '<i class="fas fa-trash"></i>', label: "Remove Recipe" }, cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" } },
    defaultButton: "cancel",
  });
  if (choice.action !== "remove") return;
  const key = readForm(choice.html).recipe;
  const removed = recipes[key];
  if (!removed) return;
  delete recipes[key];
  await setRecipes(recipes);
  ui.notifications.info(`Microbrew: removed "${removed.name}" (${removed.ingredients.join(", ")}) from the Recipe Book.`);
}

export async function clearRecipeBook() {
  if (!gmOnly()) return;
  const count = Object.keys(getRecipes()).length;
  if (!count) return ui.notifications.info("Microbrew: the Recipe Book is already empty.");
  const ok = await Dialog.confirm({
    title: "Microbrew — Clear Recipe Book",
    content: `<p>Forget all <strong>${count}</strong> recorded recipe${count === 1 ? "" : "s"}?</p>
<p>Every ingredient combination will brew fresh results next time. Brews already in Kegs are not affected. <strong>This can't be undone.</strong></p>`,
    defaultYes: false,
  });
  if (!ok) return;
  await setRecipes({});
  ui.notifications.info(`Microbrew: cleared ${count} recipe${count === 1 ? "" : "s"} from the Recipe Book.`);
}
