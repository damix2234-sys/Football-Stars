// Składa wersję podglądową (bez serwera) w jeden plik HTML: dist/football-stars.html
// Gra działa wtedy w całości w przeglądarce, a pozostali gracze to boty.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// server/game.js -> obiekt G (bez składni modułów).
const gameSrc = read('server/game.js');
const names = [...gameSrc.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const game = `const G = (() => {\n${gameSrc.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;

const css = read('public/style.css');
const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')).trim();
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const fonts = html.match(/<link[^>]+fonts\.g[^>]+>/g).join("\n");
const out = `<title>Football Stars</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${body}
<script>
${safe(game)}
${safe(read('preview/mock-api.js'))}
${safe(read('public/penalty.js'))}
(() => {
${safe(read('public/app.js'))}
})();
</script>
`;

fs.mkdirSync(path.join(root, 'dist', 'img'), { recursive: true });
// grafiki publikujemy obok strony (dist/img/)
for (const f of fs.readdirSync(path.join(root, 'public', 'img')))
  fs.copyFileSync(path.join(root, 'public', 'img', f), path.join(root, 'dist', 'img', f));
fs.writeFileSync(path.join(root, 'dist', 'football-stars.html'), out);
console.log(`dist/football-stars.html (${(out.length / 1024).toFixed(1)} KB)`);
