import {
  KEG_NAME, BREW_ACTIVITY_ID, DRINK_ACTIVITY_ID, KEG_IMG, ALE_IMG, FLAG_CONTENTS, FLAG_TABLES, FLAG_SKIN,
} from "./constants.mjs";
import { esc } from "./util.mjs";

/* -------------------------------------------- */
/*  Skins: per-Keg wording and description      */
/* -------------------------------------------- */

/** The DM's own description for an un-reskinned Keg. */
export const DEFAULT_DESCRIPTION = `<p><em>A squat oak cask banded in copper, its spigot shaped like a grinning toad. Whatever goes in comes out as ale, and something more.</em></p>
<p>As an action, drop three <strong>different</strong> ingredients into the keg to brew a batch of magic ale. Every serving carries one Good, one Bad, and one Cosmetic effect. Brewing a new batch pours out whatever is left of the old one.</p>
<p>When a player starts a brew, the DM fills in the recipe.</p>`;

/** Every word Microbrew uses about a Keg. A reskinned Keg stores its own copy in flags.world.microbrewSkin. */
export const DEFAULT_SKIN = Object.freeze({
  description: DEFAULT_DESCRIPTION,
  container: "keg",          // "The keg is empty."
  product: "ale",            // "Mint, Ash, Honey Ale"
  portion: "serving",        // "That was the last serving."
  portions: "servings",      // "4 servings"
  brewAction: "Brew a Magic Ale",
  drinkAction: "Drink Brew",
  brewVerb: "brews",         // "Pip brews Mint, Ash, Honey into a fresh keg"
  drinkVerb: "drinks",       // "Bram drinks Old Faithful"
  drinkImg: ALE_IMG,
});
export const SKIN_FIELDS = Object.keys(DEFAULT_SKIN);

/** The Keg's wording: its own skin over the defaults. Empty values fall back to the default. */
export function skinOf(keg) {
  const own = keg?.getFlag?.("world", FLAG_SKIN) ?? {};
  const out = { ...DEFAULT_SKIN };
  for (const k of SKIN_FIELDS) if (typeof own[k] === "string" && own[k].trim()) out[k] = own[k];
  return out;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "1 serving" / "3 servings" */
export const countOf = (n, skin) => `${n} ${n === 1 ? skin.portion : skin.portions}`;

/* -------------------------------------------- */
/*  Activities                                  */
/* -------------------------------------------- */

export function brewActivity(skin = DEFAULT_SKIN, img = KEG_IMG) {
  return {
    _id: BREW_ACTIVITY_ID, type: "utility", name: skin.brewAction, img, sort: 0,
    activation: { type: "action", value: 1, condition: "", override: false },
    duration: { units: "inst", concentration: false, override: false },
    range: { units: "self", override: false },
    description: { chatFlavor: "" },
  };
}

export function drinkActivity(servings, brewName, skin = DEFAULT_SKIN) {
  return {
    _id: DRINK_ACTIVITY_ID, type: "utility", name: skin.drinkAction, img: skin.drinkImg, sort: 1,
    activation: { type: "action", value: 1, condition: "", override: false },
    duration: { units: "inst", concentration: false, override: false },
    range: { units: "self", override: false },
    uses: { spent: 0, max: String(servings), recovery: [] },
    description: { chatFlavor: "" },
  };
}

/** Data for a brand-new, empty Keg (the default look). */
export function newKegData(tableUuids) {
  return {
    name: KEG_NAME, type: "consumable", img: KEG_IMG,
    system: {
      description: { value: kegDescription(null, DEFAULT_SKIN), chat: "" },
      quantity: 1, weight: { value: 15, units: "lb" },
      price: { value: 250, denomination: "gp" },
      rarity: "uncommon", identified: true,
      type: { value: "trinket", subtype: "" },
      activities: { [BREW_ACTIVITY_ID]: brewActivity() },
    },
    flags: { world: { [FLAG_TABLES]: tableUuids } },
  };
}

/**
 * Data for a new Keg copied from a template Keg (e.g. a reskinned one in the Items sidebar):
 * same look, wording, price and weight, but empty and using the given tables.
 */
export function kegFromTemplate(template, tableUuids) {
  const data = template.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  const skin = skinOf(template);
  data.flags ??= {};
  data.flags.world = { ...(data.flags.world ?? {}), [FLAG_TABLES]: tableUuids };
  delete data.flags.world[FLAG_CONTENTS];
  delete data.flags["activity-macro"];
  data.system.activities ??= {};
  delete data.system.activities[DRINK_ACTIVITY_ID];
  data.system.activities[BREW_ACTIVITY_ID] ??= brewActivity(skin, data.img);
  data.system.description = { ...(data.system.description ?? {}), value: kegDescription(null, skin) };
  return data;
}

export function isKeg(item) {
  if (!item || item.documentName !== "Item") return false;
  return !!(item.system?.activities?.get?.(BREW_ACTIVITY_ID) || item.name === KEG_NAME || item.getFlag?.("world", FLAG_TABLES));
}

/** A copy of what is in the Keg (a copy, so later updates to the Keg don't change it). */
export const kegContents = (keg) => foundry.utils.deepClone(keg.getFlag("world", FLAG_CONTENTS) ?? null);

/* -------------------------------------------- */
/*  Description                                 */
/* -------------------------------------------- */

/**
 * The Keg's description: the DM's own text (from the skin), then a section Microbrew writes:
 * how to brew, and whatever is currently inside.
 */
export function kegDescription(c, skin = DEFAULT_SKIN) {
  const brewLine = `<p>Use the <strong>${esc(skin.brewAction)}</strong> activity, or @Microbrew[brew]{${esc(skin.brewAction)}}.</p>`;
  if (!c || !(c.servings > 0)) {
    return `${skin.description}\n<hr>\n${brewLine}\n<p><em>The ${esc(skin.container)} is empty.</em></p>`;
  }
  return `${skin.description}\n<hr>\n${brewLine}
<h2>${esc(cap(skin.container))}: ${esc(c.name)}</h2>
<p><em>Made by ${esc(c.brewer)} from <strong>${esc(c.ingredients[0])}</strong>, <strong>${esc(c.ingredients[1])}</strong>, and <strong>${esc(c.ingredients[2])}</strong>.</em></p>
<p><strong>${esc(cap(skin.portions))} left: ${c.servings} of ${c.maxServings}.</strong> Use the <strong>${esc(skin.drinkAction)}</strong> activity, or @Microbrew[drink]{${esc(skin.drinkAction)}}. Each ${esc(skin.portion)} applies all three effects.</p>
<h3>Good Effect (${c.good.label ?? `d30: ${c.good.roll}`})</h3>
${slotHtml(c.good)}
<h3>Bad Effect (${c.bad.label ?? `d30: ${c.bad.roll}`})</h3>
${slotHtml(c.bad)}
<h3>Cosmetic Effect (${c.cosmetic.label ?? `d100: ${c.cosmetic.roll}`})</h3>
${slotHtml(c.cosmetic)}`;
}

/** A brewed effect as HTML; "roll twice more" results show their two extra results. */
export const slotHtml = (p) => (p.extra?.length ? p.extra.map((e) => `<p>${e.text}</p>`).join("") : `<p>${p.text}</p>`);
/** The same, on one line. */
export const slotLine = (p) => (p.extra?.length ? p.extra.map((e) => e.text).join(" <em>and</em> ") : p.text);

/** First Keg carried by the selected token's actor, or the user's character. */
export function kegOfControlled() {
  const actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character;
  return actor?.items.find(isKeg) ?? null;
}
