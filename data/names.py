# Brew-name tables. Each becomes an editable RollTable in the "Microbrew: Brew Names" compendium.
# Every result line is "Kind: Word". Theme tables also say which biomes and name keywords call on them.
# The build turns each entry into one table result (weight 1 unless given as (text, weight)).

# ---------------------------------------------------------------- themes
# biome: the ingredient's biome votes 2 for this theme; keyword: an ingredient name containing it votes 1
THEMES = {
    "Boreal": dict(biome=["Boreal Highlands"], keyword=[],
        place=["Glacier", "Pine", "Peak", "Frostfall", "Timberline", "North"], person=["Trapper", "Yeti", "Mountain King", "Frost Giant", "Hermit"],
        adjective=["Frostbitten", "Glacial", "Snowbound", "Wind-Howling"], force=["Winter", "Blizzard", "North Wind", "Midwinter"]),
    "Woodland": dict(biome=["Temperate Woodland"], keyword=[],
        place=["Oakwood", "Hedgerow", "Greenwood", "Glade"], person=["Woodcutter", "Dryad", "Huntsman", "Druid"],
        adjective=["Mossy", "Dappled", "Wildwood", "Bramble-Bound"], force=["Old Oak", "Spring", "Green Man"]),
    "Swamp": dict(biome=["Wetlands & Bogs"], keyword=[],
        place=["Swamp", "Bog", "Fen", "Mire", "Marsh"], person=["Witch", "Hag", "Bogman", "Frog King", "Leech-Doctor"],
        adjective=["Murky", "Brackish", "Sunken", "Will-o'-Wisp"], force=["Mire", "Drowned Man", "Low Tide"]),
    "Grassland": dict(biome=["Grasslands & Steppe"], keyword=[],
        place=["Prairie", "Steppe", "Meadow", "Hillside"], person=["Shepherd", "Horselord", "Centaur", "Drover"],
        adjective=["Sun-Warmed", "Windswept", "Golden", "Thundering"], force=["Storm", "Open Sky", "Summer"]),
    "Desert": dict(biome=["Arid Desert"], keyword=[],
        place=["Dune", "Oasis", "Sandstone", "Mesa"], person=["Djinn", "Nomad", "Sultan", "Scorpion Queen"],
        adjective=["Sun-Scorched", "Parched", "Mirage", "Sandblown"], force=["Sirocco", "High Noon", "Burning Sun"]),
    "Jungle": dict(biome=["Tropical Jungle"], keyword=[],
        place=["Jungle", "Canopy", "Rainforest", "Temple"], person=["Jaguar", "Shaman", "Monkey King", "Explorer"],
        adjective=["Steaming", "Overgrown", "Wild", "Monsoon"], force=["Monsoon", "Jaguar", "Lost Temple"]),
    "Coast": dict(biome=["Coast & Shore"], keyword=["kelp", "sea", "tide"],
        place=["Harbor", "Tidepool", "Lighthouse", "Shipwreck"], person=["Sailor", "Mermaid", "Sea Hag", "Smuggler", "Old Salt"],
        adjective=["Salty", "Briny", "Storm-Tossed", "Seafoam"], force=["Kraken", "Tide", "Davy Jones"]),
    "Underdark": dict(biome=["Underdark & Caverns"], keyword=[],
        place=["Deep", "Cavern", "Chasm", "Mine"], person=["Duergar", "Deep Gnome", "Drow", "Mind Flayer"],
        adjective=["Lightless", "Glowing", "Subterranean", "Echoing"], force=["Deep", "Dark Below", "Underdark"]),
    "Fey": dict(biome=["Feywild & Enchanted Groves"], keyword=["fairy", "pixie", "fey"],
        place=["Fairy Ring", "Twilight", "Moonglade", "Hollow Hill"], person=["Pixie", "Satyr", "Fey Queen", "Trickster", "Changeling"],
        adjective=["Enchanted", "Glimmering", "Bewitched", "Moonlit"], force=["Fey Queen", "Midsummer", "Gloaming"]),
    "Farmstead": dict(biome=["Farmland & Gardens"], keyword=["barley", "wheat", "hops", "rye", "oats"],
        place=["Farmhouse", "Orchard", "Barnyard", "Haystack"], person=["Farmer", "Miller", "Milkmaid", "Brewer", "Alewife"],
        adjective=["Bucolic", "Rustic", "Pastoral", "Homestead", "Harvest"], force=["Harvest", "Old Farmer", "Haymaking"]),
    # keyword themes
    "Frost": dict(biome=[], keyword=["frost", "ice", "snow", "rime", "winter", "glacier", "cold", "arctic", "polar"],
        place=["Icefall"], person=["Ice Witch", "Snow Maiden"], adjective=["Frozen", "Icy", "Rimed"], force=["Winter", "Frost"]),
    "Fire": dict(biome=[], keyword=["fire", "ember", "ash", "sun", "scorch", "flame", "magma", "hearth", "pepper"],
        place=["Forge", "Ember"], person=["Fire Wizard", "Salamander"], adjective=["Fiery", "Smoldering", "Scorched"], force=["Forge", "Dragonfire"]),
    "Night": dict(biome=[], keyword=["moon", "star", "night", "twilight", "astral"],
        place=["Moonrise", "Starfall"], person=["Astrologer", "Moon Priestess"], adjective=["Moonlit", "Starlit", "Silver"], force=["Moon", "Stars"]),
    "Witchery": dict(biome=[], keyword=["witch", "hag"],
        place=["Coven"], person=["Witch", "Hag"], adjective=["Hexed", "Cauldron-Black"], force=["Coven"]),
    "Grave": dict(biome=[], keyword=["grave", "death", "bone", "corpse", "drown", "ghost", "mummy", "widow"],
        place=["Graveyard", "Crypt"], person=["Gravedigger", "Necromancer", "Widow"], adjective=["Deathly", "Grim", "Funeral"], force=["Reaper", "Grave"]),
    "Dragon": dict(biome=[], keyword=["wyrm", "dragon", "basilisk"],
        place=["Dragon's Lair"], person=["Dragonslayer", "Wyrm"], adjective=["Draconic"], force=["Dragon"]),
    "Sweet": dict(biome=[], keyword=["honey", "sugar", "berry", "berries", "plum", "apple", "date", "cherr", "grape", "vanilla", "cacao"],
        place=["Honeycomb"], person=["Beekeeper", "Baker"], adjective=["Honeyed", "Sweet", "Sticky"], force=["Hive"]),
    "Fungal": dict(biome=[], keyword=["mushroom", "cap", "truffle", "puffball", "fung", "spore", "mold"],
        place=["Toadstool"], person=["Mushroom Man", "Sporemother"], adjective=["Spore-Laden", "Fungal", "Earthy"], force=["Mycelium"]),
    # used when no ingredient is recognised
    "Tavern": dict(biome=[], keyword=[], fallback=True,
        place=["Tavern", "Cellar", "Crossroads", "Roadside"], person=["Barkeep", "Tinker", "Drunkard", "Pot-Boy"],
        adjective=["Questionable", "Mystery", "House", "Bottom-Shelf"], force=["Last Call", "Payday", "Closing Time"]),
}

# ---------------------------------------------------------------- moods (chosen from the brew's effects)
MOODS = {
    "Good Adjective": ["Merry", "Jolly", "Blessed", "Lucky", "Heroic", "Glorious"],
    "Good Feeling": ["Joy", "Triumph", "Delight", "Fortune", "Glory"],
    "Bad Adjective": ["Angry", "Grumpy", "Cursed", "Wretched", "Vengeful", "Spiteful"],
    "Bad Feeling": ["Rage", "Ruin", "Regret", "Spite", "Folly", "Revenge"],
    "Mixed Adjective": ["Sleepy", "Peculiar", "Restless", "Drunken", "Wandering", "Grinning"],
    "Mixed Feeling": ["Mischief", "Folly", "Whimsy", "Secret", "Last Word"],
}

ADVENTURERS = ["Wizard", "Bard", "Knight", "Goblin", "Dwarf", "Paladin", "Rogue", "Monk", "Abbot", "Innkeeper", "Archmage", "Halfling", "Ogre", "Hedge-Knight"]

# ---------------------------------------------------------------- patterns (weighted)
# {Place} {Person} {Adjective} {Force}: from the theme. {Mood} {Feeling}: from the brew's effects.
# {Adventurer}: generic. {Style}: from the Keg's name style. {Ingredient} {Ingredient2}: the brew's ingredients.
PATTERNS = [
    ("{Force}'s {Feeling} {Style}", 4),        # Winter's Rage IPA
    ("{Place} {Person} {Style}", 4),           # Swamp Witch Stew
    ("{Adjective} {Style}", 3),                # Bucolic Ale
    ("{Mood} {Adventurer}'s {Style}", 2),      # Angry Wizard's Lager
    ("{Mood} {Person}'s {Style}", 4),          # Grumpy Trapper's Porter
    ("{Adjective} {Person} {Style}", 2),       # Murky Bogman Bitter
    ("The {Person}'s {Feeling}", 2),           # The Hag's Revenge
    ("{Ingredient} & {Ingredient2} {Style}", 1),
]

# ---------------------------------------------------------------- styles (one table per name style)
STYLES = {
    "Ale": [("Ale", 3), "IPA", "Lager", "Stout", "Porter", "Bitter", "Pale Ale", "Brown Ale", "Mead", "Cider", "Saison", "Bock", "Red Ale", "Gruit"],
    "Potion": [("Tonic", 2), ("Elixir", 2), ("Draught", 2), "Philter", "Brew", "Tincture", "Cordial", "Potion", "Concoction"],
    "Tea": [("Tea", 3), "Tisane", "Infusion", "Brew", "Steep", "Blend", "Chai", "Cuppa", "Leaf"],
}
