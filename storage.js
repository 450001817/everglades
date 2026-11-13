// Everglades — where account data is kept between restarts.
//
// Two backends, picked automatically:
//  * Upstash Redis (recommended for hosting): set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
//    Survives restarts, redeploys and Render's free-tier sleep. Free tier is plenty for this game.
//    Talks to Upstash's REST API with plain fetch, so there is still nothing to install.
//  * A local JSON file (default): DATA_DIR/accounts.json. Fine on your own computer, but a host's
//    temporary disk (like Render's free tier) is wiped on every restart.
//
// The game keeps everything in memory while it runs; save() just mirrors changes to storage.
// The data is a set of tables, each a plain object of key -> value (see accounts.js `db`).
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- local file ----------
function fileStore(dir) {
  const file = path.join(dir, 'accounts.json');
  return {
    name: `file ${file}`,
    async load() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') console.error('Could not read accounts file:', e.message); return null; }
    },
    async save(db) { // written to a temp file then renamed, so a crash can't leave half a file
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(db));
      fs.renameSync(file + '.tmp', file);
    },
    saveSync(db) { this.save(db); },
  };
}

// ---------- Upstash Redis (REST) ----------
// Each table is one Redis hash ("eg:<table>") with one field per record, so a save only sends the
// records that changed since the last save (it compares against what was last written).
function upstashStore(url, token, prefix = 'eg:') {
  url = url.replace(/\/+$/, '');
  const call = async (pathname, body) => {
    const r = await fetch(url + pathname, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`Upstash ${r.status}: ${j && j.error ? j.error : 'request failed'}`);
    return j;
  };
  let saved = {}; // table -> { key: json } as last written
  return {
    name: `Upstash Redis (${new URL(url).host})`,
    async load(tables) {
      const res = await call('/pipeline', tables.map(t => ['HGETALL', prefix + t]));
      const db = {}; let any = false;
      res.forEach((r, i) => {
        if (r.error) throw new Error('Upstash: ' + r.error);
        const t = tables[i], flat = r.result || [];
        db[t] = {}; saved[t] = {};
        for (let k = 0; k < flat.length; k += 2) { db[t][flat[k]] = JSON.parse(flat[k + 1]); saved[t][flat[k]] = flat[k + 1]; any = true; }
      });
      return any ? db : null;
    },
    async save(db) {
      const cmds = [], next = {};
      for (const [t, rows] of Object.entries(db)) {
        const old = saved[t] || {}; next[t] = {};
        const set = [];
        for (const [k, v] of Object.entries(rows)) {
          const j = JSON.stringify(v); next[t][k] = j;
          if (old[k] !== j) set.push(k, j);
        }
        for (let i = 0; i < set.length; i += 200) cmds.push(['HSET', prefix + t, ...set.slice(i, i + 200)]);
        const gone = Object.keys(old).filter(k => !(k in rows));
        for (let i = 0; i < gone.length; i += 200) cmds.push(['HDEL', prefix + t, ...gone.slice(i, i + 200)]);
      }
      if (!cmds.length) return;
      const res = await call('/pipeline', cmds);
      const bad = res.find(r => r.error);
      if (bad) throw new Error('Upstash: ' + bad.error);
      saved = next;
    },
    saveSync() { /* network saves can't be synchronous; see flush() in accounts.js */ },
  };
}

function pickStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore(url, token, process.env.UPSTASH_PREFIX || 'eg:');
  return fileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
}

module.exports = { pickStore, fileStore, upstashStore };
