// Everglades — story endings, shown as text at the end of the game.
//
// Each role has a GOOD and a GRIM side, decided by the same condition as the back of its role card
// (see `good` in computeResults, game.js). Each side has several variants. The first variant whose
// `when` matches is used, so specific ones come first and the last one in each list is the default.
// A variant gets a context object `x` (built in endingContext below) describing the player's scoring
// pile and what they did during the game, and returns its text. Edit freely: it's all plain text.
'use strict';
const { CARDS, BIOMES, REGIONS } = require('./public/data.js');

const CHARISMATIC = ['Manatee', 'Flamingo', 'FloridaPanther', 'LeatherBackSeaTurtle', 'AmericanCrocodile', 'FloridaBlackbear', 'WoodStork', 'GreatBlueHeron', 'RiverOtter', 'MiamiBlueButterly'];
const BIG_SNAKES = ['BurmesePython', 'GreenAnaconda'];
const INVASIVE_FISH = ['Lionfish', 'AsianSwampEel', 'BlueTilapia', 'JewelFish', 'SuckermouthCatfish', 'WalkingCatfish'];
const KEYSTONES = ['FloridaPanther', 'AmericanCrocodile', 'GopherTortoise', 'EvergladesCypress', 'Coral', 'Seagrass'];
const BIG_GAME = ['FloridaPanther', 'FloridaBlackbear'];
const INVASIVE_GAME = ['WildBoar', 'FeralCat', 'BurmesePython', 'NileMonitor', 'BlackRat'];
const CITY_INVADERS = ['MonkParakeet', 'MuscovyDuck', 'BlackRat', 'FeralCat'];

const ENDINGS = {
  Conservationist: {
    good: [
      { when: x => x.stats.refused >= 2, title: 'The Line You Held',
        text: x => `Every time an invader landed in your hands, you refused to let it take root, ${x.stats.refused} times in all. Word of your stubbornness spread from the ranger stations to the statehouse. When the hearings came, you didn't bring slides. You brought a jar of clear slough water and set it on the table. The vote to protect the entire watershed passed by a landslide. The Everglades have a guardian, and everyone knows your name.` },
      { when: x => x.has(...KEYSTONES), title: 'Keystone',
        text: x => `Standing waist-deep in sawgrass beside the ${x.pick(KEYSTONES)}, you finally understood how the whole system hangs together: pull one thread and everything unravels, protect it and everything holds. You carried that lesson back to the city, and it became the slogan of a movement. Today the Everglades are a national treasure, guarded by law and loved by millions. The water runs clean, and the future runs bright.` },
      { when: x => !x.stats.crises && x.nativeMajority, title: 'Clean Hands',
        text: x => `You crossed the whole watershed without once tipping it toward collapse. Natives outnumber invaders across the map, and your record is spotless. Your advocacy groups grew into a coalition no politician dares ignore, and the Everglades were raised from national park to national treasure. On quiet mornings you still paddle out alone, just to listen to the marsh breathe.` },
      { title: 'A National Treasure',
        text: x => `You walked the Everglades and saw the invasive crisis with your own eyes. You came home with fire in your chest and built advocacy groups to raise the entire watershed from national park to national treasure. Today the Everglades are protected by law and held in the nation's heart with pride. There is a bright future ahead.` },
    ],
    grim: [
      { when: x => x.stats.crises > 0, title: 'By Your Own Hand',
        text: x => `It was your ${x.name(x.stats.crisisCards[0])} that tipped the balance and set off the crisis. You know it, and so does everyone who was there. The pamphlets still carry your face, and the donations still clear, but you can no longer look at a map of the park without seeing the gray spreading across it. You keep giving speeches. You just stopped believing them.` },
      { when: x => x.has(...BIG_SNAKES), title: 'The Photograph',
        text: x => `The picture that went viral from your expedition wasn't a panther or a flamingo. It was a ${x.pick(BIG_SNAKES)}, thick as a fire hose, coiled in the heart of the park. The public decided the Everglades were already lost. Funding dried up within a year. You still hold the title of conservationist, but the swamp has stopped listening, and so has everyone else.` },
      { title: 'Going Through the Motions',
        text: x => `You trudged through the swamp they call the Everglades and learned that most of the city's mosquitoes come from out here. The trip left you disillusioned, but you enjoy the influence your title brings, so you keep at it just enough to get paid. Invaders are still spreading through the park while you smile for the cameras. The future is grim.` },
    ],
  },

  Fisherman: {
    good: [
      { when: x => x.has('Manatee', 'LeatherBackSeaTurtle'), title: 'Company on the Water',
        text: x => `On your last morning of the season a ${x.pick(['Manatee', 'LeatherBackSeaTurtle'])} surfaced beside your hull, close enough to touch, and you cut the engine and just watched. Years of careful fishing had brought the waters back to life. Every charter captain on the coast now follows your rules, and the young ones call you "the old man of the bay." It's the best catch you ever made.` },
      { when: x => x.mostWaterTricks, title: 'King of the Flats',
        text: x => `No one landed more from the water than you did. But it's how you did it that made you a legend: catch limits, clean bait, no invaders over the side. Your methods spread from dock to dock until every fishing company in the state adopted them. The fish are bigger, the flats are full, and you might just leave a healthy ocean for the next generation after all.` },
      { title: 'Good Fishing',
        text: x => `You committed your life to proving that good fishing practices work. Traveling the entire Everglades watershed, you sampled every aquatic population, and your efforts have paid off. You have never seen fish so plentiful, and invasive species are finally dwindling. Local fishing companies have all agreed to adopt your practices. It seems you might leave a healthy ocean for the next generation after all.` },
    ],
    grim: [
      { when: x => x.has(...INVASIVE_FISH), title: 'Full Nets, Empty Waters',
        text: x => `Your nets still come up heavy, heavy with ${x.pick(INVASIVE_FISH)}. Nobody wants to buy them, and the snook and redfish your customers ask for have all but vanished. You built a fleet on the bottom line, and now the bottom line is chewing through the bottom of the bay. Your accountant has stopped returning your calls.` },
      { when: x => x.waterCards === 0, title: 'Dry Dock',
        text: x => `You spent the whole season chasing everything but fish. By the time you got back to the docks, the boats were rusting, the crew had scattered, and the waters you once knew by heart were full of species you couldn't name. You sold the fleet for scrap. Some nights you still dream of the tide coming in.` },
      { title: 'The Bottom Line',
        text: x => `You spent your career fishing for the bottom line, and you got rich doing it. You now run an entire fleet of boats, but lately the catches keep getting smaller, and half the local fish your customers demand are nearly extinct. If this keeps up, you'll lose the whole fleet by the end of the year...` },
    ],
  },

  Hunter: {
    good: [
      { when: x => x.has(...INVASIVE_GAME.filter(id => CARDS[id].habitat === 'Land' || id === 'BurmesePython')), title: 'The Invader Hunter',
        text: x => `They call you the best invasive species hunter in Florida. The ${x.pick(INVASIVE_GAME)} that once tore through the hammocks are on the run, and the natives are moving back in behind you. A TV network just signed you for a reality show following your daily hunts, and the state is printing your face on wildlife posters. For the first time in a hundred years, the native ecosystem has stabilized.` },
      { when: x => x.has(...BIG_GAME), title: 'The Shot You Didn’t Take',
        text: x => `You had the ${x.pick(BIG_GAME)} square in your sights at fifty yards. Then you lowered the rifle. That moment, caught on a trail camera, made you famous. You've spent the years since hunting only invaders, and the press credits you with saving the Everglades. When the researchers announced the native ecosystem had stabilized, they thanked you by name.` },
      { title: 'Star of the Swamp',
        text: x => `You've made a good life hunting invasive species to near extinction. The press loves you, and you just learned you'll star in a new reality show following your daily life! News reports credit you with saving the Everglades after a researcher published that the native ecosystem has stabilized for the first time in over 100 years.` },
    ],
    grim: [
      { when: x => x.has(...BIG_GAME), title: 'The Trophy',
        text: x => `The ${x.pick(BIG_GAME)} mounted over your fireplace is what sank you. Investigators traced it back through the taxidermist, then through the bank records, then to you. You've been arrested for poaching endangered species, and scientists say several may go extinct because of what you took. You'll be paying for that trophy for a very long time.` },
      { when: x => x.landCards === 0, title: 'Cold Trail',
        text: x => `You never found the trail. While you were out chasing rumors, the hammocks filled with boar and the pinelands went quiet. Your outfitting business folded, your hunting license lapsed, and the only thing you track now is the price of gas. The Everglades moved on without you.` },
      { title: 'The Rush of the Hunt',
        text: x => `You've spent your whole life chasing the rush of the hunt, but today your crimes caught up with you. You've been arrested for illegal poaching, and they say several species will likely go extinct because of your actions. You'll pay for that for a long time.` },
    ],
  },

  LandDeveloper: {
    good: [
      { when: x => x.stats.bulldozedI >= 2, title: 'Clearing the Way',
        text: x => `Before every foundation was poured, your crews went in first and ripped out the invaders: ${x.stats.bulldozedI} infestations cleared and native buffers replanted. The press called it "conscientious construction," and it caught on. Miami grew upward instead of outward, and the empty land around it was left to heal. You built a city that knows where to stop.` },
      { when: x => x.mostTricks, title: 'The Visionary',
        text: x => `You closed more deals than anyone in the state, and you did it without paving the wild places. Dense, efficient towers rose in Miami while the land around it was left empty and protected. Architecture schools now teach your model as "the Everglades compromise." Your name is on a dozen buildings, and, for once, on a nature preserve too.` },
      { title: 'The Middle Road',
        text: x => `You championed the middle road between progress and conservation. Through extensive exploration and consultation with ecologists, you avoided every critical habitat in the watershed and built dense, highly efficient developments that keep the ecosystem and the cityscape in delicate harmony.` },
    ],
    grim: [
      { when: x => x.stats.bulldozedN >= 2, title: 'Scorched Earth',
        text: x => `Your bulldozers flattened ${x.stats.bulldozedN} native habitats to make room for the next phase. The permits were questionable, and the fines were cheaper than the delays. Miami sprawls to the horizon now, and nothing native lives within ten miles of it. The investigation is still open. Your lawyers say it will close soon. Your conscience disagrees.` },
      { when: x => x.has(...CITY_INVADERS), title: 'Neighbors',
        text: x => `Your new subdivisions sold out in a week, but the residents moving in weren't just people. ${x.pickName(CITY_INVADERS)} colonies spread through every courtyard and canal, and the homeowners' association blames you. Miami has grown enormous, the wild has been pushed back to nothing, and your phone won't stop ringing.` },
      { title: 'How to Sleep at Night',
        text: x => `You did your job. Miami has grown enormously, at the cost of a few species going extinct here and there. You're under investigation for breaking several environmental protection laws, but your legal team assures you nothing will stick. Now you just need to figure out how to sleep at night...` },
    ],
  },

  Researcher: {
    good: [
      { when: x => x.taxa >= 6, title: 'The Complete Survey',
        text: x => `Your study covered ${x.taxa} branches of the tree of life, from the ${x.pick(...x.nativeIds)} to the smallest snail, and it's the most complete survey of the Everglades ever made. It shows, beyond doubt, that conservation is working. The journal fast-tracked it, the newspapers ran it on the front page, and three new protection bills cite your data in their first paragraph.` },
      { when: x => x.tricks <= 1, title: 'From the Margins',
        text: x => `You kept your head down, stayed out of the spotlight, and quietly filled notebook after notebook. When your paper finally appeared, it landed like thunder: native populations recovering faster than anyone predicted. The same people who overlooked you are now quoting you. Popular news calls your work the turning point for the Everglades.` },
      { title: 'Published',
        text: x => `You collected extensive population data during your field study, with remarkably encouraging results. You published in a top journal, showing that although the ecosystem remains endangered, conservation efforts are having a striking effect on restoring native species. Your paper's impact is skyrocketing, and even popular news cites it as a hallmark of the Everglades' bright future.` },
    ],
    grim: [
      { when: x => x.has(...BIG_SNAKES), title: 'Apex',
        text: x => `Your most-cited figure is a graph of ${x.pick(BIG_SNAKES)} sightings, rising like a fever. You meant it as a warning. Lawmakers read it as a surrender notice. Within a year, funding for native-species recovery was redirected to "management of the inevitable." You still publish. No one listens.` },
      { when: x => x.allCrises >= 3, title: 'The Crash',
        text: x => `You documented ${x.allCrises} population crashes in a single field season, each worse than the last. The data was flawless and the conclusion was devastating: several endangered species will be extinct within five years. You published anyway. Your findings are now the centerpiece of a campaign to abandon the Everglades entirely.` },
      { title: 'Unintended Consequences',
        text: x => `You collected extensive population data during your field study, but the outlook is grim. Endangered species are plummeting, several toward extinction within five years, driven by rising invasive populations. You published your findings, but they are being used to justify surrendering the Everglades and cutting all federal and state conservation funding. You may have accidentally heralded the end of the Everglades.` },
    ],
  },

  Tourist: {
    good: [
      { when: x => x.has(...CHARISMATIC), title: 'The Shot',
        text: x => `ONE photo. That's all it took. Your shot of a ${x.pick(CHARISMATIC)} at golden hour went around the world twice before lunch! Millions of people fell in love with the Everglades overnight, donations POURED in, and the state declared the entire watershed a protected park. You're booked to speak at three festivals. You still can't believe that was your vacation.` },
      { when: x => x.onlyObjective && x.tricks > 0, title: 'Perfectly Planned',
        text: x => `Every single stop on your itinerary was EXACTLY where you wanted to be, and you saw it all. Your travel blog became the official unofficial guide to the Everglades. The state hired you to design wildlife tours that keep visitors on the trails and away from the nests. Tourism is booming, and so is the wildlife!` },
      { title: 'You Saw EVERYTHING',
        text: x => `You saw EVERYTHING in the Everglades and it was AMAZING! Your photos EXPLODED online, you have MILLIONS of views, and people are pouring support into conservation in your name! The state got so excited that it declared the ENTIRE watershed a state park and sponsored new trails and lodges to welcome the massive BOOM in wildlife tourism!` },
    ],
    grim: [
      { when: x => x.has(...BIG_SNAKES), title: 'Not in the Brochure',
        text: x => `The only wildlife photo that turned out was a ${x.pick(BIG_SNAKES)}. In a ditch. Eating something. You posted it with the caption "never again," and it got more views than everything else you've ever posted combined. Bookings to the Everglades fell by half that summer. Your travel agent sent a strongly worded email.` },
      { when: x => x.tricks === 0, title: 'The Airboat Tour',
        text: x => `You never actually made it off the airboat. Three days of engine noise, sunburn and a guide who kept pointing at "probably a heron." Your review, "1 star, mostly mud," went viral. Hardly anyone visits the Everglades for vacation anymore, and somehow that feels like your fault.` },
      { title: 'A BAD Trip',
        text: x => `You had a BAD trip. You wandered all over the Everglades... and it was so depressing everywhere. You'd heard about endless wetlands full of flamingos and panthers, but mostly you saw invasive snakes and pine trees in swampy mud. You complained to anyone who would listen, and SO many people did. Hardly anyone goes to the Everglades for vacation anymore.` },
    ],
  },
};

// The Anaconda's own epilogue in co-op (boss perspective). Good for the Anaconda = invasives in every region.
const ANACONDA_ENDINGS = {
  good: [
    { when: x => x.eaten >= 14, title: 'The Feast',
      text: x => `It ate well: ${x.eaten} native populations swallowed whole. Now invaders have reached every corner of the map, and nothing native is left to stop them. The Everglades are doomed. Within a few short years the ecosystem will collapse, and the Anaconda will still be there, coiled in the warm, dark water, waiting.` },
    { title: 'Dominion',
      text: x => `The Everglades are doomed. Invasive species dominate every region, and the native ecosystem will collapse within a few short years.` },
  ],
  grim: [
    { when: x => x.eaten >= 14, title: 'Scars', // it usually eats 12-15 native populations in a game
      text: x => `They drove it back, but not before it swallowed ${x.eaten} native populations. Rangers still find its trails pressed into the mud of the deep sloughs. The Everglades will heal, slowly, and every scar will remind the people who saved it how close it came.` },
    { title: 'Deep in the Heart',
      text: x => `The invasion has been thwarted by many good-hearted lovers of nature. But the Anaconda remains deep in the heart of the Everglades, where no one has rooted it out. It will be a long battle to wipe it out entirely.` },
  ],
};

// Everything a variant might want to know about a player's game.
function endingContext(s, r, results) {
  const pl = s.players[r.p];
  const pile = pl.pile;
  const has = (...ids) => ids.some(id => pile.includes(id));
  const people = s.players.filter(x => !x.boss);
  const suitTricks = (x, suit) => x.biomesWon.filter(id => BIOMES[id].suit === suit).length;
  const ROLES = require('./public/data.js').ROLES;
  const b = s.board;
  const totalN = Object.values(b).reduce((a, t) => a + t.n, 0), totalI = Object.values(b).reduce((a, t) => a + t.i, 0);
  const nativeIds = pile.filter(id => CARDS[id].kind === 'Native').sort((a, c) => CARDS[c].impact - CARDS[a].impact);
  return {
    has, stats: pl.stats || {}, tricks: pl.biomesWon.length,
    name: id => (CARDS[id] ? CARDS[id].name : id),
    // the first of these cards that is in the pile (in the order given)
    pick: (...ids) => { const id = ids.flat().find(i => pile.includes(i)); return id ? CARDS[id].name : 'creature'; },
    pickName: ids => { const id = ids.find(i => pile.includes(i)); return id ? CARDS[id].name : 'Invasive'; },
    nativeIds,
    taxa: new Set(pile.map(id => CARDS[id].taxon)).size,
    waterCards: pile.filter(id => CARDS[id].habitat === 'Water').length,
    landCards: pile.filter(id => CARDS[id].habitat === 'Land').length,
    mostWaterTricks: suitTricks(pl, 'Water') > 0 && suitTricks(pl, 'Water') === Math.max(...people.map(x => suitTricks(x, 'Water'))),
    mostTricks: pl.biomesWon.length > 0 && pl.biomesWon.length === Math.max(...people.map(x => x.biomesWon.length)),
    onlyObjective: pl.biomesWon.every(id => ROLES[pl.role].map[BIOMES[id].region]),
    nativeMajority: totalN > totalI,
    allCrises: s.players.reduce((a, x) => a + ((x.stats && x.stats.crises) || 0), 0),
  };
}

function choose(list, x) {
  const v = list.find(e => !e.when || e.when(x));
  return { title: v.title, text: v.text(x) };
}

// The ending for one player's result (good or grim side decided by r.good).
function endingFor(s, r, results) {
  const side = ENDINGS[r.role];
  if (!side) return null;
  const x = endingContext(s, r, results);
  return Object.assign({ good: r.good }, choose(r.good ? side.good : side.grim, x));
}

// The Anaconda's epilogue (co-op).
function anacondaEnding(s) {
  const everywhere = Object.values(s.board).every(t => t.i > 0);
  const boss = s.players[s.bossIdx];
  const x = { eaten: (boss.stats && boss.stats.eaten) || 0 };
  return Object.assign({ good: everywhere }, choose(everywhere ? ANACONDA_ENDINGS.good : ANACONDA_ENDINGS.grim, x));
}

// The rule that decides each side, in words (shown under the ending's title).
const CONDITIONS = {
  Conservationist: ['No Invasive populations in Everglades National Park', 'Invasive populations remain in Everglades National Park'],
  Fisherman: ['More Native than Invasive Water cards in your scoring pile', 'Not more Native than Invasive Water cards in your scoring pile'],
  Hunter: ['More Native than Invasive Land cards in your scoring pile', 'Not more Native than Invasive Land cards in your scoring pile'],
  LandDeveloper: ['A region next to Miami has no population', 'Every region next to Miami has population'],
  Researcher: ['More Native than Invasive cards in your scoring pile', 'Not more Native than Invasive cards in your scoring pile'],
  Tourist: ['Every one of your objective regions was scored by someone', 'One of your objective regions was never scored'],
  Anaconda: ['Invasive populations in every region', 'Some regions are free of Invasive populations'],
};

module.exports = { ENDINGS, ANACONDA_ENDINGS, CONDITIONS, endingFor, anacondaEnding };
