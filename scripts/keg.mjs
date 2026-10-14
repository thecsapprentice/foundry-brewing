import {
  KEG_NAME, BREW_ACTIVITY_ID, DRINK_ACTIVITY_ID, KEG_IMG, ALE_IMG, FLAG_CONTENTS, FLAG_TABLES,
} from "./constants.mjs";
import { esc } from "./util.mjs";

export const KEG_BASE_DESC = `<p><em>A squat oak cask banded in copper, its spigot shaped like a grinning toad. Whatever goes in comes out as ale, and something more.</em></p>
<p>As an action, drop three <strong>different</strong> ingredients into the keg to brew a batch of magic ale. Every serving carries one Good, one Bad, and one Cosmetic effect. Brewing a new batch pours out whatever is left of the old one.</p>
<p>When a player starts a brew, the DM fills in the recipe.</p>
<p>Use the <strong>Brew a Magic Ale</strong> activity, or @Microbrew[brew]{Brew a Magic Ale}.</p>
`;

export const BREW_ACTIVITY = {
  _id: BREW_ACTIVITY_ID, type: "utility", name: "Brew a Magic Ale", img: KEG_IMG, sort: 0,
  activation: { type: "action", value: 1, condition: "", override: false },
  duration: { units: "inst", concentration: false, override: false },
  range: { units: "self", override: false },
  description: { chatFlavor: "The keg gurgles and burbles as the ingredients go in..." },
};

export function drinkActivity(servings, brewName) {
  return {
    _id: DRINK_ACTIVITY_ID, type: "utility", name: "Drink Brew", img: ALE_IMG, sort: 1,
    activation: { type: "action", value: 1, condition: "", override: false },
    duration: { units: "inst", concentration: false, override: false },
    range: { units: "self", override: false },
    uses: { spent: 0, max: String(servings), recovery: [] },
    description: { chatFlavor: `A frothy pour of ${brewName}.` },
  };
}

/** Data for a brand-new, empty Keg. */
export function newKegData(tableUuids) {
  return {
    name: KEG_NAME, type: "consumable", img: KEG_IMG,
    system: {
      description: { value: kegDescription(null), chat: "" },
      quantity: 1, weight: { value: 15, units: "lb" },
      price: { value: 250, denomination: "gp" },
      rarity: "uncommon", identified: true,
      type: { value: "trinket", subtype: "" },
      activities: { [BREW_ACTIVITY_ID]: BREW_ACTIVITY },
    },
    flags: { world: { [FLAG_TABLES]: tableUuids } },
  };
}

export function isKeg(item) {
  if (!item || item.documentName !== "Item") return false;
  return !!(item.system?.activities?.get?.(BREW_ACTIVITY_ID) || item.name === KEG_NAME || item.getFlag?.("world", FLAG_TABLES));
}

export const kegContents = (keg) => keg.getFlag("world", FLAG_CONTENTS) ?? null;

/** The Keg's description: the base text plus whatever is on tap. */
export function kegDescription(c) {
  if (!c || !(c.servings > 0)) return KEG_BASE_DESC + `<hr><p><em>The keg is empty. Brew something!</em></p>`;
  return KEG_BASE_DESC + `<hr>
<h2>🍺 On Tap: ${esc(c.name)}</h2>
<p><em>Brewed by ${esc(c.brewer)} from <strong>${esc(c.ingredients[0])}</strong>, <strong>${esc(c.ingredients[1])}</strong>, and <strong>${esc(c.ingredients[2])}</strong>.</em></p>
<p><strong>Servings left: ${c.servings} of ${c.maxServings}.</strong> Use the <strong>Drink Brew</strong> activity, or @Microbrew[drink]{Drink a Serving}. Each serving applies all three effects.</p>
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
