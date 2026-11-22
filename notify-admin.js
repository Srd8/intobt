const { callTelegramAPI, ADMIN_ID, setCors } = require('./_lib');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { message, event, meta } = req.body || {};
  const text =
    message ||
    `🔔 <b>Epic Gift Event</b>\nEvent: <code>${{event || 'activity'}}</code>\nDetails: <code>${{JSON.stringify(meta || {{}}).slice(0, 1000)}}</code>`;

  try {
    await callTelegramAPI('sendMessage', {{
      chat_id: ADMIN_ID,
      text: String(text).slice(0, 3900),
      parse_mode: 'HTML'
    }});
    return res.status(200).json({ ok: true });
  }} catch (err) {{
    return res.status(500).json({ ok: false, error: err.message });
  }}
};
