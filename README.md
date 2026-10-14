# Microbrew

Magical brewing for **Foundry VTT v12** and the **D&D 5e system 4.x**.

Give a character a **Microbrew Keg**. They drop in three ingredients, the DM fills in the recipe, and the Keg is filled with servings of magic ale. Every serving carries one **Good**, one **Bad** and one **Cosmetic** effect. The same three ingredients always brew the same results, and a **Recipe Book** keeps track.

## Install

In Foundry's **Add-on Modules → Install Module**, paste this manifest URL:

```
https://raw.githubusercontent.com/thecsapprentice/foundry-brewing/main/module.json
```

Then enable **Microbrew** in your world. It requires **[libWrapper](https://foundryvtt.com/packages/lib-wrapper)**, which Foundry offers to install alongside it.

## What's inside

| Compendium | Contents |
|---|---|
| **Microbrew: Brewing Tables** | Good Effects (d30), Bad Effects (d30) and Cosmetic Effects (d100). Higher rolls are better on both d30 tables. |
| **Microbrew: Kegs & Ingredients** | An empty Microbrew Keg, plus herb and plant ingredients in a folder per biome. |
| **Microbrew: DM Tools** | Macros: Give a Keg, Reskin a Keg, Add a Recipe, Remove a Recipe, Clear Recipe Book, Brew, Drink. |

### Ingredient biomes

| Biome | Ingredients |
|---|---|
| Boreal Highlands | 36 (22 real, 14 fantasy) |

Each ingredient is a dnd5e **Material** item with habitat, a Wisdom (Survival) harvesting DC by rarity, and lore. No ingredient name repeats across biomes.

## Playing

- **Give a Keg** (DM): select tokens, run the macro, and choose the Good, Bad and Cosmetic tables. Tables can come from the world or any compendium. Under **Look**, pick the default Keg or any reskinned Keg in your Items sidebar to use as a template.
- **Brew a Magic Ale**: use the Keg's activity, or the link in its description.
  - A **player** sends the DM a request. The brewing dialog pops up on the DM's screen, and a whispered card is kept in chat as a backup.
  - The **DM** enters three ingredients, an optional name, the servings (default 4), and optionally fixed rolls. They can then **Brew!**, **Deny Request** or **Decide Later**.
  - Brewing again pours out what's left.
- **Drink Brew**: each use pours one serving and posts the three effects to chat. If you select another character's token first, that character drinks from the Keg. When the Keg is empty, the Drink activity disappears.

## Reskinning a Keg

The Keg doesn't have to be a keg. Run **Microbrew: Reskin a Keg** (DM) with a token selected that carries one, or with a Keg in the Items sidebar. You can change:

- **Item:** name, icon, price, weight and rarity.
- **Description:** your own text. Microbrew adds its section below it, with the brew link and whatever is inside, and keeps your text through every brew and drink. Edit it in the Reskin dialog, not on the item sheet, because the sheet's description is rewritten on every brew.
- **Wording**, used in chat cards, dialogs, activity names and the description:

| Field | Default | Example |
|---|---|---|
| Container | keg | kit |
| What it makes | ale | potion |
| One portion / several | serving / servings | dose / doses |
| Brew activity name | Brew a Magic Ale | Brew a Potion |
| Drink activity name | Drink Brew | Drink Potion |
| Brewing verb | brews | concocts |
| Drinking verb | drinks | quaffs |
| Drink activity icon | beer stein | any image |

For example, after reskinning, the chat reads: *"Pip concocts Salt, Toad, Wort into a fresh kit: 2 doses ready."* **Reset to Default** restores the standard Keg look and keeps the Keg's tables and contents.

To hand out a reskinned design repeatedly:
1. Drag the Microbrew Keg from the compendium into your Items sidebar.
2. Reskin it there.
3. Choose it as the **Look** in Give a Keg.

Dragging it straight onto a character also works.

## Recipe Book

- Every combination of three ingredients (in any order) remembers its results for the Keg's set of tables.
- The brewing dialog tells the DM, as they type, whether a combination is known.
- Tick **Overwrite known recipe** to re-roll a known combination.
- Recipes are stored in a world setting. A journal entry, **Microbrew Recipe Book**, shows them as a readable table. It's visible to the DM only by default.
- **Add a Recipe**: write a recipe by hand. Each effect can be custom text, a roll on any table, or no effect. Hand-made recipes apply to every Keg.
- **Remove a Recipe** and **Clear Recipe Book** do what they say.

## Upgrading from the macro version

On first load, the module upgrades existing Kegs automatically:

- Their activities are taken over by the module, so **Activity Macro** is no longer needed.
- Their description links and icons are fixed.
- Brews in progress are kept.

Recipes from the old journal-based Recipe Book are moved into the module. You can then delete the old "Microbrew Keg: Brew / Drink" macros and the pasted DM-tool macros.

## Notes

- **Midi-QOL and other automation:** Microbrew uses libWrapper to take over the Keg's two activities (Brew a Magic Ale, Drink Brew) at the start of the utility activity's `use()`. They never enter dnd5e's or Midi-QOL's usage workflow, so there's no usage card, consumption or targeting to conflict with. Every other activity passes through untouched. If libWrapper registration fails (for example, another module holds an `OVERRIDE` wrapper on the same method), Microbrew falls back to dnd5e's `dnd5e.postUseActivity` hook. The links in the Keg's description always work too.
- **API:** `game.modules.get("microbrew").api` exposes `giveKeg()`, `reskinKeg(keg?)`, `addRecipe()`, `removeRecipe()`, `clearRecipeBook()`, `brew(keg?)`, `drink(keg?)` and `isKeg(item)`.

## Building

The compendium packs are generated from `data/` by `tools/build.py`:

- **Ingredients:** one Python file per biome in `data/biomes/`.
- **Tables:** JSON files in `data/tables/`.

The build writes LevelDB packs with a tiny helper, `tools/ldbpack.cc`, built against [Google LevelDB](https://github.com/google/leveldb):

```
git clone --depth 1 --branch 1.23 https://github.com/google/leveldb.git /tmp/leveldb
cmake -S /tmp/leveldb -B /tmp/leveldb/build -DCMAKE_BUILD_TYPE=Release -DLEVELDB_BUILD_TESTS=OFF -DLEVELDB_BUILD_BENCHMARKS=OFF
make -C /tmp/leveldb/build leveldb
g++ -O2 -std=c++17 -I/tmp/leveldb/include tools/ldbpack.cc /tmp/leveldb/build/libleveldb.a -lpthread -o tools/ldbpack
python3 tools/build.py --repo thecsapprentice/foundry-brewing --version 1.1.0
```

The build regenerates `module.json`, `packs/` and `dist/microbrew.zip`. Document ids are derived from names, so they stay stable between builds.
