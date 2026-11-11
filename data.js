// Everglades — card, region and role data.
// Shared by the server (rules) and the browser (display).
// Values were read from the printed card art in Cards/ (Mar 2026 versions).
(function (root) {
  // id = image file name in assets/cards/ecology (without .png)
  // [id, name, habitat, kind, impact, population, keywords, taxonomy]
  const ECO = [
    ['AmericanCrocodile', 'American Crocodile', 'Wetland', 'Native', 8, 1, ['Keystone', 'Predatory 3'], 'Reptile'],
    ['AsianSwampEel', 'Asian Swamp Eel', 'Water', 'Invasive', 14, 1, ['Predatory 1'], 'Fish'],
    ['AustralianPine', 'Australian Pine', 'Land', 'Invasive', 17, 2, [], 'Plant'],
    ['BlackRat', 'Black Rat', 'Land', 'Invasive', 4, 3, ['Migratory'], 'Mammal'],
    ['BloggetsSilverbush', "Blodgett's Silverbush", 'Land', 'Native', 1, 5, [], 'Plant'],
    ['BlueTilapia', 'Blue Tilapia', 'Water', 'Invasive', 7, 4, ['Migratory'], 'Fish'],
    ['Bowfin', 'Bowfin', 'Water', 'Native', 3, 3, ['Migratory'], 'Fish'],
    ['BurmaReed', 'Burma Reed', 'Wetland', 'Invasive', 1, 5, [], 'Plant'],
    ['BurmesePython', 'Burmese Python', 'Wetland', 'Invasive', 16, 2, ['Predatory 4'], 'Reptile'],
    ['Coral', 'Atlantic Coral', 'Water', 'Native', 7, 1, ['Keystone'], 'Cnidaria'],
    ['EasternIndigoSnake', 'Eastern Indigo Snake', 'Land', 'Native', 7, 1, ['Predatory 2'], 'Reptile'],
    ['EvergladesCypress', 'Everglades Cypress', 'Wetland', 'Native', 9, 1, ['Keystone'], 'Plant'],
    ['FeralCat', 'Feral Cat', 'Land', 'Invasive', 9, 2, ['Predatory 3'], 'Mammal'],
    ['Flamingo', 'Flamingo', 'Wetland', 'Native', 6, 2, ['Migratory'], 'Bird'],
    ['FloridaBlackbear', 'Florida Black Bear', 'Land', 'Native', 9, 1, ['Predatory 4'], 'Mammal'],
    ['FloridaBristleFern', 'Florida Bristle Fern', 'Land', 'Native', 5, 3, [], 'Plant'],
    ['FloridaGar', 'Florida Gar', 'Water', 'Native', 4, 2, ['Predatory 1'], 'Fish'],
    ['FloridaPanther', 'Florida Panther', 'Land', 'Native', 8, 1, ['Keystone', 'Predatory 3'], 'Mammal'],
    ['GopherTortoise', 'Gopher Tortoise', 'Land', 'Native', 6, 2, ['Keystone'], 'Reptile'],
    ['GreatBarracuda', 'Great Barracuda', 'Water', 'Native', 5, 2, ['Migratory', 'Predatory 2'], 'Fish'],
    ['GreatBlueHeron', 'Great Blue Heron', 'Wetland', 'Native', 7, 1, ['Predatory 2'], 'Bird'],
    ['GreenAnaconda', 'Green Anaconda', 'Wetland', 'Invasive', 18, 1, ['Predatory 1'], 'Reptile'],
    ['Hydrilla', 'Hydrilla', 'Water', 'Invasive', 2, 5, [], 'Plant'],
    ['JewelFish', 'Jewelfish', 'Water', 'Invasive', 5, 4, [], 'Fish'],
    ['LargeToothSawfish', 'Largetooth Sawfish', 'Water', 'Native', 6, 2, ['Predatory 2'], 'Fish'],
    ['LeatherBackSeaTurtle', 'Leatherback Sea Turtle', 'Water', 'Native', 8, 2, [], 'Reptile'],
    ['Lionfish', 'Lionfish', 'Water', 'Invasive', 13, 2, ['Predatory 2'], 'Fish'],
    ['LowerKeysRabbit', 'Lower Keys Rabbit', 'Land', 'Native', 2, 3, ['Migratory'], 'Mammal'],
    ['Manatee', 'Manatee', 'Water', 'Native', 9, 1, [], 'Mammal'],
    ['MiamiBlueButterly', 'Miami-blue Butterfly', 'Land', 'Native', 3, 3, ['Migratory'], 'Insect'],
    ['MonkParakeet', 'Monk Parakeet', 'Land', 'Invasive', 10, 3, [], 'Bird'],
    ['MuscovyDuck', 'Muscovy Duck', 'Wetland', 'Invasive', 12, 3, ['Migratory'], 'Bird'],
    ['NassauGrouper', 'Nassau Grouper', 'Water', 'Native', 2, 4, ['Migratory'], 'Fish'],
    ['NileMonitor', 'Nile Monitor', 'Wetland', 'Invasive', 15, 1, ['Predatory 2'], 'Reptile'],
    ['Oldworldfern', 'Old World Climbing Fern', 'Land', 'Invasive', 3, 4, ['Migratory'], 'Plant'],
    ['RedWoodpecker', 'Woodpecker', 'Land', 'Native', 4, 2, ['Migratory'], 'Bird'],
    ['RiverOtter', 'River Otter', 'Wetland', 'Native', 5, 2, ['Predatory 1'], 'Mammal'],
    ['Seagrass', 'Seagrass', 'Water', 'Native', 1, 5, ['Keystone'], 'Plant'],
    ['SeasideSparrow', 'Seaside Sparrow', 'Wetland', 'Native', 3, 3, ['Migratory'], 'Bird'],
    ['SuckermouthCatfish', 'Suckermouth Catfish', 'Water', 'Invasive', 8, 4, [], 'Fish'],
    ['TreeSnail', 'Tree Snail', 'Wetland', 'Native', 2, 4, [], 'Mollusc'],
    ['TwospikeCrabgrass', 'Twospike Crabgrass', 'Wetland', 'Native', 1, 5, [], 'Plant'],
    ['WalkingCatfish', 'Walking Catfish', 'Wetland', 'Invasive', 6, 2, ['Migratory'], 'Fish'],
    ['WildBoar', 'Wild Boar', 'Land', 'Invasive', 11, 1, ['Predatory 2'], 'Mammal'],
    ['WoodStork', 'Wood Stork', 'Wetland', 'Native', 4, 3, [], 'Bird'],
  ];

  const CARDS = {};
  for (const [id, name, habitat, kind, impact, pop, kw, taxon] of ECO) {
    let predatory = 0;
    for (const k of kw) { const m = /^Predatory (\d+)$/.exec(k); if (m) predatory = +m[1]; }
    CARDS[id] = {
      id, name, habitat, kind, impact, pop, keywords: kw, taxon,
      keystone: kw.includes('Keystone'), migratory: kw.includes('Migratory'), predatory,
      img: 'assets/cards/ecology/' + id + '.png',
    };
  }

  // Map regions. x/y = where the token counter sits on the board art (percent).
  const REGIONS = {
    FSP: { name: 'Fakahatchee State Park', x: 33, y: 15 },
    LO: { name: 'Lake Okeechobee', x: 66, y: 13 },
    NG: { name: 'Northern Gulf', x: 12, y: 31 },
    BCNP: { name: 'Big Cypress National Preserve', x: 58, y: 40 },
    M: { name: 'Miami', x: 88, y: 26 },
    SG: { name: 'Southern Gulf', x: 17, y: 64 },
    ENP: { name: 'Everglades National Park', x: 65, y: 66 },
    FK: { name: 'Florida Keys', x: 57, y: 76 },
    KW: { name: 'Key West', x: 11, y: 84 },
    KL: { name: 'Key Largo', x: 91, y: 77 },
  };
  // Regions that share a border on the board.
  const ADJ = {
    NG: ['FSP', 'BCNP', 'SG'],
    FSP: ['NG', 'BCNP', 'LO'],
    LO: ['FSP', 'BCNP', 'M'],
    M: ['LO', 'BCNP', 'ENP', 'KL'],
    BCNP: ['NG', 'FSP', 'LO', 'M', 'ENP', 'SG'],
    ENP: ['BCNP', 'M', 'KL', 'FK', 'SG'],
    SG: ['NG', 'BCNP', 'ENP', 'FK', 'KW'],
    FK: ['SG', 'ENP', 'KL', 'KW'],
    KW: ['SG', 'FK'],
    KL: ['M', 'ENP', 'FK'],
  };

  // [id, region, biome name, suit, invasive risk]
  const BIO = [
    ['BCNPCypressMarsh', 'BCNP', 'Cypress Marsh', 'Wetland', 2],
    ['BCNPFreshwaterSlough', 'BCNP', 'Freshwater Slough', 'Wetland', 5],
    ['BCNPMangroveMarsh', 'BCNP', 'Mangrove Marsh', 'Wetland', 3],
    ['ENPFlamingoBeach', 'ENP', 'Flamingo Beach', 'Wetland', 9],
    ['ENPFreshwaterMarlPrairie', 'ENP', 'Freshwater Marl Prairie', 'Wetland', 13],
    ['ENPFreshwaterSlough', 'ENP', 'Freshwater Slough', 'Wetland', 16],
    ['FKCoralReef', 'FK', 'Coral Reef', 'Water', 11],
    ['FKMangroveForest', 'FK', 'Mangrove Forest', 'Wetland', 8],
    ['FKTropicalResort', 'FK', 'Tropical Resort', 'Land', 18],
    ['FSPCoastalLowland', 'FSP', 'Coastal Lowland', 'Land', 4],
    ['FSPFreshwaterMarlPrairie', 'FSP', 'Freshwater Marl Prairie', 'Wetland', 7],
    ['FSPHardwoodHammock', 'FSP', 'Hardwood Hammock', 'Land', 5],
    ['KLPineland', 'KL', 'Pineland', 'Land', 7],
    ['KLTropicalBeach', 'KL', 'Tropical Beach', 'Water', 17],
    ['KLTropicalResort', 'KL', 'Tropical Resort', 'Land', 19],
    ['KWCoralReef', 'KW', 'Coral Reef', 'Water', 9],
    ['KWPineRocklands', 'KW', 'Pine Rocklands', 'Land', 5],
    ['KWRockyCoast', 'KW', 'Rocky Coast', 'Land', 2],
    ['LOCypressMarsh', 'LO', 'Cypress Marsh', 'Wetland', 4],
    ['LOFreshwaterLake', 'LO', 'Freshwater Lake', 'Water', 8],
    ['LOPineland', 'LO', 'Pineland', 'Land', 9],
    ['MDowntown', 'M', 'Downtown', 'Land', 19],
    ['MMiamiBeach', 'M', 'Miami Beach', 'Water', 18],
    ['MMiamiZoo', 'M', 'Miami Zoo', 'Land', 20],
    ['NGKelpForest', 'NG', 'Kelp Forest', 'Water', 7],
    ['NGOpenWaters', 'NG', 'Open Waters', 'Water', 10],
    ['NGOpenWaterss', 'NG', 'Open Waters', 'Water', 10],
    ['SGFloridaBay', 'SG', 'Florida Bay', 'Water', 15],
    ['SGOpenWaters', 'SG', 'Open Waters', 'Water', 12],
    ['SGSaltwaterSlough', 'SG', 'Saltwater Slough', 'Wetland', 3],
  ];
  const BIOMES = {};
  for (const [id, region, name, suit, risk] of BIO) {
    BIOMES[id] = { id, region, name, suit, risk, img: 'assets/cards/biome/' + id + '.png' };
  }

  // Competitive roles. The Anaconda is Co-op only and is intentionally left out.
  // map: region -> 'N' (needs Native majority) or 'I' (needs Invasive majority)
  const ROLES = {
    Conservationist: {
      name: 'Conservationist', img: 'assets/cards/roles/Conservationist.png', ending: 'assets/cards/roles/ConservationistEND.png',
      map: { FSP: 'N', BCNP: 'N', ENP: 'N' }, mapPts: 10,
      ability: 'You may choose not to populate when you play Invasive cards.',
      goals: ['10 pts for each map objective met', '15 pts if the total population majority is Native', '5 pts if you never trigger an Invasive Crisis'],
    },
    Fisherman: {
      name: 'Fisherman', img: 'assets/cards/roles/Fisherman.png', ending: 'assets/cards/roles/FishermanENDING.png',
      map: { NG: 'N', SG: 'N', KW: 'N', FK: 'N', KL: 'N' }, mapPts: 5,
      ability: 'Start of turn: you may swap any card from your hand with any Water card from your scoring pile.',
      goals: ['5 pts for each map objective met', '10 pts if there are at least 25 population in your objective regions', '15 pts if you win the most tricks from Water regions'],
    },
    Hunter: {
      name: 'Game Hunter', img: 'assets/cards/roles/Hunter.png', ending: 'assets/cards/roles/HunterENDING.png',
      map: { FSP: 'N', LO: 'N', BCNP: 'N', ENP: 'N' }, mapPts: 5,
      ability: 'Start of turn: you may swap any card from your hand with any Land card from your scoring pile.',
      goals: ['5 pts for each map objective met', '15 pts if there are at least 25 population in your objective regions', '15 pts if you win the most tricks from Land regions'],
    },
    LandDeveloper: {
      name: 'Land Developer', img: 'assets/cards/roles/LandDeveloper.png', ending: 'assets/cards/roles/LandDeveloperENDING.png',
      map: { NG: 'N', SG: 'N', KW: 'N', KL: 'N', M: 'I' }, mapPts: 5,
      ability: 'Start of turn: remove 1 population token from any region.',
      goals: ['5 pts for each map objective met', '15 pts if there is no population in at least 2 regions', '10 pts if you won the most total tricks'],
    },
    Researcher: {
      name: 'Researcher', img: 'assets/cards/roles/Researcher.png', ending: 'assets/cards/roles/ResearcherENDING.png',
      map: { LO: 'N', BCNP: 'N', ENP: 'N', FK: 'N', M: 'I' }, mapPts: 5,
      ability: 'Start of turn: you may swap a card from your hand with any card in your scoring pile.',
      goals: ['5 pts for each map objective met', '15 pts if you have 6 unique taxonomies in your scoring pile', '10 pts if you win the least tricks'],
    },
    Tourist: {
      name: 'Tourist', img: 'assets/cards/roles/Tourist.png', ending: 'assets/cards/roles/TouristENDING.png',
      map: { M: 'I', ENP: 'N', KL: 'N', FK: 'N', KW: 'N' }, mapPts: 5,
      ability: 'Start of turn: look at the top card of the location deck. You may then replace it or put it on the bottom.',
      goals: ['5 pts for each map objective met', '10 pts if all map objectives are met', '15 pts if you won tricks only from your map objective regions'],
    },
  };

  // Co-op boss (not a player role, so it is not in ROLES)
  const BOSS = {
    name: 'The Anaconda', img: 'assets/cards/roles/AnacondaBoss.png', portrait: 'assets/anaconda.png',
    goals: ['5 pts for each map objective the players miss', '5 pts for each trick won', '3 pts for each region with an Invasive majority', 'Wins all ties'],
  };

  const DATA = { CARDS, REGIONS, ADJ, BIOMES, ROLES, BOSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.EG_DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
