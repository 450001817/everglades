// Everglades — free-text chat: cleaning and filtering messages, and send-rate limits.
// Used by server.js (table and team chat) and accounts.js (DMs between friends).
//  * Messages are trimmed, control characters dropped, whitespace collapsed, and cut to MAX_LEN characters.
//  * Links are refused (players can be as young as 13; see terms.html).
//  * Profanity and slurs are masked with asterisks. Words are compared after undoing common disguises
//    (leetspeak like 5h1t, repeated letters like fuuuck, and dots or dashes between letters).
//  * Each sender may send at most RATE.burst messages per RATE.windowMs, and not faster than RATE.gapMs apart.
'use strict';

const MAX_LEN = 200;
const RATE = { gapMs: 600, burst: 5, windowMs: 8000 };
const userErr = msg => Object.assign(new Error(msg), { userError: true });

// Masked anywhere inside a word (strong words and slurs; nothing harmless contains these).
const ROOTS = ['fuck', 'fuk', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'motherf', 'bitch', 'whore', 'pussy', 'dickhead',
  'asshole', 'bullshit', 'wanker', 'retard', 'kike', 'tranny', 'rapist', 'cocksuck', 'jizz', 'slut'];
// Masked only as a whole word (they appear inside ordinary words: "class", "peacock", "spicy", "Dickens"...).
const WORDS = ['ass', 'asses', 'arse', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'spic', 'chink', 'gook', 'twat',
  'piss', 'pissed', 'bastard', 'bastards', 'cum', 'tits', 'titties', 'boob', 'boobs', 'penis', 'vagina', 'porn', 'rape',
  'raped', 'nazi', 'kys', 'stfu', 'wtf', 'dyke', 'homo', 'coon', 'wetback', 'beaner', 'negro'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
const collapse = w => w.replace(/(.)\1+/g, '$1'); // fuuuck -> fuck
// punctuation at either end is just punctuation ("ass!" must not read as "assi")
const norm = w => collapse([...w.toLowerCase().replace(/^[!|.+*_-]+|[!|.+*_-]+$/g, '')].map(ch => LEET[ch] || ch).join('').replace(/[^a-z]/g, ''));
const ROOTS_N = ROOTS.map(collapse), WORDS_N = new Set(WORDS.map(collapse));
// ordinary words that happen to contain a root above
const ALLOW = new Set(['scunthorpe', 'shitake', 'shiitake', 'therapist', 'therapists', 'pussycat', 'pussycats', 'pussywillow',
  'pussywillows', 'retardant', 'retardants', 'fukushima', 'cockatoo', 'cockatoos', 'cockatiel', 'cockroach', 'cockroaches'].map(collapse));
const isBad = word => { const n = norm(word); return !!n && !ALLOW.has(n) && (WORDS_N.has(n) || ROOTS_N.some(r => n.includes(r))); };

// links: a scheme, www., or anything that looks like a domain name
const LINK = /(\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(com|net|org|gg|io|co|uk|us|xyz|ly|me|tv|app|dev|link|info|site|live|online|ru|de)\b)/i;

// control characters, zero-width and direction-changing characters (they can hide or reorder text)
const INVISIBLE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + String.fromCharCode(0x7f) + '-' + String.fromCharCode(0x9f) + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0x2028) + '-' + String.fromCharCode(0x202e) + String.fromCharCode(0x2060) + '-' + String.fromCharCode(0x206f) + String.fromCharCode(0xfeff) + ']', 'g');

// Returns the message as it will be shown, or throws a userError explaining why it can't be sent.
function clean(raw) {
  let t = String(raw == null ? '' : raw).replace(INVISIBLE, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) throw userErr('Type a message first.');
  if (t.length > MAX_LEN) t = t.slice(0, MAX_LEN).trim();
  if (LINK.test(t)) throw userErr("Links can't be sent in chat.");
  // a "word" here also swallows disguises inside it: f.u.c.k, sh!t, a$$
  t = t.replace(/[\p{L}\p{N}@$!|+*._-]+/gu, w => {
    if (isBad(w)) return w.replace(/[^\s]/g, '*');
    const parts = w.split(/[._-]+/); // "you.ass" etc: check the pieces too
    if (parts.length > 1 && parts.some(isBad)) return parts.map(p => (isBad(p) ? p.replace(/./g, '*') : p)).join('.');
    return w;
  });
  return t;
}

// Per-sender send limits. state: any object kept for that sender (it gets a `sent` list of times).
function rateCheck(state, now = Date.now()) {
  const sent = (state.sent || []).filter(t => now - t < RATE.windowMs);
  if (sent.length && now - sent[sent.length - 1] < RATE.gapMs) throw userErr('Slow down a little!');
  if (sent.length >= RATE.burst) throw userErr('Slow down a little! Wait a few seconds before sending more.');
  sent.push(now); state.sent = sent;
}

module.exports = { clean, rateCheck, isBad, MAX_LEN, RATE };
