const path = require('path');
const fs = require('fs');
const { getDb } = require('../models/db');

const CAMPAIGNS_PATH = path.join(__dirname, '..', 'data', 'donation_campaigns.json');

function loadCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_PATH)) return { campaigns: [] };
  try {
    const raw = fs.readFileSync(CAMPAIGNS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Failed to load campaigns: ' + e.message);
  }
}

function formatCurrency(v) {
  return Number(v || 0).toFixed(2);
}

function getCampaigns() {
  const data = loadCampaigns();
  const db = getDb();
  const out = (data.campaigns || []).map(c => {
    // Sum completed sponsorships for this campaign (matching target_identifier)
    const stmt = db.prepare(`SELECT COALESCE(SUM(amount_usd),0) AS total FROM sponsorships WHERE target_identifier = ? AND status = 'completed'`);
    const row = stmt.get(c.id);
    const total = row ? Number(row.total) : 0;
    const target = Number(c.target_amount_usd || 0);
    const percent = target > 0 ? Math.min(100, Math.floor((total / target) * 100)) : 0;
    return Object.assign({}, c, {
      collected_usd: formatCurrency(total),
      target_amount_usd: formatCurrency(target),
      percent_complete: percent
    });
  });
  return out;
}

module.exports = { getCampaigns };
