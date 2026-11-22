const { dbEnsureUser, dbGetGiftsCache, resolveUser, callTelegramAPI, calcEffectiveStars, ADMIN_ID, ADMIN_DISCOUNT_PERCENT, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const userInfo = resolveUser(req);
  if (!userInfo) return res.status(401).json({ ok: false, error: 'تعذر التحقق من هوية المستخدم' });

  const { giftId, title, starCount, targetUserId } = req.body || {};
  if (!giftId || !starCount) {
    return res.status(400).json({ ok: false, error: 'بيانات الهدية غير مكتملة' });
  }

  try {
    const user = await dbEnsureUser(userInfo.id, userInfo.username);
    const cache = await dbGetGiftsCache();
    const catalogGift = (cache.gifts || []).find((g) => String(g.id) === String(giftId));
    const officialStars = catalogGift ? Number(catalogGift.star_count) : Number(starCount);
    const finalStars = calcEffectiveStars(officialStars, user.id);
    const isAdmin = String(user.id) === ADMIN_ID;

    const invoiceLink = await callTelegramAPI('createInvoiceLink', {{
      title: title || catalogGift?.title || `Gift #${{giftId}}`,
      description: isAdmin
        ? `Admin Special (${{100 - ADMIN_DISCOUNT_PERCENT}}% of price / ${{ADMIN_DISCOUNT_PERCENT}}% OFF)`
        : 'Telegram Stars Gift Purchase',
      payload: JSON.stringify({{
        giftId: String(giftId),
        buyerId: String(user.id),
        targetUserId: String(targetUserId || user.id),
        officialStars,
        finalStars
      }}),
      currency: 'XTR',
      prices: [{{ label: title || `Gift #${{giftId}}`, amount: finalStars }}]
    }});

    return res.status(200).json({
      ok: true,
      invoiceLink,
      officialStars,
      finalStars,
      discountApplied: isAdmin ? ADMIN_DISCOUNT_PERCENT : 0
    });
  }} catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }}
};
