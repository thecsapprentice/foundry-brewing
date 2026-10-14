// GM tools: Give a Keg, and Add / Remove / Clear recipes.
import { KEG_NAME, KEG_IMG, TABLE_NAMES, FLAG_TABLES, FLAG_SKIN, SLOT_LABEL, BREW_ACTIVITY_ID, DRINK_ACTIVITY_ID } from "./constants.mjs";
import { esc, ingKey, tableRange, rollOn, rollWithExtras, allTables, resolveTable, buttonDialog, readForm, titleCase, acceptItemDrop } from "./util.mjs";
import { newKegData, kegFromTemplate, isKeg, skinOf, kegContents, kegDescription, DEFAULT_SKIN, SKIN_FIELDS } from "./keg.mjs";
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
  const templates = game.items.filter(isKeg).sort((a, b) => a.name.localeCompare(b.name));
  const templateRow = `<div class="form-group"><label>Look</label><select name="template">
    <option value="">Default Microbrew Keg</option>
    ${templates.map((t) => `<option value="${t.id}">${esc(t.name)} (Items sidebar)</option>`).join("")}
  </select><p class="hint">A Keg in the Items sidebar can be reskinned (Microbrew: Reskin a Keg) and used as the template for new ones.</p></div>`;
  const choice = await buttonDialog({
    title: "Microbrew — Give a Keg",
    content: `<form>
  <p>Giving a Microbrew Keg to <strong>${actors.map((a) => esc(a.name)).join(", ")}</strong>. Choose the tables it brews from:</p>
  ${templateRow}
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

  const given = [], repointed = [], skipped = [];
  for (const a of actors) {
    const kegs = a.items.filter(isKeg);
    if (kegs.length) {
      if (!picked.repoint) { skipped.push(a.name); continue; }
      for (const k of kegs) await k.update({ [`flags.world.${FLAG_TABLES}`]: uuids });
      repointed.push(a.name);
      continue;
    }
    const template = picked.template ? game.items.get(picked.template) : null;
    await a.createEmbeddedDocuments("Item", [template ? kegFromTemplate(template, uuids) : newKegData(uuids)]);
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
  <p>Add a recipe by hand. Type each ingredient, or drag an item onto the field to use its name. Typing text or entering a roll switches that effect's source automatically.</p>
  ${[1, 2, 3].map((n) => `<div class="form-group"><label>Ingredient ${n}</label><input type="text" name="ing${n}" value="${val(prev[`ing${n}`])}" placeholder="type, or drop an item" ${n === 1 ? "autofocus" : ""}></div>`).join("")}
  <div class="form-group"><label>Recipe name</label><input type="text" name="name" placeholder="(automatic)" value="${val(prev.name)}"></div>
  ${Object.keys(SLOT_LABEL).map((k) => slotFields(k, prev)).join("")}
  <p class="hint">This recipe applies to every Keg and replaces anything already recorded for these three ingredients.</p>
</form>`;
  const render = (html) => {
    const root = html[0] ?? html;
    ["ing1", "ing2", "ing3"].forEach((n) => acceptItemDrop(root.querySelector?.(`input[name="${n}"]`)));
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

/* -------------------------------------------- */
/*  Reskin a Keg                                */
/* -------------------------------------------- */

const RARITIES = { common: "Common", uncommon: "Uncommon", rare: "Rare", veryRare: "Very Rare", legendary: "Legendary", artifact: "Artifact" };
const DENOMS = ["cp", "sp", "ep", "gp", "pp"];
const WORDING = [
  ["container", "Container", "keg → kit, cauldron, still"],
  ["product", "What it makes", "ale → potion, tonic"],
  ["portion", "One portion", "serving → dose, draught"],
  ["portions", "Several portions", "servings → doses"],
  ["brewAction", "Brew activity name", "Brew a Magic Ale → Brew a Potion"],
  ["drinkAction", "Drink activity name", "Drink Brew → Drink Potion"],
  ["brewVerb", "Brewing verb", "brews → concocts, distills"],
  ["drinkVerb", "Drinking verb", "drinks → quaffs, downs"],
];

/** Pick which Keg to reskin: Kegs carried by selected tokens, then Kegs in the Items sidebar. */
async function pickKeg() {
  const owned = (canvas.tokens?.controlled ?? []).flatMap((t) => t.actor?.items.filter(isKeg) ?? []);
  const sidebar = game.items.filter(isKeg);
  const all = [...new Set([...owned, ...sidebar])];
  if (!all.length) {
    ui.notifications.warn("Microbrew: select a token carrying a Keg, or put a Keg in the Items sidebar (drag one from the Microbrew compendium).");
    return null;
  }
  if (all.length === 1) return all[0];
  const choice = await buttonDialog({
    title: "Microbrew — Reskin a Keg",
    content: `<form><div class="form-group"><label>Keg</label><select name="keg">
      ${all.map((k, i) => `<option value="${i}">${esc(k.name)} — ${k.actor ? esc(k.actor.name) : "Items sidebar"}</option>`).join("")}
    </select></div></form>`,
    buttons: { next: { icon: '<i class="fas fa-arrow-right"></i>', label: "Next" }, cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" } },
    defaultButton: "next",
  });
  return choice.action === "next" ? all[Number(readForm(choice.html).keg)] : null;
}

export async function reskinKeg(keg = null) {
  if (!gmOnly()) return;
  keg ??= await pickKeg();
  if (!keg) return;
  const skin = skinOf(keg);
  const val = (v) => (v === undefined || v === null ? "" : esc(v));
  const sys = keg.system;
  const content = (cur, error) => `
<form class="microbrew-reskin">
  ${error ? `<p class="notification error" style="margin:0 0 6px">${esc(error)}</p>` : ""}
  <p>Everything here belongs to this one ${esc(cur.name)}. Chat cards, dialogs and the description will use this wording. Leave a wording field blank to use the default.</p>
  <fieldset><legend>Item</legend>
    <div class="form-group"><label>Name</label><input type="text" name="name" value="${val(cur.name)}"></div>
    <div class="form-group"><label>Icon</label><input type="text" name="img" value="${val(cur.img)}"><button type="button" data-pick="img" style="flex:0 0 2em" title="Browse"><i class="fas fa-file-image"></i></button></div>
    <div class="form-group"><label>Price</label><input type="number" name="price" min="0" step="any" value="${val(cur.price)}">
      <select name="denomination">${DENOMS.map((d) => `<option value="${d}" ${d === cur.denomination ? "selected" : ""}>${d}</option>`).join("")}</select></div>
    <div class="form-group"><label>Weight (lb)</label><input type="number" name="weight" min="0" step="any" value="${val(cur.weight)}"></div>
    <div class="form-group"><label>Rarity</label><select name="rarity">${Object.entries(RARITIES).map(([k, l]) => `<option value="${k}" ${k === cur.rarity ? "selected" : ""}>${l}</option>`).join("")}</select></div>
  </fieldset>
  <fieldset><legend>Description</legend>
    <textarea name="description" rows="7" style="width:100%;font-family:monospace;font-size:12px">${val(cur.description)}</textarea>
    <p class="hint">HTML is allowed. Microbrew adds a section below this with the ${esc(cur.brewAction || DEFAULT_SKIN.brewAction)} link and whatever is inside. Edit the description here, not on the item sheet: the item sheet's description is rewritten on every brew.</p>
  </fieldset>
  <fieldset><legend>Wording</legend>
    ${WORDING.map(([k, label, hint]) => `<div class="form-group"><label>${label}</label><input type="text" name="${k}" value="${val(cur[k])}" placeholder="${esc(DEFAULT_SKIN[k])}" title="${esc(hint)}"></div>`).join("")}
    <div class="form-group"><label>Drink activity icon</label><input type="text" name="drinkImg" value="${val(cur.drinkImg)}" placeholder="${esc(DEFAULT_SKIN.drinkImg)}"><button type="button" data-pick="drinkImg" style="flex:0 0 2em" title="Browse"><i class="fas fa-file-image"></i></button></div>
  </fieldset>
</form>`;
  const render = (html) => {
    const root = html[0] ?? html;
    root.querySelectorAll?.("button[data-pick]").forEach((btn) => btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const input = root.querySelector(`input[name="${btn.dataset.pick}"]`);
      new FilePicker({ type: "image", current: input.value, callback: (path) => { input.value = path; } }).render(true);
    }));
  };

  let cur = {
    name: keg.name, img: keg.img, price: sys.price?.value ?? 0, denomination: sys.price?.denomination ?? "gp",
    weight: sys.weight?.value ?? 0, rarity: sys.rarity || "uncommon", ...skin,
  };
  let error = null;
  while (true) {
    const choice = await buttonDialog({
      title: `Microbrew — Reskin ${keg.name}`, content: content(cur, error), render, width: 520, defaultButton: "save",
      buttons: {
        save: { icon: '<i class="fas fa-paintbrush"></i>', label: "Save" },
        reset: { icon: '<i class="fas fa-rotate-left"></i>', label: "Reset to Default" },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" },
      },
    });
    if (choice.action === "cancel" || choice.action === "close") return null;
    if (choice.action === "reset") {
      const ok = await Dialog.confirm({
        title: "Microbrew — Reset Look",
        content: `<p>Reset <strong>${esc(keg.name)}</strong> to the default Microbrew Keg look and wording? Its tables and anything inside it are kept.</p>`,
        defaultYes: false,
      });
      if (!ok) continue;
      cur = { name: KEG_NAME, img: KEG_IMG, price: 250, denomination: "gp", weight: 15, rarity: "uncommon", ...DEFAULT_SKIN };
      break;
    }
    const d = readForm(choice.html);
    cur = { ...cur, ...d };
    const price = Number(d.price), weight = Number(d.weight);
    if (!String(d.name ?? "").trim()) error = "The item needs a name.";
    else if (!Number.isFinite(price) || price < 0) error = "Price must be a number of 0 or more.";
    else if (!Number.isFinite(weight) || weight < 0) error = "Weight must be a number of 0 or more.";
    else { error = null; break; }
  }

  const newSkin = {};
  for (const k of SKIN_FIELDS) newSkin[k] = String(cur[k] ?? "").trim() || DEFAULT_SKIN[k];
  const name = String(cur.name).trim(), img = String(cur.img).trim() || KEG_IMG;
  const update = {
    name, img,
    "system.price.value": Number(cur.price), "system.price.denomination": cur.denomination,
    "system.weight.value": Number(cur.weight), "system.rarity": cur.rarity,
    [`flags.world.${FLAG_SKIN}`]: newSkin,
    "system.description.value": kegDescription(kegContents(keg), newSkin),
  };
  if (keg.system.activities?.get?.(BREW_ACTIVITY_ID)) {
    update[`system.activities.${BREW_ACTIVITY_ID}.name`] = newSkin.brewAction;
    update[`system.activities.${BREW_ACTIVITY_ID}.img`] = img;
  }
  if (keg.system.activities?.get?.(DRINK_ACTIVITY_ID)) {
    update[`system.activities.${DRINK_ACTIVITY_ID}.name`] = newSkin.drinkAction;
    update[`system.activities.${DRINK_ACTIVITY_ID}.img`] = newSkin.drinkImg;
  }
  await keg.update(update);
  ui.notifications.info(`Microbrew: reskinned ${keg.actor ? `${keg.actor.name}'s ` : ""}${name}.`);
  return keg;
}
