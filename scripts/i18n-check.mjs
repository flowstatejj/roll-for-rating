import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

// ---- 1. Collect all t('...') / tr('...') literal-key usages across src ----
function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(walk(p));
    else if (/\.(tsx?|jsx?)$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const staticKeys = new Map(); // key -> Set(files)
const dynamicPrefixes = new Set(); // template-literal prefixes like "tier." "belt."
// matches t('x') t("x") tr('x'); also template `tier.${...}` -> prefix
const callRe = /\b(?:t|tr)\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]*)`)/g;

for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  let m;
  while ((m = callRe.exec(txt))) {
    const lit = m[1] ?? m[2];
    const tmpl = m[3];
    if (lit) {
      if (!staticKeys.has(lit)) staticKeys.set(lit, new Set());
      staticKeys.get(lit).add(f.replace(ROOT, ''));
    } else if (tmpl != null) {
      // dynamic key: capture prefix before ${
      const pre = tmpl.split('${')[0];
      if (pre) dynamicPrefixes.add(pre);
    }
  }
}

// ---- 2. Parse STRINGS dictionary from i18n.tsx ----
const i18nTxt = readFileSync(join(SRC, 'lib', 'i18n.tsx'), 'utf8');
// Build per-lang key sets by scanning blocks: en: { ... }, es: { ... } etc.
const langs = ['en', 'es', 'pt', 'fr'];
const dict = {};
for (const lang of langs) {
  const re = new RegExp(`\\n\\s{2}${lang}:\\s*\\{`, '');
  const start = i18nTxt.search(re);
  if (start < 0) { dict[lang] = new Set(); continue; }
  // find matching closing brace
  let i = i18nTxt.indexOf('{', start);
  let depth = 0, end = i;
  for (; i < i18nTxt.length; i++) {
    if (i18nTxt[i] === '{') depth++;
    else if (i18nTxt[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const block = i18nTxt.slice(start, end);
  const keyRe = /['"]([^'"]+)['"]\s*:/g;
  const set = new Set();
  let km;
  while ((km = keyRe.exec(block))) set.add(km[1]);
  dict[lang] = set;
}

const en = dict.en;

// ---- 3. Report ----
const missingInEn = [];
for (const [k, fs] of staticKeys) {
  if (!en.has(k)) missingInEn.push({ k, files: [...fs] });
}

const missingInOther = {};
for (const lang of ['es', 'pt', 'fr']) {
  const miss = [];
  for (const k of en) if (!dict[lang].has(k)) miss.push(k);
  missingInOther[lang] = miss;
}

console.log('=== i18n coverage check ===');
console.log(`Source files scanned:        ${files.length}`);
console.log(`Distinct static t() keys:    ${staticKeys.size}`);
console.log(`Dynamic key prefixes:        ${[...dynamicPrefixes].sort().join(', ')}`);
console.log(`Dictionary sizes:            en=${en.size} es=${dict.es.size} pt=${dict.pt.size} fr=${dict.fr.size}`);
console.log('');
console.log(`!! Static keys MISSING from en (would show raw key): ${missingInEn.length}`);
for (const { k, files } of missingInEn) console.log(`   - ${k}   (${files.join(', ')})`);
console.log('');
for (const lang of ['es', 'pt', 'fr']) {
  console.log(`Keys in en but not ${lang} (fall back to English): ${missingInOther[lang].length}`);
  if (missingInOther[lang].length) console.log('   ' + missingInOther[lang].join(', '));
}
