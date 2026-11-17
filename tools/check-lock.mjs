import fs from 'node:fs';

const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const [name, entry] of Object.entries(lock.packages || {})) {
  if (!name) continue;
  const archive = entry.resolved?.startsWith('https://registry.npmjs.org/') && entry.integrity;
  const bundled = entry.inBundle === true && !entry.resolved;
  if (!name.startsWith('node_modules/') || entry.link || (!archive && !bundled)) {
    throw new Error(`Nonportable dependency in package-lock.json: ${name}`);
  }
}
console.log('Dependency lock contains only verified npm registry archives');
