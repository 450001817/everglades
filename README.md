# Everglades: Online Multiplayer

A website version of your Everglades trick-taking game. It uses your own card and board art. Friends join from their browsers with a 4-letter room code, and bots fill any empty seats so every game has at least 4 players. The look matches your retro pixel art, and every sound is generated in the browser, so there are no audio files. It has three modes: everyone for themselves, Partners, and Co-op against The Anaconda.

## Play it on your computer (about 2 minutes)

1. Install **Node.js** (the "LTS" version) from https://nodejs.org. You only do this once.
2. Double-click **start.bat** in this folder. A black window opens, and your browser opens to the game.
3. Sign in (or click **Play as guest**), click **Start a new table**, and share the room code or link.
4. Click **Start game**. Bots fill the table up to 4 players. The host can add more bots, up to 6 players.

**Game modes:** in the lobby the host picks **Solo** (everyone for themselves), **Partners** or **Co-op**.

**Partner mode:** with **Partners** selected, Players then pick a team (Mangrove, Sawgrass or Coral) next to their name; the host can also place other players and bots. Anyone without a team gets a random partner. A bot joins if needed to make an even table (4 or 6 players). Seats alternate teams (A B A B, or A B C A B C), so **teammates never take turns back to back**. Each player still drafts a role and scores their own objectives and tricks, then **partners add their scores together** and the highest team total wins. Both winning partners' role-card endings are shown. Bots avoid beating a partner who's already winning a trick.

**Co-op vs The Anaconda:** with **Co-op** selected, everyone plays together against an automated boss, The Anaconda (`AnacondaBoss.png`; hover its name in the game to read it).
- **Setup:** the Native cards are dealt evenly to the players. The 18 Invasive cards are shuffled into the Anaconda's deck. Players still draft roles in turn order.
- **Each round:** after **each player's turn**, the Anaconda flips the top Invasive card and plays it. Normal trick rules apply, and an Anaconda win triggers an Invasive Crisis as usual.
- **When the Anaconda wins a trick,** it travels to the highest Invasive Risk biome in the travel row (the rightmost one on a tie). The next player in rotation plays first.
- **Its Predatory cards** always eat Native tokens, before their own tokens arrive. **Its Migratory cards** move all their tokens to the adjacent region with the most Native tokens (they stay put if no neighbour has any).
- **The game ends** after the round in which the Anaconda plays its last card. Players always have cards left over.
- **Scoring:** add up all players' scores (role objectives plus 5 per trick). You must **beat** the Anaconda; it wins ties. It scores **5 pts for each map objective the players miss** (this scales with player count), **5 pts per trick it wins**, and **3 pts per region with an Invasive majority**.
- **Endings:** if the players win, the highest scorer's good ending is told. If the Anaconda wins, the lowest scorer's grim ending is told. The Anaconda gets its own epilogue either way.
- **Balance:** in simulated games with bot players, the players win roughly 35–55% at every table size from 1 to 6 (about 45% with 4). Real players should do better than the bots. Run `node test/coopsim.js` to re-check after rule changes. The point values live in `COOP` near the top of the co-op section of `game.js`.

**About the bots:** bots play the same rules and use their role abilities. When a bot plays a card, travels, uses an ability, spreads or hunts, a short in-character speech bubble appears next to its name (for example, the Fisherman's "Reeling in a Manatee. That's a keeper!").

**Chat lines:** players can say those lines too. Every bot line is in the Store as a **chat line for 50 EB** (159 in all, grouped by character, plus Table talk and the Anaconda). Lines that named a card or place were reworded to stand on their own, so "Reeling in a Manatee" became "That's a keeper!". During a game, click **💬 Chat** in the top bar and pick one of your lines: it pops up as a speech bubble over your seat for everyone at the table. Your own character's lines are listed first. You can send one line every 2.5 seconds. The lines live in CHAT_GROUPS in `public/data.js`; add new ones at the **end** of a group, because a line's id comes from its position and accounts store those ids.

**Speed:** the host picks how fast the bots play: **Slow**, **Normal** or **Fast**. Pick it in the lobby, or click the **Speed** button in the game's top bar at any time; other players see the setting. Bots wait about 5 seconds before each move on Slow, 3 on Normal and 1.5 on Fast. To rescale all three, set `BOT_DELAY_MS` near the top of `server.js` (3200 is Normal; a bigger number is slower).

**End of each trick:** the game pauses on the finished trick. The winning card is raised, outlined in gold and stamped WINNER (red for an Invasive Crisis), and the other cards are dimmed. A bar counts down to the next round. The pause lasts about 7 seconds on Slow, 5 on Normal and 3 on Fast. Bots wait for it too, and after the last trick the final scores appear when it ends.

**Character reactions:** every player, human or bot, shows their role's animated portrait in the Players panel, and the portraits react to what happens in the game. Each of the 6 characters has 6 short pixel animations, made with PixelLab from the role-card portraits:

| Animation | When it plays |
|---|---|
| idle | Now and then, a breath and a blink |
| think | Often while it's that player's turn |
| signature | Their themed move (podium speech, tipping a cap, aiming, pointing, writing notes, snapping a photo): when they pick their role, use their ability, or something on-theme happens, plus occasionally on its own |
| cheer / upset / shock | Reactions to the game |

Reactions follow each character's theme. For example, the Conservationist is upset when an Invasive card lands in her regions and shocked by an Invasive Crisis, which the Land Developer cheers ("Cheaper land!"). The Researcher groans when he wins a trick because he wants the fewest. The Fisherman and Hunter react to Water and Land cards and tricks, and the Tourist photographs charismatic animals and shrieks at pythons. Partners and co-op teammates cheer each other's tricks. A small badge on the portrait shows the mood (★ ! … ? ♪). Bots sometimes say a matching line in a speech bubble, and big moments always get one. Human players get the animation only, but they can speak with the chat lines they own (see Chat lines above). The Anaconda's portrait rattles when it wins a trick or feeds.

All of these rules are in `REACT` near the end of `game.js`. Edit a line or a trigger there to change a reaction. The animation files are in `public/assets/characters/<Role>/`, and their playback speed is set in `CHAR_ANIM` in `public/data.js`.

Keep the black window open while you play. Closing it stops the game.

**Friends on the same Wi-Fi:** the black window shows a "Same Wi-Fi friends" address, like `http://192.168.1.20:3000`. Send them that address. Windows may ask whether Node can use the network; click Allow.

**Friends anywhere on the internet:** the game has to run on a hosting service. The simplest option is Render (render.com, free tier):
1. Put this folder in a GitHub repository. On github.com, create a new repository, click **uploading an existing file**, and drag in everything inside this `WebGame` folder (not the folder itself), so `package.json` sits at the top of the repository. `Everglades-WebGame.zip` next to this folder holds the same files.
2. In Render, create a **Web Service** from that repository.
3. Set the Build Command to `npm install` and the Start Command to `npm start`.
4. Render gives you a link you can share with anyone.

The free tier sleeps when no one is using it, so the first visit can take about 30 seconds.

## Player accounts and Eco-bucks

Everyone signs in before they sit down at a table. An account keeps your **gamertag**, **profile picture**, **Eco-bucks (EB)** wallet, unlocks and stats. Open **Profile** or **Store** from the home page or the lobby.

- **Signing in:** with Google (once you set it up, below) or as a **guest**. A guest account is saved in that browser only.
- **Profile pictures:** headshots of the 6 characters and the Anaconda are free. Each of the 36 animal cards has its own picture, which unlocks after you **win 5 tricks with that card**. Your profile shows your progress (for example 3/5). Plant cards don't count.
- **Buy-in:** every table has one, chosen by the host: **5, 50, 150 or 500 EB**. It's taken from every player when the game starts. The house pays the bots' buy-ins and keeps whatever a bot would win, so beating bots is how new Eco-bucks come into the game.
- **Payouts (Solo and Partners):** 1st takes the rest of the pot, 2nd gets their bet back, 3rd gets half back, and everyone below loses their bet.
  - Tied players share the payouts of the places they tie for.
  - In Partners, each player is ranked by their team's total.
  - The end screen shows everyone's payout and your new balance.
- **Co-op:** beat the Anaconda and everyone gets double their bet back. Lose, and everyone loses it.
- **Starting money and daily bonus:** new accounts start with **50 EB**. Each day you also get a **50 EB log-in bonus** the first time you sign in or open the game. Days are counted in UTC, Coordinated Universal Time, so in the US a new day starts in the evening.
- **Store:** the **Savior of the Everglades** title (10,000 EB) sparkles under your name on your player banner. You can wear it or take it off in the store.
- **Character skins (500 EB each):** click any of the six characters on the home page to open their skin shop. You can also reach the shops from the Store.
  - There are 2 skins per character, 12 in all. Each has a unique name that only shows in the shop.
  - The big preview plays every animation. Click a skin's thumbnail to preview it.
  - Buying a skin equips it straight away. **Equip** switches between the skins you own and the **Original**.
  - When you play that character, **everyone at the table sees your skin**, including on the end screen. Bots and other players keep their own looks.
  - Skins only change the look; the role plays exactly the same.
  - **Role cards come alive:** wherever a role card is shown (the draft, your role card at the bottom right, and every enlarged hover card), the photo on the card is replaced by the animated portrait, in the skin of whoever holds that role. During the draft, roles nobody has taken yet show your own skins. The portrait breathes and blinks and now and then does its signature move.

  | Character | Skins |
  |---|---|
  | Hunter | Rodney, Maribel |
  | Fisherman | Kenji, Dot |
  | Conservationist | Tomás, Leona |
  | Land Developer | Earl, Desmond |
  | Researcher | Amara, Sven |
  | Tourist | Gus, Rosa |

  **Adding a skin:** add a line to `SKINS` in `public/data.js`, then put its 6 animation strips (`idle`, `think`, `signature`, `cheer`, `upset`, `shock`) in `public/assets/characters/<Role>/skins/<id>/`. Each strip is 9 frames of 128×110, the same as the originals. The skins were made with PixelLab: the original portrait was edited into a new person, then each animation was generated from that portrait.
- **Safety:** a game cut short by a server restart, or abandoned before the end, refunds everyone's buy-in.

All the numbers (starting balance, daily bonus, buy-ins, unlock count) and the store's items are at the top of `accounts.js`. To add a cosmetic, add it to `STORE` there. Skins and their price (`SKIN_PRICE`) are in `public/data.js`. Run `node test/economy.js` to check the payouts, store, unlocks and sign-in after changes.

### Turning on "Sign in with Google" (about 10 minutes, free)

1. Go to https://console.cloud.google.com, create a project, and open **APIs & Services → Credentials**. You'll be asked to fill in a basic **OAuth consent screen** first: an app name and your email.
2. Click **Create credentials → OAuth client ID** and choose **Web application**.
3. Under **Authorized JavaScript origins**, add every address the game is played from, for example `http://localhost:3000` and your Render address, like `https://your-game.onrender.com`. No redirect URIs are needed.
4. Copy the **Client ID**, which ends in `.apps.googleusercontent.com`. Set it as the environment variable `GOOGLE_CLIENT_ID`:
   - On your computer, add `set GOOGLE_CLIENT_ID=...` to `start.bat` before the `node` line.
   - On Render, add it under **Environment**.

The game only stores Google's anonymous user id, never your name or email. Once Google works you can turn off guest accounts with `ALLOW_GUEST_ACCOUNTS=0`.

### Where accounts are saved (important when hosting)

On your own computer, accounts live in `data/accounts.json` next to `server.js`. This folder is never uploaded; `.gitignore` excludes it.

**On Render's free tier, files are wiped on every deploy, every restart, and every time the free service goes to sleep after 15 idle minutes.** To keep everyone's Eco-bucks, store accounts in a free **Upstash Redis** database instead (about 5 minutes, no credit card):

1. Sign up at https://upstash.com and click **Create Database** (Redis). Pick the region closest to your Render service. The free plan is plenty.
2. On the database page, find the **REST API** section and copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**.
3. In Render, open your service, go to **Environment**, add both variables with those exact names, and save. Render restarts the game.
4. In Render's **Logs** you should see `Player accounts are saved to: Upstash Redis (…)`.

How it works:
- While the game runs, accounts are kept in memory. Changes are sent to Upstash a second or two later, and only the records that changed are sent.
- When the server starts, it loads everything back before letting anyone in.
- When Render shuts it down, it finishes saving first.
- If Upstash can't be reached at start-up, the server refuses to start, so it never starts with empty wallets and overwrites everyone's data.
- The first time you switch on Upstash, any accounts already in the local file are copied up.

Keep the token secret. It's in Render's Environment settings, not in your code, so it isn't uploaded to GitHub.

**On your own computer:** copy `.env.example` to `.env` and paste the same values in. The server reads `.env` when it starts. `.env` is private: `.gitignore` excludes it and it's left out of the zip.

The other option is Render's paid **Persistent Disk**: mount it at, say, `/var/data` and set `DATA_DIR=/var/data`, without the Upstash variables.

## How a turn works on screen

The whole game fits on one screen with no page scrolling. From left to right: the players list with everyone's animated character portrait, the map, and the play area. Your hand runs along the bottom. Portraits shrink to fit when there are more players. On narrower windows and phones, the players list moves to the top of the play area as a row of small portraits. The play area changes with the moment:

- **While a biome is being picked**, the Travel Row fills the play area with big cards, and the last trick shows small underneath.
- **Once a biome is chosen**, the Travel Row shrinks to a small strip at the bottom. The current biome and the cards played to it take over the play area.
- **Field notes** (the game log) is a drop-down in the top bar, next to the sound and Rules buttons. A red number shows how many new notes arrived since you last looked.

- **Shuffle and deal:** when the game starts, the Ecology deck shuffles and the cards are dealt around the table. Click anywhere to skip.
- **Role draft:** after the host starts, everyone's hand is dealt and players choose roles one at a time in turn order. The first player picks first, and taken roles are stamped with the owner's name. Bots pick when their turn comes. The first round starts once everyone has a role.
- **Read any card:** hover over it for 1 second (on a phone, press and hold). This works everywhere: your hand, the travel row, played cards, role cards and the end screen.
- **Lead player:** when it's your pick, the travel row glows and each biome says TRAVEL HERE. Click one.
- **On your turn:** cards you can't legally play are greyed out. Click a card to select it, then click it again (or click Play).
- **Your role ability** (start of turn) appears as a gold button next to Play. If you try to play a card while it's unused and would actually do something, an **"Use your ability first?"** pop-up explains what you'd miss. Choose **Use ability first**, **Play anyway**, or tick **Don't warn me again this game**.
- **Red warning signs** appear over Invasive cards in your hand whose Impact is above the current Invasive Risk. Those cards can't win the trick, though they still populate. The signs update if a Keystone card changes the Risk.
- **Migratory:** click the glowing regions on the map to place each token. The tokens have to form a continuous line.
- **Predatory:** right after you play the card, click the blinking green or red counters on the map to remove Native or Invasive tokens, then click **Done hunting**. The card's own tokens are added after the hunt.
- **Population** shows two ways: a counter under each region name, plus small green (Native) and red (Invasive) squares that drop in and spread across the region.
- **Roles are public.** Everyone's role shows in the Players list; hover a player to read their role card.
- **Title theme:** an original 8-bit song, "Sunset over the Sawgrass", loops on the home page, in the lobby and on the loading screen, and fades out when the game starts.
  - It starts on your first click or key press, because browsers block sound until then.
  - The **♪ Music** button in the top-right corner turns it off, and your browser remembers the choice.
  - Like the sound effects, the music is synthesized live in the browser, so there are no audio files.
  - The song is written out note by note in `public/music.js`, if you want to change it.
- **Sound:** retro 8-bit effects for playing cards, travelling, placing and removing tokens, your turn, winning a trick, Invasive Crisis and game end. Use the ♪ button in the top bar to turn it off.
- **At the end**, everyone sees the scores and the winner's story ending, written out as text. Each role's ending is good or grim by the same rule as the back of its role card. Each side then has several variants, picked by what's in the winner's scoring pile and what they did during the game. For example:
  - The Conservationist who refused to let invasives take root gets "The Line You Held".
  - A Fisherman holding a Manatee gets "Company on the Water".
  - A Hunter with a Florida Panther trophy gets "The Trophy".
  - A Land Developer whose bulldozers flattened native habitat gets "Scorched Earth".
  - A Tourist whose only photo was a python gets "Not in the Brochure".

  In all there are 40 endings. They live in `endings.js`, which is plain text and easy to edit. Run `node test/endings.js` to see how often each one comes up.

The layout is built for laptop and desktop screens (1024×768 and up), and it has its own **phone layout**:
- **Scrolling page:** the screen scrolls up and down. A row of player portraits sits at the top, then the play area, then the map at full screen width.
- **Your hand:** pinned to the bottom of the screen, with big cards you swipe sideways. "You are the …" above the cards opens your role card when you press and hold it.
- **Reading cards:** press and hold any card or player for a second to read it.
- **Your move:** when you need to click the map (spreading or hunting) or pick a biome or role, the page scrolls there for you.
- **Speech bubbles:** only the newest one shows, so the screen stays clear.

This works with the phone held upright or sideways.

## Rule decisions I made (please check these)

Your rulebook (Everglades 2.0), the reference card and the printed cards disagree in a few places. The game follows the **printed cards and reference card**, because they're the newest.

1. **Invasive cards** match the lead suit when their Impact is **at or below the current Invasive Risk**. A **Keystone** card **lowers the Risk by 1 for each Native token in the current region**, counted right after the Keystone card adds its own population (so its own tokens count), and never below 0. Several Keystones in one trick each lower it further. The lowered Risk applies to every card in that trick, including cards played earlier, and the next biome starts again at its printed Risk. Your reference card (`ReferenceCardFront.png`) was updated to read "Keystone: Invasive Risk -1 per native token in this region." The original is saved in `_backup_reference_cards`.
2. **If nobody plays a matching card**, the highest-Impact card wins anyway. This is a house rule, because the rules don't cover it. It came up in about 9% of tricks in simulated games.
3. **Ties:** an Invasive card beats a Native card with the same Impact. Otherwise the card played first wins.
4. **Predatory** hunts **before** the card populates: you remove up to X tokens, choosing **Native or Invasive**, from the region the card is played in. Only then are the card's own tokens added, so a predator never eats its own arrivals. The Great Barracuda (Predatory and Migratory) hunts in the trick's region first, then spreads. The Anaconda follows the same order.
5. **Fisherman/Hunter swap:** swap **any** card from your hand with **any** Water card (Fisherman) or Land card (Hunter), Native or Invasive, from your scoring pile. There's no Impact restriction; the role cards' printed text still mentions "lower Impact".
6. **"Most / least tricks" goals** still count when you're tied. "Most" goals and the Tourist's "only objective regions" goal need at least 1 trick won.
7. **Fisherman/Hunter endings** compare Native vs Invasive **Water/Land** cards in their scoring pile.
8. **Setup:** the Ecology deck is dealt evenly and any leftover cards are discarded. Seating (turn order) is random. Players then **choose their roles in turn order** after seeing their hand, and roles are **public**. Both are changes from the rulebook's secret, randomly dealt roles. The rulebook's "1 impact card" at setup is skipped because no such card exists in the art.
9. `NGOpenWaterss.png` is treated as a third Northern Gulf biome. It looks like a duplicate file name, so you may want to rename it.

Every rule is in **game.js**, and all card stats are in **public/data.js**. Both have plain comments, so changes are easy.

## What's in this folder

| File | What it does |
|---|---|
| `start.bat` | Double-click to run the game on Windows |
| `server.js` | The multiplayer server: rooms, live updates, bots taking turns |
| `game.js` | All the rules: tricks, populating, abilities, Invasive Crisis, scoring, bots |
| `accounts.js` | Player accounts: Google and guest sign-in, gamertags, profile pictures, Eco-bucks, buy-ins and payouts, the store |
| `storage.js` | Where account data is kept: Upstash Redis when its settings are present, otherwise a local file |
| `test/storage.js` | Checks that accounts survive a restart with Upstash (uses a pretend Upstash, no internet needed) |
| `test/economy.js` | Checks payouts, ties, co-op, refunds, the store, unlocks and Google sign-in checking (uses a throwaway folder) |
| `public/assets/avatars/` | Profile pictures: character headshots (`char_*.png`) and animal card art (`animal_*.png`) |
| `endings.js` | The story endings: good and grim variants for every role, plus the Anaconda's epilogues |
| `test/endings.js` | Plays 1,500 bot games and checks every ending, then shows how often each variant comes up |
| `public/data.js` | Every card's stats, the regions, adjacency and roles |
| `public/client.js`, `style.css`, `index.html` | What players see in the browser |
| `public/music.js` | The title theme: an original chiptune written as notes and chords, played by a small synthesizer |
| `public/assets/` | Your art. Biome cards are rotated to lie landscape. |
| `public/assets/landing-wide.png`, `landing-tall.png` | The pixel-art Everglades backdrop behind the home page and lobby (wide for computers, tall for phones), made with PixelLab. Shown as a still when the system's "reduce motion" setting is on |
| `public/scenery.js`, `public/assets/landing/` | The animated backdrop: the same painting with rippling, glinting water, fireflies, and the egrets and spoonbills flying across the sky. Every motion repeats a whole number of times in 48 seconds, so it loops seamlessly. The birds were removed from the painting (`*-plate.png`) and given PixelLab wingbeat animations (`bird-*.png`) |
| `public/assets/ecology-back.png`, `biome-back.png` | The card backs: the green Ecology Journal (gold egret) and the teal Travel Log (compass and map), made with PixelLab and lettered with the original cards' pixel font |
| `public/assets/characters/` | The animated character portraits: one 9-frame strip per animation, per role. Skins are in each role's `skins/` folder |
| `public/fonts/` | EGDigits, a custom blocky pixel font used for every number (0–9) so 2 and 5 are easy to tell apart |
| `tools/make_digits_font.py` | Rebuilds that font if you ever want to tweak a digit's pixels (needs Python + fontTools) |
| `tools/make_refcard.py` | Rewrites the Keystone line on the reference card using letters cut from the card itself |
| `test/coopsim.js` | Simulates co-op games at 1–6 players and prints win rates and score breakdowns |
| `tools/make_boss_card.py`, `tools/pixelfont.py` | Rebuild the Anaconda boss card (pixel lettering drawn in code) |
| `test/predatory.js` | Checks that Predatory cards hunt before their own tokens are added (including Done early, empty regions and the Great Barracuda) |
| `test/sim.js` | Plays 500 bot-only games (every 7th one co-op) to check the rules never get stuck and every character reaction is valid (`npm test`) |

Nothing needs to be installed except Node.js. The server only uses what comes with Node.

A note on fairness: hands are kept on the server and only sent to their owner, so players can't peek at each other's cards.
