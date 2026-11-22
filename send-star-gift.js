const { dbEnsureUser, dbGetGiftsCache, dbRecordGiftPurchase, resolveUser, callTelegramAPI, calcEffectiveStars, ADMIN_ID, ADMIN_DISCOUNT_PERCENT, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const userInfo = resolveUser(req);
  if (!userInfo) return res.status(401).json({ ok: false, error: 'تعذر التحقق من هوية المستخدم' });

  const { giftId, targetUserId, text, starCount, title } = req.body || {};
  const recipientId = Number(targetUserId || userInfo.id);
  if (!giftId || !recipientId) {
    return res.status(400).json({ ok: false, error: 'معرّف الهدية أو المستلم مطلوب' });
  }

  try {
    const user = await dbEnsureUser(userInfo.id, userInfo.username);
    const cache = await dbGetGiftsCache();
    const catalogGift = (cache.gifts || []).find((g) => String(g.id) === String(giftId));
    const officialStars = catalogGift ? Number(catalogGift.star_count) : Number(starCount || 0);
    const finalStars = calcEffectiveStars(officialStars, user.id);
    const isAdmin = String(user.id) === ADMIN_ID;

    let telegramSent = false;
    let telegramError = null;

    try {
      await callTelegramAPI('sendGift', {{
        user_id: recipientId,
        gift_id: String(giftId),
        ...(text ? {{ text: String(text).slice(0, 128) }} : {{}})
      }});
      telegramSent = true;
    }} catch (err) {{
      telegramError = err.message;
    }}

    const createdAt = new Date().toISOString();
    const item = {{
      id: `gift_${{Date.now()}}_${{Math.random().toString(36).slice(2, 6)}}`,
      giftId: String(giftId),
      title: title || catalogGift?.title || `Gift #${{giftId}}`,
      recipientId: String(recipientId),
      officialStars,
      paidStars: finalStars,
      discountApplied: isAdmin ? ADMIN_DISCOUNT_PERCENT : 0,
      telegramSent,
      telegramError,
      createdAt
    }};

    const tx = {{
      id: `tx_${{Date.now()}}_${{Math.random().toString(36).slice(2, 6)}}`,
      userId: user.id,
      username: user.username || `User #${{user.id}}`,
      action: 'star_gift_purchase',
      title: `${{item.title}} (${{finalStars}} ⭐)`,
      deltaTon: 0,
      deltaGram: 0,
      paidStars: finalStars,
      officialStars,
      createdAt
    }};

    const updatedUser = await dbRecordGiftPurchase({
      userId: user.id,
      username: user.username,
      item,
      tx
    });

    await callTelegramAPI('sendMessage', {{
      chat_id: ADMIN_ID,
      text:
        `🎁 <b>Star Gift Order</b>\n` +
        `Buyer ID: <code>${{user.id}}</code>\n` +
        `Recipient ID: <code>${{recipientId}}</code>\n` +
        `Gift: ${{item.title}}\n` +
        `Paid Stars: <b>${{finalStars}}</b> (Official: ${{officialStars}})${{isAdmin ? ` [${{ADMIN_DISCOUNT_PERCENT}}% OFF]` : ''}}\n` +
        `Bot sendGift status: ${{telegramSent ? 'Sent' : `Pending/Bot Stars (${{telegramError || 'check bot stars'}})`}}`,
      parse_mode: 'HTML'
    }}).catch(() => {{}});

    return res.status(200).json({
      ok: true,
      telegramSent,
      telegramError,
      gift: item,
      user: updatedUser
    });
  }} catch (err) {{
    return res.status(500).json({ ok: false, error: err.message });
  }}
}};
