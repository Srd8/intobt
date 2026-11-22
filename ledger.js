const { dbApplyLedger, resolveUser, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const userInfo = resolveUser(req);
  if (!userInfo) return res.status(401).json({ ok: false, error: 'Unauthorized user' });

  try {
    const { action, deltaTon = 0, deltaGram = 0, title = 'Activity', meta = {}, targetUserId, setTon, setGram } = req.body || {};
    const result = await dbApplyLedger({
      callerId: userInfo.id,
      username: userInfo.username,
      action,
      deltaTon,
      deltaGram,
      title,
      meta,
      targetUserId,
      setTon,
      setGram
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error });
    }
    return res.status(200).json({ ok: true, user: result.user, tx: result.tx });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
