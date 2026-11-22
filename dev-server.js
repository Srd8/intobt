require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const sessionHandler = require('./api/session');
const ledgerHandler = require('./api/ledger');
const referralHandler = require('./api/claim-referral');
const giftsHandler = require('./api/telegram-gifts');
const invoiceHandler = require('./api/stars-invoice');
const sendGiftHandler = require('./api/send-star-gift');
const notifyAdminHandler = require('./api/notify-admin');
const webhookHandler = require('./api/telegram-webhook');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.all('/api/session', sessionHandler);
app.all('/api/ledger', ledgerHandler);
app.all('/api/claim-referral', referralHandler);
app.all('/api/telegram-gifts', giftsHandler);
app.all('/api/stars-invoice', invoiceHandler);
app.all('/api/send-star-gift', sendGiftHandler);
app.all('/api/notify-admin', notifyAdminHandler);
app.all('/api/telegram-webhook', webhookHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Epic Gift Server running at http://localhost:${PORT}`);
});
