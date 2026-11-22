const { callTelegramAPI, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const update = req.body || {{}};

  try {
    if (update.pre_checkout_query) {{
      await callTelegramAPI('answerPreCheckoutQuery', {{
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true
      }});
      return res.status(200).json({ ok: true });
    }}

    if (update.message?.successful_payment) {{
      const payment = update.message.successful_payment;
      let payload = {{}};
      try {{
        payload = JSON.parse(payment.invoice_payload || '{{}}');
      }} catch {{}}

      if (payload.giftId && payload.targetUserId) {{
        await callTelegramAPI('sendGift', {{
          user_id: Number(payload.targetUserId),
          gift_id: String(payload.giftId)
        }}).catch(() => {{}});
      }}
    }}

    return res.status(200).json({ ok: true });
  }} catch (err) {{
    return res.status(500).json({ ok: false, error: err.message });
  }}
};
