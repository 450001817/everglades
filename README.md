# Everglades: Online Multiplayer

A website version of your Everglades trick-taking game. It uses your own card and board art. Friends join from their browsers with a 4-letter room code, and bots fill any empty seats so every game has at least 4 players. The look matches your retro pixel art, and every sound is generated in the browser, so there are no audio files. Co-op mode (The Anaconda) is not included.

## Play it on your computer (about 2 minutes)

1. Install **Node.js** (the "LTS" version) from https://nodejs.org. You only do this once.
2. Double-click **start.bat** in this folder. A black window opens, and your browser opens to the game.
3. Type your name, click **Start a new table**, and share the room code or link.
4. Click **Start game**. Bots fill the table up to 4 players. The host can add more bots, up to 6 players.

Keep the black window open while you play. Closing it stops the game.

**Friends on the same Wi-Fi:** the black window shows a "Same Wi-Fi friends" address, like `http://192.168.1.20:3000`. Send them that address. Windows may ask whether Node can use the network; click Allow.

**Friends anywhere on the internet:** the game has to run on a hosting service. The simplest option is Render (render.com, free tier):
1. Put this folder in a GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Set the Build Command to `npm install` and the Start Command to `npm start`.
4. Render gives you a link you can share with anyone.

The free tier sleeps when no one is using it, so the first visit can take about 30 seconds.

## How a turn works on screen

The whole game fits on one screen with no page scrolling. From left to right: the players list, the map, and the play area. Your hand runs along the bottom. The play area changes with the moment:

- **While a biome is being picked**, the Travel Row fills the play area with big cards, and the last trick shows small underneath.
- **Once a biome is chosen**, the Travel Row shrinks to a small strip at the bottom. The current biome and the cards played to it take over the play area.
- **Field notes** (the game log) is a drop-down in the top bar, next to the sound and Rules buttons. A red number shows how many new notes arrived since you last looked.

- **Role draft:** after the host starts, everyone's hand is dealt and players choose roles one at a time in turn order. The first player picks first, and taken roles are stamped with the owner's name. Bots pick when their turn comes. The first round starts once everyone has a role.
- **Read any card:** hover over it for 1 second (on a phone, press and hold). This works everywhere: your hand, the travel row, played cards, role cards and the end screen.
- **Lead player:** when it's your pick, the travel row glows and each biome says TRAVEL HERE. Click one.
- **On your turn:** cards you can't legally play are greyed out. Click a card to select it, then click it again (or click Play).
- **Your role ability** (start of turn) appears as a gold button next to Play. If you try to play a card while it's unused and would actually do something, an **"Use your ability first?"** pop-up explains what you'd miss. Choose **Use ability first**, **Play anyway**, or tick **Don't warn me again this game**.
- **Red warning signs** appear over Invasive cards in your hand whose Impact is above the current Invasive Risk. Those cards can't win the trick, though they still populate. The signs update if a Keystone card changes the Risk.
- **Migratory:** click the glowing regions on the map to place each token. The tokens have to form a continuous line.
- **Predatory:** click the blinking green or red counters on the map to remove Native or Invasive tokens, then click Done.
- **Population** shows two ways: a counter under each region name, plus small green (Native) and red (Invasive) squares that drop in and spread across the region.
- **Roles are public.** Everyone's role shows in the Players list; hover a player to read their role card.
- **Sound:** retro 8-bit effects for playing cards, travelling, placing and removing tokens, your turn, winning a trick, Invasive Crisis and game end. Use the ♪ button in the top bar to turn it off.
- **At the end**, everyone sees the scores, and the winner's role-card back is shown with their ending highlighted.

The layout is built for laptop and desktop screens (1024×768 and up). It also fits on a phone held upright, but everything is small there.

## Rule decisions I made (please check these)

Your rulebook (Everglades 2.0), the reference card and the printed cards disagree in a few places. The game follows the **printed cards and reference card**, because they're the newest.

1. **Invasive cards** match the lead suit when their Impact is **at or below the current Invasive Risk**. A **Keystone** card changes the Risk to its own Impact for the rest of the trick. This comes from the reference card. The rulebook's "risk plus invasive tokens in the region" version is not used.
2. **If nobody plays a matching card**, the highest-Impact card wins anyway. This is a house rule, because the rules don't cover it. It came up in about 9% of tricks in simulated games.
3. **Ties:** an Invasive card beats a Native card with the same Impact. Otherwise the card played first wins.
4. **Predatory** removes up to X tokens, and you always choose between **Native and Invasive** tokens in any region the card just populated, including the tokens that just arrived.
5. **Fisherman/Hunter swap:** the scoring-pile card has to be a Water/Land card (Native or Invasive) with **lower Impact than the hand card** you give up.
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
| `public/data.js` | Every card's stats, the regions, adjacency and roles |
| `public/client.js`, `style.css`, `index.html` | What players see in the browser |
| `public/assets/` | Your art. Biome cards are rotated to lie landscape. |
| `public/fonts/` | EGDigits, a custom blocky pixel font used for every number (0–9) so 2 and 5 are easy to tell apart |
| `tools/make_digits_font.py` | Rebuilds that font if you ever want to tweak a digit's pixels (needs Python + fontTools) |
| `test/sim.js` | Plays 500 bot-only games to check the rules never get stuck (`npm test`) |

Nothing needs to be installed except Node.js. The server only uses what comes with Node.

A note on fairness: hands are kept on the server and only sent to their owner, so players can't peek at each other's cards.
