const { dbEnsureUser, dbGetLeaderboard, dbGetRecentFeed, resolveUser, ADMIN_ID, REFERRAL_REWARD_TON, ADMIN_DISCOUNT_PERCENT, hasPostgres, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userInfo = resolveUser(req);
  if (!userInfo) {
    return res.status(401).json({ ok: false, error: 'Missing user context' });
  }

  try {
    const user = await dbEnsureUser(userInfo.id, userInfo.username);
    const leaderboard = await dbGetLeaderboard(25);
    const recentFeed = await dbGetRecentFeed(25);
    const isAdmin = String(user.id) === ADMIN_ID;

    return res.status(200).json({
      ok: true,
      dbEngine: hasPostgres() ? 'postgresql' : 'local_json_fallback',
      user,
      isAdmin,
      adminId: ADMIN_ID,
      referralRewardTon: REFERRAL_REWARD_TON,
      adminDiscountPercent: ADMIN_DISCOUNT_PERCENT,
      leaderboard,
      recentFeed
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
