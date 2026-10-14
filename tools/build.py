#!/usr/bin/env python3
"""
Build the Microbrew module: module.json, the three compendium packs (LevelDB), and dist/microbrew.zip.

    python3 tools/build.py --repo OWNER/REPO [--version 1.0.0]

Packs are written with tools/ldbpack (a tiny LevelDB writer; see tools/ldbpack.cc and the README).
Document ids are derived from names, so rebuilding keeps every id stable.
"""
import argparse, base64, hashlib, importlib.util, json, os, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE_ID = "microbrew"
CORE_VERSION, SYSTEM_VERSION = "12.331", "4.3.9"
STATS = {"coreVersion": CORE_VERSION, "systemId": "dnd5e", "systemVersion": SYSTEM_VERSION,
         "createdTime": None, "modifiedTime": None, "lastModifiedBy": None, "compendiumSource": None, "duplicateSource": None}
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def stable_id(*parts):
    """A 16-character Foundry id derived from a name, so rebuilds don't change ids."""
    h = int.from_bytes(hashlib.sha256("::".join(parts).encode()).digest(), "big")
    out = ""
    for _ in range(16):
        h, r = divmod(h, 62)
        out += ALPHABET[r]
    return out


# ---------------------------------------------------------------- tables
def build_tables():
    entries = []
    for key in ("good", "bad", "cosmetic"):
        src = json.loads((ROOT / f"data/tables/fvtt-RollTable-brewing-{key}-effects.json").read_text(encoding="utf-8"))
        tid = stable_id("table", src["name"])
        rids = []
        for r in src["results"]:
            rid = stable_id("result", src["name"], str(r["range"][0]))
            rids.append(rid)
            entries.append((f"!tables.results!{tid}.{rid}", {
                "_id": rid, "type": "text", "text": r["text"], "img": r.get("img"), "weight": 1,
                "range": r["range"], "drawn": False, "documentCollection": "", "documentId": None,
                "flags": {}, "_stats": STATS,
            }))
        entries.append((f"!tables!{tid}", {
            "_id": tid, "name": src["name"], "img": src["img"], "description": src["description"],
            "results": rids, "formula": src["formula"], "replacement": True, "displayRoll": True,
            "folder": None, "sort": 0, "ownership": {"default": 0}, "flags": {}, "_stats": STATS,
        }))
    return entries


# ---------------------------------------------------------------- items
def load_biome(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

DC = {"common": 10, "uncommon": 13, "rare": 16, "very rare": 19}
HEAVY = {"wood", "root_brown", "root_thorn", "root_blue"}

def build_items():
    entries, seen = [], {}
    sort_folder = 0
    for path in sorted((ROOT / "data/biomes").glob("*.py")):
        B = load_biome(path)
        fid = stable_id("folder", B.BIOME)
        sort_folder += 100000
        entries.append((f"!folders!{fid}", {
            "_id": fid, "name": B.BIOME, "type": "Item", "folder": None, "sorting": "a", "sort": sort_folder,
            "color": None, "description": B.BIOME_DESC, "flags": {}, "_stats": STATS,
        }))
        for (name, kind, rarity, (price, denom), icon, flavor, habitat, harvest, lore) in B.HERBS:
            if name in seen:
                sys.exit(f"Duplicate ingredient '{name}' in {B.BIOME} (already in {seen[name]})")
            seen[name] = B.BIOME
            assert rarity in DC and icon in B.I, (name, rarity, icon)
            iid = stable_id("item", name)
            desc = (f"<p><em>{flavor}</em></p>\n<p><strong>Biome:</strong> {B.BIOME}</p>\n"
                    f"<p><strong>Habitat:</strong> {habitat}</p>\n"
                    f"<p><strong>Harvesting:</strong> DC {DC[rarity]} Wisdom (Survival) to find and gather. {harvest}</p>\n"
                    f"<p><strong>Lore:</strong> {lore}</p>")
            entries.append((f"!items!{iid}", {
                "_id": iid, "name": name, "type": "loot", "img": B.I[icon],
                "system": {
                    "description": {"value": desc, "chat": ""},
                    "source": {"custom": f"Microbrew: {B.BIOME}", "book": "", "page": "", "license": ""},
                    "quantity": 1, "weight": {"value": 0.5 if icon in HEAVY else 0.1, "units": "lb"},
                    "price": {"value": price, "denomination": denom},
                    "rarity": rarity, "identified": True,
                    "type": {"value": "material", "subtype": ""},
                },
                "effects": [], "folder": fid, "sort": 0, "ownership": {"default": 0},
                "flags": {"world": {"microbrewIngredient": {"biome": B.BIOME, "origin": kind}}}, "_stats": STATS,
            }))
    return entries, len(seen)


# ---------------------------------------------------------------- keg (in the items pack)
def build_keg():
    """An empty Keg using the default tables. Give a Keg is the usual way to hand one out."""
    kid = stable_id("item", "Microbrew Keg")
    js = (ROOT / "scripts/keg.mjs").read_text(encoding="utf-8")
    base = js.split("export const KEG_BASE_DESC = `", 1)[1].split("`;", 1)[0]
    return [(f"!items!{kid}", {
        "_id": kid, "name": "Microbrew Keg", "type": "consumable", "img": "icons/containers/barrels/barrel-walnut-steel-brown.webp",
        "system": {
            "description": {"value": base + "<hr><p><em>The keg is empty. Brew something!</em></p>", "chat": ""},
            "quantity": 1, "weight": {"value": 15, "units": "lb"}, "price": {"value": 250, "denomination": "gp"},
            "rarity": "uncommon", "identified": True, "type": {"value": "trinket", "subtype": ""},
            "activities": {"brewKegActivity1": {
                "_id": "brewKegActivity1", "type": "utility", "name": "Brew a Magic Ale",
                "img": "icons/containers/barrels/barrel-walnut-steel-brown.webp", "sort": 0,
                "activation": {"type": "action", "value": 1, "condition": "", "override": False},
                "duration": {"units": "inst", "concentration": False, "override": False},
                "range": {"units": "self", "override": False},
                "description": {"chatFlavor": "The keg gurgles and burbles as the ingredients go in..."},
            }},
        },
        "effects": [], "folder": None, "sort": 0, "ownership": {"default": 0}, "flags": {}, "_stats": STATS,
    })]


# ---------------------------------------------------------------- macros
MACROS = [
    ("Microbrew: Give a Keg", "giveKeg", "icons/containers/barrels/barrel-walnut-steel-brown.webp",
     "Select one or more tokens, choose the tables, and each character gets a Microbrew Keg."),
    ("Microbrew: Add a Recipe", "addRecipe", "icons/sundries/books/book-worn-brown.webp",
     "Write a recipe into the Recipe Book by hand."),
    ("Microbrew: Remove a Recipe", "removeRecipe", "icons/sundries/books/book-worn-brown.webp",
     "Forget one recorded recipe."),
    ("Microbrew: Clear Recipe Book", "clearRecipeBook", "icons/sundries/books/book-worn-brown.webp",
     "Forget every recorded recipe."),
    ("Microbrew: Brew", "brew", "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp",
     "Brew in the selected token's Keg (players send the DM a request)."),
    ("Microbrew: Drink", "drink", "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp",
     "Drink a serving from the selected token's Keg."),
]

def build_macros():
    entries = []
    for i, (name, fn, img, about) in enumerate(MACROS):
        mid = stable_id("macro", name)
        cmd = (f"// {about}\n"
               f"const api = game.modules.get(\"{MODULE_ID}\")?.api;\n"
               f"if (!api) return ui.notifications.error(\"The Microbrew module isn't active in this world.\");\n"
               f"await api.{fn}();\n")
        entries.append((f"!macros!{mid}", {
            "_id": mid, "name": name, "type": "script", "img": img, "scope": "global", "command": cmd,
            "folder": None, "sort": (i + 1) * 100000, "ownership": {"default": 0}, "flags": {}, "_stats": STATS,
        }))
    return entries


# ---------------------------------------------------------------- output
def write_pack(name, entries, ldbpack):
    (ROOT / "packs").mkdir(exist_ok=True)
    out = ROOT / "packs" / name
    if out.exists():
        shutil.rmtree(out)
    keys = [k for k, _ in entries]
    assert len(keys) == len(set(keys)), f"duplicate keys in {name}"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as f:
        for k, v in entries:
            f.write(k + "\n" + json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "\n")
        tmp = f.name
    subprocess.run([str(ldbpack), "write", str(out), tmp], check=True)
    os.unlink(tmp)
    for junk in ("LOG", "LOG.old", "LOCK"):
        (out / junk).unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="GitHub OWNER/REPO the module installs from")
    ap.add_argument("--version", default="1.0.0")
    ap.add_argument("--branch", default="main")
    args = ap.parse_args()
    owner, repo = args.repo.split("/")
    ldbpack = ROOT / "tools/ldbpack"
    if not ldbpack.exists():
        sys.exit("tools/ldbpack is missing; build it first (see README).")

    tables = build_tables()
    items, n_herbs = build_items()
    items += build_keg()
    macros = build_macros()
    write_pack("microbrew-tables", tables, ldbpack)
    write_pack("microbrew-items", items, ldbpack)
    write_pack("microbrew-macros", macros, ldbpack)

    raw = f"https://raw.githubusercontent.com/{owner}/{repo}/{args.branch}"
    manifest = {
        "id": MODULE_ID,
        "title": "Microbrew",
        "description": "Magical brewing for D&D 5e: a Microbrew Keg that brews ale from three ingredients, with Good, Bad and Cosmetic effect tables, a DM-run Recipe Book, and herb and plant ingredients by biome.",
        "version": args.version,
        "authors": [{"name": owner, "url": f"https://github.com/{owner}"}],
        "compatibility": {"minimum": "12", "verified": CORE_VERSION},
        "relationships": {"systems": [{"id": "dnd5e", "type": "system", "compatibility": {"minimum": "4.0.0", "verified": SYSTEM_VERSION}}]},
        "esmodules": ["scripts/microbrew.mjs"],
        "styles": ["styles/microbrew.css"],
        "socket": True,
        "packs": [
            {"name": "microbrew-tables", "label": "Microbrew: Brewing Tables", "path": "packs/microbrew-tables", "type": "RollTable",
             "ownership": {"PLAYER": "LIMITED", "ASSISTANT": "OWNER"}},
            {"name": "microbrew-items", "label": "Microbrew: Kegs & Ingredients", "path": "packs/microbrew-items", "type": "Item", "system": "dnd5e",
             "ownership": {"PLAYER": "OBSERVER", "ASSISTANT": "OWNER"}},
            {"name": "microbrew-macros", "label": "Microbrew: DM Tools", "path": "packs/microbrew-macros", "type": "Macro",
             "ownership": {"PLAYER": "NONE", "ASSISTANT": "OWNER"}},
        ],
        "packFolders": [{"name": "Microbrew", "sorting": "m", "packs": ["microbrew-tables", "microbrew-items", "microbrew-macros"]}],
        "languages": [],
        "url": f"https://github.com/{owner}/{repo}",
        "manifest": f"{raw}/module.json",
        "download": f"https://github.com/{owner}/{repo}/raw/{args.branch}/dist/{MODULE_ID}.zip",
        "readme": f"https://github.com/{owner}/{repo}#readme",
        "bugs": f"https://github.com/{owner}/{repo}/issues",
    }
    (ROOT / "module.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # Release zip: only what Foundry needs, with module.json at the top level
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    zpath = dist / f"{MODULE_ID}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(ROOT / "module.json", "module.json")
        for folder in ("scripts", "styles", "packs"):
            for p in sorted((ROOT / folder).rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(ROOT).as_posix())
        if (ROOT / "README.md").exists():
            z.write(ROOT / "README.md", "README.md")
    print(f"tables: {len(tables)} entries | items: {n_herbs} ingredients + keg | macros: {len(macros)}")
    print(f"module.json v{args.version} -> {manifest['manifest']}")
    print(f"{zpath.relative_to(ROOT)}: {zpath.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
