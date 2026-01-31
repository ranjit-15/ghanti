const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, 'counts.json');
let data = { count: 0, users: {} };
if (fs.existsSync(DATA_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE)); } catch (e) { console.warn('Could not parse counts.json, starting fresh'); }
}
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

const app = express();
app.use(express.json());
app.use(cookieParser());

// serve static files from project root so site and API are same-origin
app.use(express.static(path.join(__dirname)));

// API: record a visit for unique browser via cookie
app.post('/api/visit', (req, res) => {
  try {
    let uid = req.cookies['ghanti_uid'];
    if (uid && data.users && data.users[uid]) {
      return res.json({ count: data.count, counted: false });
    }
    uid = uid || uuidv4();
    data.users = data.users || {};
    data.users[uid] = true;
    data.count = (data.count || 0) + 1;
    save();
    // set cookie for 10 years
    res.cookie('ghanti_uid', uid, { maxAge: 10 * 365 * 24 * 60 * 60 * 1000, httpOnly: false });
    return res.json({ count: data.count, counted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/count', (req, res) => {
  res.json({ count: data.count || 0 });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
