const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let Pool = null;
try {
  ({ Pool } = require('pg'));
} catch {}

const BOT_TOKEN = process.env.BOT_TOKEN || '5078034194:AAGCfu2i-eWZvjcQ-1P2pjlPCuaryTo8nro';
const ADMIN_ID = String(process.env.ADMIN_ID || '5220076610');
const REFERRAL_REWARD_TON = Number(process.env.REFERRAL_REWARD_TON || 0.30);
const ADMIN_DISCOUNT_PERCENT = Number(process.env.ADMIN_DISCOUNT_PERCENT || 95);
const DATABASE_URL = process.env.DATABASE_URL || '';

const DATA_DIR = fs.existsSync('/tmp') && process.env.VERCEL
  ? path.join('/tmp', 'epic-gift-data')
  : path.join(process.cwd(), 'data');

const DB_PATH = path.join(DATA_DIR, 'db.json');

let pgPool = null;
let pgInitialized = false;

function hasPostgres() {
  return Boolean(DATABASE_URL && Pool);
}

function getPool() {
  if (!hasPostgres()) return null;
  if (!pgPool) {
    const needsSsl = !/localhost|127\.0\.0\.1/i.test(DATABASE_URL);
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: needsSsl ? { rejectUnauthorized: false } : false
    });
  }
  return pgPool;
}

async function initDatabase() {
  const pool = getPool();
  if (!pool || pgInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      ton_balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
      gram_balance BIGINT NOT NULL DEFAULT 0,
      referred_by TEXT,
      referrals_count INTEGER NOT NULL DEFAULT 0,
      inventory_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_free24_claim BIGINT NOT NULL DEFAULT 0,
      last_free_claim BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS referrals (
      ref_key TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      invited_id TEXT NOT NULL,
      reward_ton NUMERIC(18, 4) NOT NULL DEFAULT 0.30,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      title TEXT NOT NULL,
      delta_ton NUMERIC(18, 4) NOT NULL DEFAULT 0,
      delta_gram BIGINT NOT NULL DEFAULT 0,
      paid_stars INTEGER,
      official_stars INTEGER,
      invited_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS gifts_cache (
      cache_key TEXT PRIMARY KEY,
      updated_at BIGINT NOT NULL DEFAULT 0,
      gifts_json JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  pgInitialized = true;
}

function mapRowToUser(row) {
  return {
    id: String(row.id),
    username: row.username || '',
    tonBalance: Number(row.ton_balance || 0),
    gramBalance: Number(row.gram_balance || 0),
    referredBy: row.referred_by || null,
    referralsCount: Number(row.referrals_count || 0),
    inventory: Array.isArray(row.inventory_json) ? row.inventory_json : [],
    history: Array.isArray(row.history_json) ? row.history_json : [],
    lastFree24Claim: Number(row.last_free24_claim || 0),
    lastFreeClaim: Number(row.last_free_claim || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

function mapRowToTx(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    username: row.username || `User #${row.user_id}`,
    action: row.action,
    title: row.title,
    deltaTon: Number(row.delta_ton || 0),
    deltaGram: Number(row.delta_gram || 0),
    paidStars: row.paid_stars != null ? Number(row.paid_stars) : undefined,
    officialStars: row.official_stars != null ? Number(row.official_stars) : undefined,
    invitedUserId: row.invited_user_id || undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

// Atomic JSON fallback helpers when DATABASE_URL is not configured
function loadJsonDB() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_PATH)) {
      const initial = {
        users: {},
        referrals: {},
        transactions: [],
        giftsCache: { updatedAt: 0, gifts: [] }
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {
      users: {},
      referrals: {},
      transactions: [],
      giftsCache: { updatedAt: 0, gifts: [] }
    };
  }
}

function saveJsonDB(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function ensureJsonUser(db, userId, username = '') {
  const id = String(userId);
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username: username || '',
      tonBalance: 0,
      gramBalance: 0,
      referredBy: null,
      referralsCount: 0,
      inventory: [],
      history: [],
      lastFree24Claim: 0,
      lastFreeClaim: 0,
      createdAt: new Date().toISOString()
    };
  } else if (username) {
    db.users[id].username = username;
  }
  return db.users[id];
}

// Unified DB Operations (PostgreSQL transactional + JSON fallback)
async function dbEnsureUser(userId, username = '') {
  const id = String(userId);
  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, username) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET
         username = CASE WHEN EXCLUDED.username <> '' THEN EXCLUDED.username ELSE users.username END,
         updated_at = NOW()`,
      [id, username || '']
    );
    const res = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return mapRowToUser(res.rows[0]);
  }
  const db = loadJsonDB();
  const u = ensureJsonUser(db, id, username);
  saveJsonDB(db);
  return u;
}

async function dbGetLeaderboard(limit = 25) {
  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, username, ton_balance, gram_balance, referrals_count
       FROM users
       ORDER BY (ton_balance + gram_balance * 0.01) DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      username: r.username || `User #${r.id}`,
      tonBalance: Number(r.ton_balance || 0),
      gramBalance: Number(r.gram_balance || 0),
      referralsCount: Number(r.referrals_count || 0)
    }));
  }
  const db = loadJsonDB();
  return Object.values(db.users)
    .map((u) => ({
      id: u.id,
      username: u.username || `User #${u.id}`,
      tonBalance: Number(u.tonBalance || 0),
      gramBalance: Number(u.gramBalance || 0),
      referralsCount: Number(u.referralsCount || 0)
    }))
    .sort((a, b) => (b.tonBalance + b.gramBalance * 0.01) - (a.tonBalance + a.gramBalance * 0.01))
    .slice(0, limit);
}

async function dbGetRecentFeed(limit = 25) {
  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map(mapRowToTx);
  }
  const db = loadJsonDB();
  return (db.transactions || []).slice(0, limit);
}

async function dbApplyLedger({ callerId, username = '', action, deltaTon = 0, deltaGram = 0, title = 'Activity', meta = {}, targetUserId, setTon, setGram }) {
  const dTon = Number(deltaTon || 0);
  const dGram = Number(deltaGram || 0);

  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const actorId = String(callerId);
      await client.query(
        `INSERT INTO users (id, username) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET username = CASE WHEN EXCLUDED.username <> '' THEN EXCLUDED.username ELSE users.username END`,
        [actorId, username || '']
      );

      const isAdminAdjust = action === 'admin_adjust' && actorId === ADMIN_ID;
      const effectiveUserId = isAdminAdjust ? String(targetUserId || actorId) : actorId;

      if (isAdminAdjust && effectiveUserId !== actorId) {
        await client.query(
          `INSERT INTO users (id, username) VALUES ($1, '') ON CONFLICT (id) DO NOTHING`,
          [effectiveUserId]
        );
      }

      const curRes = await client.query(
        `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
        [effectiveUserId]
      );
      const current = mapRowToUser(curRes.rows[0]);

      let nextTon;
      let nextGram;
      if (isAdminAdjust) {
        nextTon = typeof setTon === 'number' && !Number.isNaN(setTon)
          ? Math.max(0, Number(setTon.toFixed(4)))
          : Math.max(0, Number((current.tonBalance + dTon).toFixed(4)));
        nextGram = typeof setGram === 'number' && !Number.isNaN(setGram)
          ? Math.max(0, Math.round(setGram))
          : Math.max(0, Math.round(current.gramBalance + dGram));
      } else {
        nextTon = Number((current.tonBalance + dTon).toFixed(4));
        nextGram = Math.round(current.gramBalance + dGram);
        if (nextTon < 0 || nextGram < 0) {
          await client.query('ROLLBACK');
          return { ok: false, status: 400, error: 'الرصيد غير كافٍ لإتمام العملية' };
        }
      }

      let nextInventory = [...current.inventory];
      if (meta?.inventoryItem) nextInventory.unshift(meta.inventoryItem);
      if (meta?.removeInventoryId) {
        nextInventory = nextInventory.filter((item) => item.id !== meta.removeInventoryId);
      }

      const tx = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId: effectiveUserId,
        username: current.username || username || `User #${effectiveUserId}`,
        action: action || 'ledger_update',
        title: title || 'Balance Update',
        deltaTon: dTon,
        deltaGram: dGram,
        createdAt: new Date().toISOString()
      };

      const nextHistory = [tx, ...current.history].slice(0, 100);
      const lastFree24 = action === 'claim_free24' ? Date.now() : current.lastFree24Claim;
      const lastFree = action === 'claim_free' ? Date.now() : current.lastFreeClaim;

      await client.query(
        `UPDATE users SET
           ton_balance = $1,
           gram_balance = $2,
           inventory_json = $3::jsonb,
           history_json = $4::jsonb,
           last_free24_claim = $5,
           last_free_claim = $6,
           updated_at = NOW()
         WHERE id = $7`,
        [nextTon, nextGram, JSON.stringify(nextInventory), JSON.stringify(nextHistory), lastFree24, lastFree, effectiveUserId]
      );

      await client.query(
        `INSERT INTO transactions (id, user_id, username, action, title, delta_ton, delta_gram, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [tx.id, tx.userId, tx.username, tx.action, tx.title, tx.deltaTon, tx.deltaGram, tx.createdAt]
      );

      await client.query('COMMIT');
      const updatedRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [effectiveUserId]);
      return { ok: true, status: 200, user: mapRowToUser(updatedRes.rows[0]), tx };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const db = loadJsonDB();
  const actor = ensureJsonUser(db, callerId, username);
  const isAdminAdjust = action === 'admin_adjust' && String(actor.id) === ADMIN_ID;
  const target = isAdminAdjust ? ensureJsonUser(db, targetUserId || actor.id) : actor;

  let nextTon;
  let nextGram;
  if (isAdminAdjust) {
    nextTon = typeof setTon === 'number' && !Number.isNaN(setTon)
      ? Math.max(0, Number(setTon.toFixed(4)))
      : Math.max(0, Number((target.tonBalance + dTon).toFixed(4)));
    nextGram = typeof setGram === 'number' && !Number.isNaN(setGram)
      ? Math.max(0, Math.round(setGram))
      : Math.max(0, Math.round(target.gramBalance + dGram));
  } else {
    nextTon = Number((target.tonBalance + dTon).toFixed(4));
    nextGram = Math.round(target.gramBalance + dGram);
    if (nextTon < 0 || nextGram < 0) {
      return { ok: false, status: 400, error: 'الرصيد غير كافٍ لإتمام العملية' };
    }
  }

  target.tonBalance = nextTon;
  target.gramBalance = nextGram;
  if (action === 'claim_free24') target.lastFree24Claim = Date.now();
  if (action === 'claim_free') target.lastFreeClaim = Date.now();
  if (meta?.inventoryItem) target.inventory.unshift(meta.inventoryItem);
  if (meta?.removeInventoryId) {
    target.inventory = target.inventory.filter((item) => item.id !== meta.removeInventoryId);
  }

  const tx = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: target.id,
    username: target.username || `User #${target.id}`,
    action: action || 'ledger_update',
    title: title || 'Balance Update',
    deltaTon: dTon,
    deltaGram: dGram,
    createdAt: new Date().toISOString()
  };

  target.history.unshift(tx);
  if (target.history.length > 100) target.history.length = 100;
  db.transactions.unshift(tx);
  if (db.transactions.length > 200) db.transactions.length = 200;
  saveJsonDB(db);

  return { ok: true, status: 200, user: target, tx };
}

async function dbClaimReferral({ inviterId, invitedId, invitedUsername = '' }) {
  const refKey = `${inviterId}->${invitedId}`;
  const nowIso = new Date().toISOString();

  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(`SELECT ref_key FROM referrals WHERE ref_key = $1`, [refKey]);
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, error: 'تم احتساب مكافأة 0.30 TON لهذه الإحالة مسبقاً' };
      }

      await client.query(
        `INSERT INTO users (id, username) VALUES ($1, '') ON CONFLICT (id) DO NOTHING`,
        [inviterId]
      );
      await client.query(
        `INSERT INTO users (id, username) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET username = CASE WHEN EXCLUDED.username <> '' THEN EXCLUDED.username ELSE users.username END`,
        [invitedId, invitedUsername || '']
      );

      const inviterRes = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [inviterId]);
      const inviterRow = inviterRes.rows[0];
      const nextInviterTon = Number((Number(inviterRow.ton_balance || 0) + REFERRAL_REWARD_TON).toFixed(4));
      const nextInviterRefs = Number(inviterRow.referrals_count || 0) + 1;

      const tx = {
        id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: inviterId,
        username: inviterRow.username || `User #${inviterId}`,
        action: 'referral_reward',
        title: `Referral +${REFERRAL_REWARD_TON.toFixed(2)} TON`,
        deltaTon: REFERRAL_REWARD_TON,
        deltaGram: 0,
        invitedUserId: invitedId,
        createdAt: nowIso
      };

      const inviterHistory = [tx, ...(Array.isArray(inviterRow.history_json) ? inviterRow.history_json : [])].slice(0, 100);

      await client.query(
        `UPDATE users SET ton_balance = $1, referrals_count = $2, history_json = $3::jsonb, updated_at = NOW() WHERE id = $4`,
        [nextInviterTon, nextInviterRefs, JSON.stringify(inviterHistory), inviterId]
      );

      await client.query(
        `UPDATE users SET referred_by = COALESCE(referred_by, $1), updated_at = NOW() WHERE id = $2`,
        [inviterId, invitedId]
      );

      await client.query(
        `INSERT INTO referrals (ref_key, inviter_id, invited_id, reward_ton, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [refKey, inviterId, invitedId, REFERRAL_REWARD_TON, nowIso]
      );

      await client.query(
        `INSERT INTO transactions (id, user_id, username, action, title, delta_ton, delta_gram, invited_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
        [tx.id, tx.userId, tx.username, tx.action, tx.title, tx.deltaTon, tx.deltaGram, tx.invitedUserId, tx.createdAt]
      );

      await client.query('COMMIT');
      const invitedRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [invitedId]);
      return {
        ok: true,
        status: 200,
        rewardTon: REFERRAL_REWARD_TON,
        inviterId,
        inviterBalance: nextInviterTon,
        referralsCount: nextInviterRefs,
        currentUser: mapRowToUser(invitedRes.rows[0])
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const db = loadJsonDB();
  if (db.referrals[refKey]) {
    return { ok: false, status: 409, error: 'تم احتساب مكافأة 0.30 TON لهذه الإحالة مسبقاً' };
  }

  const inviter = ensureJsonUser(db, inviterId);
  const invited = ensureJsonUser(db, invitedId, invitedUsername);

  inviter.tonBalance = Number((inviter.tonBalance + REFERRAL_REWARD_TON).toFixed(4));
  inviter.referralsCount = Number(inviter.referralsCount || 0) + 1;

  const tx = {
    id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: inviter.id,
    username: inviter.username || `User #${inviter.id}`,
    action: 'referral_reward',
    title: `Referral +${REFERRAL_REWARD_TON.toFixed(2)} TON`,
    deltaTon: REFERRAL_REWARD_TON,
    deltaGram: 0,
    invitedUserId: invited.id,
    createdAt: nowIso
  };

  inviter.history.unshift(tx);
  db.transactions.unshift(tx);
  if (db.transactions.length > 200) db.transactions.length = 200;
  if (!invited.referredBy) invited.referredBy = inviter.id;

  db.referrals[refKey] = {
    inviterId: inviter.id,
    invitedId: invited.id,
    rewardTon: REFERRAL_REWARD_TON,
    createdAt: nowIso
  };

  saveJsonDB(db);
  return {
    ok: true,
    status: 200,
    rewardTon: REFERRAL_REWARD_TON,
    inviterId: inviter.id,
    inviterBalance: inviter.tonBalance,
    referralsCount: inviter.referralsCount,
    currentUser: invited
  };
}

async function dbGetGiftsCache() {
  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    const res = await pool.query(`SELECT updated_at, gifts_json FROM gifts_cache WHERE cache_key = 'default'`);
    if (!res.rows.length) return { updatedAt: 0, gifts: [] };
    return {
      updatedAt: Number(res.rows[0].updated_at || 0),
      gifts: Array.isArray(res.rows[0].gifts_json) ? res.rows[0].gifts_json : []
    };
  }
  const db = loadJsonDB();
  return db.giftsCache || { updatedAt: 0, gifts: [] };
}

async function dbSetGiftsCache(giftsCache) {
  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    await pool.query(
      `INSERT INTO gifts_cache (cache_key, updated_at, gifts_json)
       VALUES ('default', $1, $2::jsonb)
       ON CONFLICT (cache_key) DO UPDATE SET updated_at = EXCLUDED.updated_at, gifts_json = EXCLUDED.gifts_json`,
      [Number(giftsCache.updatedAt || Date.now()), JSON.stringify(giftsCache.gifts || [])]
    );
    return;
  }
  const db = loadJsonDB();
  db.giftsCache = giftsCache;
  saveJsonDB(db);
}

async function dbRecordGiftPurchase({ userId, username = '', item, tx }) {
  if (hasPostgres()) {
    await initDatabase();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users (id, username) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET username = CASE WHEN EXCLUDED.username <> '' THEN EXCLUDED.username ELSE users.username END`,
        [userId, username || '']
      );
      const curRes = await client.query(`SELECT * FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const current = mapRowToUser(curRes.rows[0]);
      const nextInventory = [item, ...current.inventory];
      const nextHistory = [tx, ...current.history].slice(0, 100);

      await client.query(
        `UPDATE users SET inventory_json = $1::jsonb, history_json = $2::jsonb, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(nextInventory), JSON.stringify(nextHistory), userId]
      );

      await client.query(
        `INSERT INTO transactions (id, user_id, username, action, title, delta_ton, delta_gram, paid_stars, official_stars, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
        [tx.id, tx.userId, tx.username, tx.action, tx.title, tx.deltaTon, tx.deltaGram, tx.paidStars ?? null, tx.officialStars ?? null, tx.createdAt]
      );

      await client.query('COMMIT');
      const updatedRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
      return mapRowToUser(updatedRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const db = loadJsonDB();
  const user = ensureJsonUser(db, userId, username);
  user.inventory.unshift(item);
  user.history.unshift(tx);
  if (user.history.length > 100) user.history.length = 100;
  db.transactions.unshift(tx);
  if (db.transactions.length > 200) db.transactions.length = 200;
  saveJsonDB(db);
  return user;
}

function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const checkString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(computed, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

function resolveUser(req) {
  const body = req.body || {};
  const headers = req.headers || {};
  const initData = headers['x-telegram-init-data'] || body.initData || '';
  const verified = verifyTelegramInitData(initData);
  if (verified && verified.id) {
    return {
      id: String(verified.id),
      username: verified.username || '',
      firstName: verified.first_name || '',
      verified: true
    };
  }
  const fallbackId = headers['x-user-id'] || body.userId || req.query?.userId;
  if (fallbackId) {
    return {
      id: String(fallbackId).trim(),
      username: body.username || '',
      firstName: body.firstName || '',
      verified: false
    };
  }
  return null;
}

async function callTelegramAPI(method, payload = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data.description || `Telegram API error on ${method}`);
  }
  return data.result;
}

function calcEffectiveStars(originalStars, userId) {
  const base = Math.max(1, Number(originalStars) || 0);
  if (String(userId) === ADMIN_ID) {
    const factor = Math.max(0, (100 - ADMIN_DISCOUNT_PERCENT) / 100);
    return Math.max(1, Math.round(base * factor));
  }
  return base;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-telegram-init-data,x-user-id');
}

module.exports = {
  BOT_TOKEN,
  ADMIN_ID,
  REFERRAL_REWARD_TON,
  ADMIN_DISCOUNT_PERCENT,
  hasPostgres,
  initDatabase,
  dbEnsureUser,
  dbGetLeaderboard,
  dbGetRecentFeed,
  dbApplyLedger,
  dbClaimReferral,
  dbGetGiftsCache,
  dbSetGiftsCache,
  dbRecordGiftPurchase,
  verifyTelegramInitData,
  resolveUser,
  callTelegramAPI,
  calcEffectiveStars,
  setCors
};
