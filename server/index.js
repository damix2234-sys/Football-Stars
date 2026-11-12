import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
// Bez DATABASE_URL dane lokalne trzymamy w katalogu data/ (PGlite).
const db = await openDb({ dir: process.env.DATABASE_URL ? undefined : process.env.PGLITE_DIR || 'data/pglite' });
const app = createApp(db);
app.listen(port, () => {
  console.log(`Football Stars działa na porcie ${port} (baza: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'lokalna PGlite'})`);
});
