// Drinking: pour one serving, post its effects, count down, and empty the Keg at zero.
import { DRINK_ACTIVITY_ID, FLAG_CONTENTS } from "./constants.mjs";
import { esc } from "./util.mjs";
import { kegContents, kegDescription, slotLine } from "./keg.mjs";

export async function drink(keg) {
  if (!keg?.isOwner) return ui.notifications.warn("Microbrew: you don't own that Keg.");
  const c = kegContents(keg);
  if (!c || !(c.servings > 0)) return ui.notifications.warn("Microbrew: the keg is empty. Brew something first!");

  // Who drinks: a selected token other than the Keg's owner (sharing a round), otherwise the owner.
  const owner = keg.actor;
  const selected = canvas.tokens?.controlled[0]?.actor;
  const drinker = selected && selected !== owner ? selected : owner;

  const left = c.servings - 1;
  const hasDrink = !!keg.system.activities?.get?.(DRINK_ACTIVITY_ID);
  const update = {};
  if (left > 0) {
    update[`flags.world.${FLAG_CONTENTS}.servings`] = left;
    update["system.description.value"] = kegDescription({ ...c, servings: left });
    if (hasDrink) update[`system.activities.${DRINK_ACTIVITY_ID}.uses.spent`] = c.maxServings - left;
  } else {
    update[`flags.world.-=${FLAG_CONTENTS}`] = null;
    update["system.description.value"] = kegDescription(null);
    if (hasDrink) update[`system.activities.-=${DRINK_ACTIVITY_ID}`] = null;
  }
  await keg.update(update);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: drinker }),
    content: `
<h3>🍻 ${esc(drinker.name)} drinks ${esc(c.name)}</h3>
<p><strong>Good:</strong> ${slotLine(c.good)}</p>
<p><strong>Bad:</strong> ${slotLine(c.bad)}</p>
<p><strong>Cosmetic:</strong> ${slotLine(c.cosmetic)}</p>
<p><em>${left > 0 ? `${left} of ${c.maxServings} serving(s) left in ${esc(owner.name)}'s keg.` : `That was the last serving. ${esc(owner.name)}'s keg is empty.`}</em></p>`,
  });
  return left;
}
