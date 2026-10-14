/**
 * Microbrew — magical brewing for Foundry VTT v12 + dnd5e 4.x.
 * Entry point: settings, the @Microbrew[...] link enricher, the Keg activity hook,
 * the GM socket for brewing requests, migration from the macro-based version, and the API.
 */
import {
  MODULE_ID, SOCKET, BREW_ACTIVITY_ID, DRINK_ACTIVITY_ID, KEG_IMG, ALE_IMG,
} from "./constants.mjs";
import { log } from "./util.mjs";
import { isKeg, kegContents, kegDescription, kegOfControlled, drinkActivity, skinOf } from "./keg.mjs";
import { registerBookSettings, migrateLegacyRecipes, getRecipes, writeRecipePage } from "./book.mjs";
import { startBrew, openRequest } from "./brew.mjs";
import { drink } from "./drink.mjs";
import { giveKeg, addRecipe, removeRecipe, clearRecipeBook, reskinKeg } from "./admin.mjs";

const SETTING_MIGRATION = "migrationVersion";
// Icon paths the macro-based version used that don't exist in Foundry's icon set
const OLD_ICONS = ["icons/containers/barrels/barrel-open-brown-red.webp", "icons/consumables/drinks/beer-stein-wooden-metal-brown.webp"];
const MIGRATION_VERSION = 1;

/* -------------------------------------------- */
/*  Links: @Microbrew[brew|drink|request]{Label} */
/* -------------------------------------------- */

const LINK_ICON = { brew: "fa-beer-mug-empty", drink: "fa-wine-bottle", request: "fa-scroll" };
const LINK_LABEL = { brew: "Brew a Magic Ale", drink: "Drink a Serving", request: "Open the brewing dialog" };

function registerEnricher() {
  CONFIG.TextEditor.enrichers.push({
    pattern: /@Microbrew\[(brew|drink|request)\](?:\{([^}]+)\})?/g,
    enricher: async (match) => {
      const [, action, label] = match;
      const a = document.createElement("a");
      a.classList.add("microbrew-link");
      a.dataset.microbrew = action;
      a.innerHTML = `<i class="fas ${LINK_ICON[action]}"></i> ${label ?? LINK_LABEL[action]}`;
      return a;
    },
  });
}

/** Find the Keg a link was clicked in: an item row, an item sheet, an actor sheet, a chat card. */
function kegFromElement(el) {
  const appEl = el.closest("[data-appid]");
  const app = appEl ? ui.windows[appEl.dataset.appid] : null;
  const doc = app?.document ?? app?.object;
  const itemId = el.closest("[data-item-id]")?.dataset.itemId;
  if (doc?.documentName === "Actor" && itemId) {
    const it = doc.items.get(itemId);
    if (isKeg(it)) return it;
  }
  if (doc?.documentName === "Item" && isKeg(doc)) return doc;
  if (doc?.documentName === "Actor") return doc.items.find(isKeg) ?? null;
  const msgId = el.closest("[data-message-id]")?.dataset.messageId;
  const msg = msgId ? game.messages.get(msgId) : null;
  const speaker = msg ? ChatMessage.getSpeakerActor(msg.speaker) : null;
  if (speaker) return speaker.items.find(isKeg) ?? null;
  return kegOfControlled();
}

async function onLinkClick(event) {
  const a = event.target.closest?.("a.microbrew-link");
  if (!a) return;
  event.preventDefault();
  event.stopPropagation();
  const action = a.dataset.microbrew;
  if (action === "request") {
    const msg = game.messages.get(a.closest("[data-message-id]")?.dataset.messageId);
    return msg ? openRequest(msg) : ui.notifications.warn("Microbrew: couldn't find that request.");
  }
  const keg = kegFromElement(a);
  if (!keg) return ui.notifications.warn("Microbrew: select a token (or assign a character) that carries a Microbrew Keg.");
  return action === "brew" ? startBrew(keg) : drink(keg);
}

/* -------------------------------------------- */
/*  Socket: a player's brewing request pops the dialog on the active GM's screen */
/* -------------------------------------------- */

function registerSocket() {
  game.socket.on(SOCKET, async (data) => {
    if (data?.action !== "brewRequest") return;
    if (!game.user.isGM || game.user !== game.users.activeGM) return;
    let msg = null;
    for (let i = 0; i < 10 && !msg; i++) {
      msg = game.messages.get(data.messageId);
      if (!msg) await new Promise((r) => setTimeout(r, 300));
    }
    if (msg) await openRequest(msg);
  });
}

/* -------------------------------------------- */
/*  Migration from the macro-based version      */
/* -------------------------------------------- */


async function migrate() {
  if (!game.user.isGM || game.user !== game.users.activeGM) return;
  if ((game.settings.get(MODULE_ID, SETTING_MIGRATION) ?? 0) >= MIGRATION_VERSION) return;
  const kegs = [...game.items.filter(isKeg), ...game.actors.contents.flatMap((a) => a.items.filter(isKeg))];
  for (const keg of kegs) {
    const c = kegContents(keg);
    const update = {
      "system.description.value": kegDescription(c, skinOf(keg)),
      ...(OLD_ICONS.includes(keg.img) ? { img: KEG_IMG } : {}),
      // The module runs these activities itself now; stop Activity Macro running the old macros too.
      [`flags.activity-macro.-=${BREW_ACTIVITY_ID}`]: null,
      [`flags.activity-macro.-=${DRINK_ACTIVITY_ID}`]: null,
    };
    for (const [id, img] of [[BREW_ACTIVITY_ID, KEG_IMG], [DRINK_ACTIVITY_ID, ALE_IMG]]) {
      if (OLD_ICONS.includes(keg.system.activities?.get?.(id)?.img)) update[`system.activities.${id}.img`] = img;
    }
    if (c?.servings > 0 && !keg.system.activities?.get?.(DRINK_ACTIVITY_ID)) {
      update[`system.activities.${DRINK_ACTIVITY_ID}`] = { ...drinkActivity(c.maxServings, c.name, skinOf(keg)), uses: { spent: c.maxServings - c.servings, max: String(c.maxServings), recovery: [] } };
    }
    await keg.update(update);
  }
  const moved = await migrateLegacyRecipes();
  if (!moved && Object.keys(getRecipes()).length) await writeRecipePage(getRecipes());
  await game.settings.set(MODULE_ID, SETTING_MIGRATION, MIGRATION_VERSION);
  if (kegs.length || moved) {
    ui.notifications.info(`Microbrew: updated ${kegs.length} Keg(s)${moved ? ` and moved ${moved} recipe(s) into the module` : ""}. You can delete the old Microbrew Keg macros.`);
  }
  log(`migration ${MIGRATION_VERSION}: ${kegs.length} keg(s), ${moved} recipe(s)`);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerBookSettings();
  game.settings.register(MODULE_ID, SETTING_MIGRATION, { scope: "world", config: false, type: Number, default: 0 });
  registerEnricher();
  document.addEventListener("click", onLinkClick, true);

  game.modules.get(MODULE_ID).api = {
    giveKeg, addRecipe, removeRecipe, clearRecipeBook, reskinKeg,
    brew: (keg) => {
      keg ??= kegOfControlled();
      return keg ? startBrew(keg) : ui.notifications.warn("Microbrew: select a token that carries a Microbrew Keg.");
    },
    drink: (keg) => {
      keg ??= kegOfControlled();
      return keg ? drink(keg) : ui.notifications.warn("Microbrew: select a token that carries a Microbrew Keg.");
    },
    isKeg,
  };
  log("initialized");
});

/* -------------------------------------------- */
/*  The Keg's activities                        */
/* -------------------------------------------- */

const KEG_ACTIVITIES = [BREW_ACTIVITY_ID, DRINK_ACTIVITY_ID];
let wrapperActive = false;

/** Run a Keg activity on the real, embedded Keg (never on a temporary clone). */
function runKegActivity(item, activityId) {
  const keg = item.actor?.items.get(item.id) ?? item;
  if (!keg.isEmbedded && !keg.actor) return ui.notifications.warn("Microbrew: the Keg must be in a character's inventory.");
  if (activityId === BREW_ACTIVITY_ID) return startBrew(keg);
  if (activityId === DRINK_ACTIVITY_ID) return drink(keg);
}

/**
 * With libWrapper, take over the Keg's two activities at the source: the utility activity's use().
 * They never enter dnd5e's (or Midi-QOL's) usage workflow, so there is no usage card,
 * consumption or targeting to conflict with. Every other activity passes straight through.
 * Registered at "ready", after other modules have swapped in their own activity classes.
 */
function registerActivityWrapper() {
  if (typeof libWrapper === "undefined") return false;
  const cls = CONFIG.DND5E?.activityTypes?.utility?.documentClass;
  if (!cls?.prototype?.use) {
    console.warn(`${MODULE_ID} | couldn't find dnd5e's utility activity class; using the dnd5e.postUseActivity hook instead`);
    return false;
  }
  try {
    libWrapper.register(MODULE_ID, "CONFIG.DND5E.activityTypes.utility.documentClass.prototype.use", function (wrapped, ...args) {
      if (KEG_ACTIVITIES.includes(this.id) && isKeg(this.item)) return runKegActivity(this.item, this.id);
      return wrapped(...args);
    }, "MIXED");
  } catch (e) {
    // e.g. another module holds an OVERRIDE wrapper on the same method
    console.warn(`${MODULE_ID} | libWrapper registration failed; using the dnd5e.postUseActivity hook instead`, e);
    return false;
  }
  log(`wrapped ${cls.name}.prototype.use with libWrapper`);
  return true;
}

Hooks.once("ready", async () => {
  wrapperActive = registerActivityWrapper();
  registerSocket();
  try {
    await migrate();
  } catch (e) {
    console.error(`${MODULE_ID} | migration failed`, e);
  }
});

// Fallback when libWrapper isn't available: react after dnd5e finishes using the activity.
// dnd5e passes an activity on a temporary clone of the item, so runKegActivity looks up the real Keg.
Hooks.on("dnd5e.postUseActivity", (activity) => {
  if (wrapperActive) return;
  if (!KEG_ACTIVITIES.includes(activity?.id) || !isKeg(activity?.item)) return;
  return runKegActivity(activity.item, activity.id);
});
