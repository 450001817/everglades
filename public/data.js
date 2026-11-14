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

  // Animated character portraits (made with PixelLab from the role-card portraits).
  // Each animation is one horizontal strip: `frames` frames of w x h, frame 0 = the role card's portrait.
  // fps = playback speed, loops = how many times a reaction plays before going back to idle.
  const CHAR_ANIM = {
    frames: 9, w: 128, h: 110,
    anims: {
      idle: { fps: 7 }, think: { fps: 6 }, signature: { fps: 8 },
      cheer: { fps: 9, loops: 2 }, upset: { fps: 7 }, shock: { fps: 8 },
    },
    // skin = a skin id from SKINS below (null or missing = the character's original look)
    src: (role, anim, skin) => 'assets/characters/' + role + '/' + (skin ? 'skins/' + skin + '/' : '') + anim + '.png',
  };

  // Character skins: alternate looks for each role, sold in the store. Purely cosmetic.
  // Art: public/assets/characters/<role>/skins/<id>/<anim>.png, the same 6 animation strips as the original.
  // The name only tells skins apart in the shop; it is never shown during a game.
  const SKIN_PRICE = 500;
  const SKINS = [
    { id: 'rodney',  role: 'Hunter',          name: 'Rodney',  blurb: 'Big laugh, bigger heart. Never misses a cookout or a shot.' },
    { id: 'maribel', role: 'Hunter',          name: 'Maribel', blurb: 'Tracks hogs through the hammocks before sunrise.' },
    { id: 'kenji',   role: 'Fisherman',       name: 'Kenji',   blurb: 'Forty years on Florida Bay. Knows every channel by heart.' },
    { id: 'dot',     role: 'Fisherman',       name: 'Dot',     blurb: 'Out-fishes the whole marina and lets them know it.' },
    { id: 'tomas',   role: 'Conservationist', name: 'Tomás',   blurb: 'A young ranger with a speech for every occasion.' },
    { id: 'leona',   role: 'Conservationist', name: 'Leona',   blurb: 'Speaks for the River of Grass, and people listen.' },
    { id: 'earl',    role: 'LandDeveloper',   name: 'Earl',    blurb: 'Sold swampland once. Plans to do it again.' },
    { id: 'desmond', role: 'LandDeveloper',   name: 'Desmond', blurb: 'Gold hard hat, gold watch, golden opportunities.' },
    { id: 'amara',   role: 'Researcher',      name: 'Amara',   blurb: 'Her field notes are already a textbook.' },
    { id: 'sven',    role: 'Researcher',      name: 'Sven',    blurb: 'Came for one season of fieldwork. Stayed for twelve.' },
    { id: 'gus',     role: 'Tourist',         name: 'Gus',     blurb: 'SPF 4 and a Hawaiian shirt. What could go wrong?' },
    { id: 'rosa',    role: 'Tourist',         name: 'Rosa',    blurb: 'Grandma has 3,000 gator photos and wants 3,001.' },
  ].map(s => Object.assign({ price: SKIN_PRICE }, s));

  // Chat lines: everything the bots say (see VOICE and REACT in game.js), rewritten to stand on their own,
  // sold in the store. Players send the lines they own as speech bubbles during a game.
  // Ids must never change once people have bought them (they are stored on accounts as 'chat:<id>').
  const CHAT_PRICE = 50;
  const CHAT_GROUPS = {
    Conservationist: ['I’ll protect these wetlands!', 'This place needs protecting.', 'Let’s check on the wetlands.', 'This biome needs a champion!',
      'Just what this place needs.', 'Every species counts.', 'Releasing this… under protest.', 'I’ll be watching closely.', 'Tread lightly, everyone.',
      'Not in my wetlands!', 'Someone stop that!', 'Invasives? Unacceptable.', 'Keystone species! Risk is down.', 'That holds the whole system together!',
      'It’s spreading!', 'Contain it!', 'Our natives…!', 'Not the natives!', 'Good riddance!', 'One less invader.', 'Bulldozing natives? Shameful.',
      'Huh. Thanks, I suppose.', 'For the wetlands!', 'Protected, for now.', 'I caused a crisis… I’m so sorry.', 'INVASIVE CRISIS! No, no, no…',
      'The natives are collapsing!'],
    Fisherman: ['Where are the big ones biting?', 'Fish are biting!', 'Casting lines.', 'That’s a keeper!', 'Big one on the line!', 'Throwing that one back.',
      'Oops, that fell off the boat.', 'Bait bucket special. Who’ll notice?', 'Water trip! Grabbing my rod.', 'Now THAT’s a catch!', 'Beauty of a fish.',
      'Ugh, in my fishing grounds?', 'There goes the catch…', 'Hey, that was my water trick!', 'Lost one off the hook…', 'Landed it!',
      'Hooked another one!', 'The fish stocks!', 'What’s happening to the water?!', 'Swapping catches.'],
    Hunter: ['Let’s go track something.', 'Tracking game.', 'Fresh trail.', 'Taking the shot!', 'A trophy!', 'Not trophy material.', 'Passing on that.',
      'Turn it loose. More game for me!', 'Good hunting ground.', 'Fresh tracks.', 'Open season!', 'On the prowl. Respect.', 'Now that’s a hunter.',
      'Clean shot.', 'Nice hunting.', 'That was my land trick…', 'Missed the shot.', 'Bagged it!', 'Trophy!', 'The game’s all gone!',
      'Whoa — what hit the woods?', 'Trading trophies.'],
    LandDeveloper: ['Time to see some property.', 'Surveying for new lots.', 'Prime waterfront.', 'Great for the brochure.', 'Big returns!',
      'Not my investment.', 'Minimal spend.', 'Clears space for development.', 'Free land clearing!', 'Prime real estate.',
      'I can see the condos already.', 'Business as usual.', 'There go my lots.', 'More residents? Bad for zoning.', 'Lower risk? Bad for business.',
      'Even I don’t like that snake.', 'Fewer residents, more room.', 'Clearing the lot nicely.', 'Sold!', 'Another parcel for the portfolio.',
      'Bad for everyone’s property values!', 'A crisis? Cheaper land!', 'Market correction. Love it.', 'Bulldozing!'],
    Researcher: ['Clipboards ready.', 'Field study time.', 'Collecting samples.', 'Strong data.', 'Documenting a fine specimen.', 'Low profile.',
      'Purely for science.', 'Observing… from a distance.', 'Fascinating.', 'Taking notes.', 'That changes the whole study.', 'Noting that down.',
      'Remarkable specimen.', 'Keystone effect observed.', 'Migration route logged.', 'Another trick? I wanted the fewest…',
      'Too much attention. Bad for the data.', 'The data… it’s collapsing!', 'Population crash! Write this down!', 'Less glory, more data.'],
    Tourist: ['I brought three cameras.', 'Sunscreen on.', 'Is this on the tour?', 'Best photo yet!', 'Look at that!', 'Saving film.',
      'Cute. Moving on.', 'Was I supposed to keep my pet?', 'Oops… it got loose.', 'This is on my list!', 'I’ve always wanted to see this!',
      'Ooh! *click*', 'Hold still!', 'Eek!', 'Nobody said there’d be one of those!', 'That’s ruining my photos.', 'Souvenir!', 'Best trip ever!',
      'Is everything okay out there?!', 'This was NOT in the brochure!', 'Peeking at the travel brochure…', 'Too touristy.', 'That stays on my itinerary!'],
    Table: ['You’ve got this one!', 'Backing you up.', 'Not stepping on your toes.', 'Nice one!', 'Go go go!', 'The Anaconda takes it…',
      'We’ll get it back.', 'What a trip!', 'GG, everyone!', 'Next time…', 'Well played.', 'Invasive Risk drops!', 'That keeps the invaders in check.',
      'It spreads!'],
    Anaconda: ['Ssslithering in…', 'The risk there is delicious.', 'Hide your natives.', 'Releasing it into the wild!', 'Behold!', 'Ssspreading nicely.',
      'A gift for the Everglades.', 'It feeds on the natives…', 'Ssso hungry.'],
  };
  const CHAT_GROUP_NAMES = { Table: 'Table talk', Anaconda: 'The Anaconda' };
  const CHAT_PREFIX = { Conservationist: 'con', Fisherman: 'fsh', Hunter: 'hnt', LandDeveloper: 'dev', Researcher: 'res', Tourist: 'tur', Table: 'tbl', Anaconda: 'ana' };
  const CHAT = [];
  for (const [group, lines] of Object.entries(CHAT_GROUPS)) lines.forEach((text, i) => CHAT.push({ id: CHAT_PREFIX[group] + (i + 1), group, text, price: CHAT_PRICE }));

  // Disruption cards (the optional Disruptions match modifier; from Disruptions.xlsx).
  // Each player is dealt 3, drafts 2, and may commit one face down after the biome is chosen each round.
  // `steps` tells the engine which choices the card asks of its owner (see the disruption section of game.js).
  const DISRUPTIONS = {
    Hurricane:          { name: 'Hurricane', text: 'You must remove 2 population tokens from the current region, then do the same for all adjacent regions.' },
    MassMigration:      { name: 'Mass Migration', text: 'You may move all tokens from the current region to any other region in a continuous line.' },
    HuntingSeason:      { name: 'Hunting Season', text: 'You may remove up to 5 total population tokens from any regions.' },
    EcologicalProtest:  { name: 'Ecological Protest', text: 'The Risk factor becomes 0 on the current region.' },
    CatchAndRelease:    { name: 'Catch and Release', text: 'You may move up to 5 population tokens from any regions to any other single region.' },
    FertilizerLeaching: { name: 'Fertilizer Leaching', text: 'Add a population token of the same type for each population token in the current region.' },
    WildFire:           { name: 'Wild Fire', text: 'Remove all population tokens from the current region unless it is a Water ecology. Double all Native tokens played onto the region this round.' },
    BountyHunting:      { name: 'Bounty Hunting', text: 'You may remove any number of Invasive tokens from the current region.' },
    RedTide:            { name: 'Red Tide', text: 'Remove all population tokens from the current region unless it is a Land ecology. Double all Native tokens played onto the region this round.' },
    TakeBribes:         { name: 'Take Bribes', text: 'The current Risk factor is considered 5 higher for your cards only this round.' },
    LandDevelopment:    { name: 'Land Development', text: 'Remove 2 population tokens from the current region. No population tokens can be placed on the current region this round.' },
    NatureDocumentary:  { name: 'Nature Documentary', text: 'Native cards you play this round have 5 additional Impact.' },
    Flood:              { name: 'Flood', text: 'If the current biome is Land, it becomes Wetland for the round. If it began as Wetland, it becomes Water for the round. Then remove 2 population tokens.' },
    Drought:            { name: 'Drought', text: 'Remove up to 5 population tokens from the current region. If the current region is Wetland, it becomes Land for the round.' },
    ChangingSeasons:    { name: 'Changing Seasons', text: 'You play last this round.' },
    Liberation:         { name: 'Liberation', text: "Take a card from another player's scoring pile and add it to yours." },
    RunawayPets:        { name: 'Runaway Pets', text: 'You may move all tokens from Miami to any number of other regions.' },
    TravelersGuidebook: { name: "Traveler's Guidebook", text: 'You begin the next round and may travel to any of the top 5 cards of the Biome deck instead of the Travel Row.' },
  };
  for (const [id, d] of Object.entries(DISRUPTIONS)) Object.assign(d, { id, img: 'assets/cards/disruption/' + id + '.png' });

  // Foil cards: a shiny version of any Ecology or Disruption card, seen only by the player who owns it.
  const FOIL_PRICE = 100;

  const DATA = { CARDS, REGIONS, ADJ, BIOMES, ROLES, BOSS, CHAR_ANIM, SKINS, CHAT, CHAT_GROUP_NAMES, DISRUPTIONS, FOIL_PRICE };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.EG_DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
