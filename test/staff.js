// Goblin Ink staff exclusives: only Google accounts whose email is in STAFF_EMAILS get them, nobody can buy them,
// and they never show up in the public store. Google sign-in is faked with a locally made signing key.
// Run: node test/staff.js
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
process.env.UPSTASH_REDIS_REST_URL = ''; process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-staff-'));
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.STAFF_EMAILS = ' Staff.Person@Example.com , other@example.com';
const A = require('../accounts.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// a pretend Google: our own RSA key, served as Google's public keys
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
global.fetch = async () => ({ ok: true, headers: { get: () => 'max-age=3600' }, json: async () => ({ keys: [jwk] }) });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(sub, email, verified = true) {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub, email, email_verified: verified, exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

(async () => {
  await A.ready;
  const EXCL = A.STORE.filter(i => i.exclusive).map(i => i.id);
  console.log('The items');
  ok(EXCL.length === 8, `8 staff exclusives (6 goblin skins, stink splash, title): ${EXCL.join(', ')}`);
  ok(!A.config().store.some(i => i.exclusive), 'none of them are in the public store list');

  console.log('Ordinary players');
  const regular = (await A.googleLogin(idToken('sub-regular', 'someone@example.com'))).account;
  ok(!regular.staff && !EXCL.some(id => regular.owned.includes(id)), 'a normal Google account gets nothing');
  ok(A.privateProfile(regular).exclusiveStore.length === 0, "and its store shows none of them");
  regular.balance = 1e6;
  for (const id of EXCL) { let err = ''; try { A.buy(regular, id); } catch (e) { err = e.message; } ok(/not in the store/.test(err), `can't buy ${id}`); }
  const unverified = (await A.googleLogin(idToken('sub-unverified', 'staff.person@example.com', false))).account;
  ok(!unverified.staff, 'a staff email that Google has not verified gets nothing');
  const guest = A.guestLogin(crypto.randomBytes(16).toString('hex')).account;
  ok(!guest.staff, 'guest accounts never get them');
  let err = ''; try { A.setProfile(regular, { skin: { role: 'Hunter', id: 'gob_hunter' } }); } catch (e) { err = e.message; }
  ok(/don't own/.test(err), "can't equip a goblin skin without owning it");
  err = ''; try { A.setProfile(regular, { splash: 'stink' }); } catch (e) { err = e.message; }
  ok(/don't own/.test(err), "can't use the stink cloud without owning it");
  err = ''; try { A.setProfile(regular, { title: 'title_goblin' }); } catch (e) { err = e.message; }
  ok(/don't own/.test(err), "can't wear the staff title without owning it");

  console.log('Staff account');
  const staff = (await A.googleLogin(idToken('sub-staff', 'staff.person@example.com'))).account;
  ok(staff.staff && EXCL.every(id => staff.owned.includes(id)), 'the listed email (any capitals) unlocks all 8');
  ok(staff.title === 'title_goblin' && staff.splash === 'stink', 'the title and stink cloud are switched on straight away');
  const pub = A.publicProfile(staff);
  ok(pub.titleName === 'Goblin Ink Game Staff' && pub.titleStyle === 'goblin' && pub.splash === 'stink', 'everyone else sees the green title and the stink cloud');
  A.setProfile(staff, { skin: { role: 'Hunter', id: 'gob_hunter' } });
  ok(A.skinFor(staff, 'Hunter') === 'gob_hunter', 'the goblin Hunter skin can be equipped and is what others see');
  ok(A.privateProfile(staff).unlocked.includes('skin:gob_hunter'), 'goblin profile pictures unlock too');
  ok(A.privateProfile(staff).exclusiveStore.length === 8, "the staff member's own store lists the exclusives");
  A.setProfile(staff, { title: null, splash: null });
  const again = (await A.googleLogin(idToken('sub-staff', 'staff.person@example.com'))).account;
  ok(again === staff && again.title === null && again.splash === null, 'signing in again keeps their own choices (no re-equipping)');
  ok(!JSON.stringify(staff).includes('example.com'), 'the email address is never saved on the account');
  staff.owned.push('foilall:green'); await A.googleLogin(idToken('sub-staff', 'staff.person@example.com'));
  ok(!staff.owned.includes('foilall:green'), 'the retired green foil is removed from a staff account at its next sign-in');

  console.log('Gifting Eco-bucks');
  let gerr = ''; try { A.giftByEmail(regular, 'friend@example.com', 500); } catch (e) { gerr = e.message; }
  ok(/Only Goblin Ink staff/.test(gerr), "ordinary players can't gift Eco-bucks");
  gerr = ''; try { A.giftByEmail(staff, 'not-an-email', 500); } catch (e) { gerr = e.message; }
  ok(/valid email/.test(gerr), 'a bad email address is refused');
  gerr = ''; try { A.giftByEmail(staff, 'friend@example.com', 0); } catch (e) { gerr = e.message; }
  ok(/between 1/.test(gerr), 'a zero gift is refused');
  A.giftByEmail(staff, ' Friend@Example.com ', 500);
  await A.flush();
  const saved = fs.readdirSync(process.env.DATA_DIR).map(f => fs.readFileSync(path.join(process.env.DATA_DIR, f), 'utf8')).join('');
  ok(!/friend@example\.com/i.test(saved), "the gift is saved without the person's email address");
  const friend = (await A.googleLogin(idToken('sub-friend', 'friend@example.com'))).account;
  ok(friend.balance === A.ECON.startingBalance + 500, 'the gift is paid when that Google account signs in (a brand-new account here)');
  const friend2 = await A.googleLogin(idToken('sub-friend', 'friend@example.com'));
  ok(friend2.gift === 0 && friend.balance === A.ECON.startingBalance + 500, 'and only once');
  A.giftByEmail(staff, 'older@example.com', 250); A.giftByEmail(staff, 'older@example.com', 250);
  const older = (await A.googleLogin(idToken('sub-older', 'older@example.com', false))).account;
  ok(older.balance === A.ECON.startingBalance, 'an unverified email does not collect a gift');
  const older2 = await A.googleLogin(idToken('sub-older', 'older@example.com'));
  ok(older2.gift === 500, 'two gifts to the same email add up (250 + 250)');

  console.log(fails ? `\n${fails} staff check(s) FAILED.` : '\nAll staff checks passed.');
  process.exit(fails ? 1 : 0);
})();
