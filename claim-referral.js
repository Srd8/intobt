const { dbClaimReferral, resolveUser, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const userInfo = resolveUser(req);
  if (!userInfo) return res.status(401).json({ ok: false, error: 'Unauthorized user' });

  const { referrerId, referredUserId, refCode } = req.body || {};
  const rawRef = String(referrerId || refCode || '').replace(/^ref_/i, '').trim();
  const invitedId = String(referredUserId || userInfo.id).trim();

  if (!rawRef) {
    return res.status(400).json({ ok: false, error: 'يرجى إدخال كود أو رابط إحالة صحيح' });
  }
  if (rawRef === invitedId) {
    return res.status(400).json({ ok: false, error: 'لا يمكنك استخدام رابط الإحالة الخاص بك' });
  }

  try {
    const result = await dbClaimReferral({
      inviterId: rawRef,
      invitedId,
      invitedUsername: userInfo.username
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
