const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'profiles.sqlite');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS profiles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 district INTEGER NOT NULL CHECK(district BETWEEN 0 AND 3),
 spend INTEGER NOT NULL CHECK(spend BETWEEN 0 AND 3),
 income INTEGER NOT NULL CHECK(income BETWEEN 0 AND 3),
 saving INTEGER NOT NULL CHECK(saving BETWEEN 0 AND 3),
 priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 3),
 planning INTEGER NOT NULL CHECK(planning BETWEEN 0 AND 3),
 delete_token_hash TEXT NOT NULL,
 consent_version TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname)));

const keys = ['district','spend','income','saving','priority','planning'];
const weights = { district: 1, spend: 2, income: 1, saving: 2, priority: 1, planning: 2 };
const selectAll = db.prepare('SELECT id,district,spend,income,saving,priority,planning FROM profiles WHERE id != ?');
const insertProfile = db.prepare(`INSERT INTO profiles (district,spend,income,saving,priority,planning,delete_token_hash,consent_version)
 VALUES (@district,@spend,@income,@saving,@priority,@planning,@delete_token_hash,@consent_version)`);
function similarity(a,b) {
  let total = 0, weightTotal = 0;
  for (const key of keys) {
    const w = weights[key];
    // Each answer has four ordered options. Same answer = 100%, 1 step apart = 66.7%, etc.
    const part = (1 - Math.abs(a[key] - b[key]) / 3) * 100;
    total += part * w; weightTotal += w;
  }
  return Math.round(total / weightTotal);
}
function validAnswers(a) {
  return a && typeof a === 'object' && keys.every(k => Number.isInteger(a[k]) && a[k] >= 0 && a[k] <= 3);
}
app.get('/api/health', (_req,res) => res.json({ ok: true, service: 'my-like-matching', consentVersion: '2026-10-01' }));
app.post('/api/profiles', (req,res) => {
  const { answers, consent } = req.body || {};
  if (consent !== true) return res.status(400).json({ error: 'ডেটা সংরক্ষণের সম্মতি আবশ্যক।' });
  if (!validAnswers(answers)) return res.status(400).json({ error: 'উত্তরগুলো অসম্পূর্ণ বা ভুল।' });
  // No name, phone, email, exact income, or IP address is stored.
  const deleteToken = crypto.randomBytes(32).toString('hex');
  const deleteTokenHash = crypto.createHash('sha256').update(deleteToken).digest('hex');
  const info = insertProfile.run({ ...answers, delete_token_hash: deleteTokenHash, consent_version: '2026-10-01' });
  const peers = selectAll.all(Number(info.lastInsertRowid));
  const similarities = peers.map(p => similarity(answers, p));
  const matchCount = similarities.filter(s => s >= 80).length;
  const averageSimilarity = similarities.length ? Math.round(similarities.reduce((sum,s)=>sum+s,0)/similarities.length) : null;
  res.status(201).json({
    profileId: Number(info.lastInsertRowid),
    deleteToken,
    comparedUsers: peers.length,
    matchCount,
    averageSimilarity,
    threshold: 80,
    message: peers.length ? 'তোমার উত্তর বাস্তব ব্যবহারকারীদের সঙ্গে তুলনা করা হয়েছে।' : 'প্রথম প্রোফাইল সংরক্ষিত হয়েছে; তুলনা করার মতো অন্য ব্যবহারকারী এখনো নেই।'
  });
});
app.delete('/api/profiles/me', (req,res) => {
  const token = req.get('x-delete-token');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'মুছে ফেলার টোকেন পাওয়া যায়নি।' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const result = db.prepare('DELETE FROM profiles WHERE delete_token_hash = ?').run(hash);
  if (!result.changes) return res.status(404).json({ error: 'প্রোফাইল পাওয়া যায়নি বা আগেই মুছে ফেলা হয়েছে।' });
  res.json({ ok: true, message: 'তোমার সংরক্ষিত উত্তর মুছে ফেলা হয়েছে।' });
});
app.get('/api/stats', (_req,res) => {
  const row = db.prepare('SELECT COUNT(*) AS total FROM profiles').get();
  res.json({ totalProfiles: row.total });
});
app.get('*', (req,res,next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint পাওয়া যায়নি।' });
  res.sendFile(path.join(__dirname,'index.html'));
});
app.listen(PORT, () => console.log(`আমার মতো মানুষ চালু হয়েছে: http://localhost:${PORT}`));
