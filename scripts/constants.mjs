export const MODULE_ID = "microbrew";
export const SOCKET = `module.${MODULE_ID}`;

export const KEG_NAME = "Microbrew Keg";
export const BREW_ACTIVITY_ID = "brewKegActivity1";
export const DRINK_ACTIVITY_ID = "drinkBrewActvty1";
export const DEFAULT_SERVINGS = 4;

export const KEG_IMG = "icons/containers/barrels/barrel-walnut-steel-brown.webp";
export const ALE_IMG = "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp";

export const BOOK_NAME = "Microbrew Recipe Book";
export const TABLE_PACK = `${MODULE_ID}.microbrew-tables`;
export const TABLE_NAMES = {
  good: "Brewing Results: Good Effects",
  bad: "Brewing Results: Bad Effects",
  cosmetic: "Brewing Results: Cosmetic Effects",
};
export const SLOT_LABEL = { good: "Good", bad: "Bad", cosmetic: "Cosmetic" };

// Ids used by the macro-based version, kept so older Kegs and links keep working.
export const LEGACY_BREW_MACRO_ID = "microbrewKegMcr1";
export const LEGACY_DRINK_MACRO_ID = "microbrewDrink01";

// Flag keys (in the "world" scope, shared with the macro-based version)
export const FLAG_CONTENTS = "microbrew";
export const FLAG_TABLES = "microbrewTables";
export const FLAG_REQUEST = "microbrewRequest";
export const FLAG_LEGACY_RECIPES = "microbrewRecipes";
export const FLAG_SKIN = "microbrewSkin";
