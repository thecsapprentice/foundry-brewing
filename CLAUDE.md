# Microbrew: instructions for Claude

Microbrew is a Foundry VTT **v12** module for the **dnd5e 4.x** system. It runs inside people's campaign worlds, so **protecting world data comes before every feature.** Read this file before changing anything.

## Before EVERY commit: run the safety audit (mandatory)

Do all four steps before every commit, with no exceptions. If any step fails, fix it or stop and tell the user. Never commit around a failure.

1. **Build:** `python3 tools/build.py --repo thecsapprentice/foundry-brewing --version X.Y.Z` (bump the version for any user-facing change).
2. **Tests:** `node tests/run.mjs`. Every check must pass. Add tests for new behaviour, and especially for anything that writes to the world.
3. **Audit:** `python3 tools/audit.py`. It lists every line that can change world data or global behaviour and marks new or changed ones as `NEW`.
   - Review **each** `NEW` site against the checklist below, reading the surrounding code rather than just the one line.
   - Only when every site passes, record the review with `python3 tools/audit.py --accept`, and commit `tools/audit-reviewed.txt` with the change.
   - Never run `--accept` just to make the audit pass.
4. **Report:** in your reply to the user, summarise what the audit flagged and why each new site is safe. If the set of things Microbrew writes changed, update the README's **"What Microbrew changes in your world"** section in the same commit.

Also confirm that running the tests left `packs/` unchanged (`git status --short packs` is empty).

## World-safety checklist

Check every write site, and the code that reaches it, against these rules:

1. **Only Microbrew's own data.** Writes may touch only:
   - Kegs (see rule 2),
   - the brewer's ingredients (see rule 3),
   - Microbrew's own chat messages,
   - the `microbrew.*` world settings,
   - the **"Recipes"** page of the *Microbrew Recipe Book* journal.

   Anything else needs the user's explicit approval first.
2. **Keg detection never by name.** An item is a Keg only if it has the Brew activity (`brewKegActivity1`) or Microbrew data (`flags.world.microbrew*`); use `isKeg()`. Never select documents to modify by name alone.
3. **Ingredients:** only unequipped `loot` or `consumable` items that aren't Kegs, at most one per named ingredient, and only when the DM ticked *Consume ingredients*. Decrement the quantity, and delete the item only at quantity 1.
4. **No deleting other documents.** Never delete actors, items other than consumed ingredients, scenes, journals, tables, macros, folders or users. Embedded deletions (`-=` keys) may only remove Microbrew's own keys or activities.
5. **No permission changes.** Never change `ownership` or user roles on existing documents. A document Microbrew creates may set its own initial ownership.
6. **No bulk operations except the versioned migration.** Loops over `game.actors` or `game.items` may only run in `migrate()`, may only touch `isKeg()` items, must be guarded by the `migrationVersion` setting, and must run on the active GM only.
7. **Destructive DM tools confirm first.** Clearing or removing recipes, and resetting a reskin, need a `Dialog.confirm` with *No* as the default.
8. **Use the document API only.** No direct file, database, `fetch`, `FilePicker.upload` or server calls. All writes go through `update`, `create`, `delete` or `settings.set`, so Foundry validates them.
9. **Never store live documents or references in flags.** Copy data (`foundry.utils.deepClone`) before keeping it. `getFlag` returns live objects that later updates change in place.
10. **Wrappers and hooks stay narrow.** The libWrapper `MIXED` wrapper on the utility activity's `use()` must call `wrapped(...args)` unchanged for everything except the Keg's two activity ids. Hooks must return early for anything that isn't a Keg.
11. **Permissions are respected.** GM-only tools check `game.user.isGM`. World settings are only written by a GM. Players only update items they own.
12. **Fail safe.** If something unexpected happens, such as a missing table, Keg or message, warn and stop. Never "repair" by guessing which documents to change.
13. **Disabling the module must stay harmless.** Data written to documents must still be valid dnd5e data without Microbrew. For example, the activities stay of type `utility`, with no custom activity types or data models.

## Project layout

| Path | What it is |
|---|---|
| `scripts/` | The module's code (ES modules). `microbrew.mjs` is the entry point, with hooks, the wrapper, the socket, migration and the API. |
| `data/biomes/*.py` | Ingredient data, one file per biome. Names must be unique across biomes; the build enforces this. |
| `data/tables/*.json` | The Good, Bad and Cosmetic roll tables. |
| `tools/build.py` | Builds `module.json`, the LevelDB packs in `packs/`, and `dist/microbrew.zip`. Document ids are derived from names, so they stay stable between builds. |
| `tools/ldbpack.cc` | Small LevelDB writer and reader used by the build and tests. The binary isn't committed; see README → Building. |
| `tools/audit.py`, `tools/audit-reviewed.txt` | The world-safety audit and its reviewed baseline. |
| `tests/` | The mocked Foundry/dnd5e harness and test suites. `node tests/run.mjs` runs them all. |

## Conventions

- The **icons** must exist in Foundry's core icon set. Check new icon paths against paths the dnd5e system itself uses before adding them.
- **Wording** shown to players comes from the Keg's skin (`skinOf(keg)`), never hard-coded "keg", "ale" or "serving".
- **Commits** end with the attribution lines the session asks for.
