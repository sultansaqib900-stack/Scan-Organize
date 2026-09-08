import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import sharp from 'sharp';
import './build-privacy.mjs';

const root = 'submission/amazon';
await mkdir(`${root}/assets`, { recursive: true });
// Render from the vector master, never upscale a small PNG. Store icons keep the
// scanner mark but use unrounded, full-bleed artwork per Amazon's store guidance.
const icon = (await readFile('public/icon.svg', 'utf8')).replace(' rx="32"', '');
await writeFile(`${root}/assets/icon-master.svg`, icon);
for (const size of [114, 512]) {
  await sharp(Buffer.from(icon), { density: 384 }).resize(size, size).ensureAlpha().png().toFile(`${root}/assets/icon-${size}.png`);
}

// Optional store artwork: app title and original scanner/folder art only.
// No prices, star ratings, CTA buttons, device mockups, or fake screenshots.
const promo = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
<defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#dde6d7" stroke-width="1"/></pattern><filter id="shadow" x="-50%" y="-40%" width="200%" height="200%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#253e2c" flood-opacity=".13"/></filter></defs>
<rect width="1024" height="500" fill="#f8f9f5"/>
<path d="M571 0h453v500H545c75-114 71-260 26-500Z" fill="#e8efe1"/>
<rect x="566" y="24" width="438" height="452" fill="url(#grid)"/>
<g transform="translate(82 102)"><rect width="68" height="68" rx="16" fill="#426849"/><g fill="none" stroke="#f5f8ed" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 17h-6v8m27-8h7v8M17 43v8h6m28-8v8h-7"/><path d="M25 26h18M25 35h18M25 43h12" stroke-width="2.2"/></g></g>
<g fill="#2e4a34" font-family="Arial, sans-serif" font-weight="600"><text x="78" y="254" font-size="68">Scan &amp;</text><text x="78" y="334" font-size="68">Organize</text></g>
<circle cx="786" cy="250" r="160" fill="none" stroke="#bfd0b5" stroke-width="1.5" stroke-dasharray="4 8"/>
<g transform="rotate(11 835 275)" filter="url(#shadow)"><path d="M711 164a14 14 0 0 1 14-14h67l20 20h123a14 14 0 0 1 14 14v176a14 14 0 0 1-14 14H725a14 14 0 0 1-14-14Z" fill="#c7d7b7"/><rect x="711" y="187" width="238" height="187" rx="14" fill="#d6e2c7"/></g>
<g transform="rotate(-8 771 243)" filter="url(#shadow)"><rect x="669" y="89" width="204" height="295" rx="10" fill="#fff"/><path d="M699 125h36" stroke="#426849" stroke-width="6" stroke-linecap="round"/><path d="M699 147h114m-114 43h144m-144 21h121m-121 21h144m-144 48h103m-103 21h144" stroke="#d7e1d0" stroke-width="5" stroke-linecap="round"/><path d="M699 330h54m61 0h29" stroke="#9db58c" stroke-width="6" stroke-linecap="round"/><path d="M681 177h180v80H681Z" fill="#477d58" opacity=".06"/><path d="M680 257h182" stroke="#56805b" stroke-width="2"/></g>
<g fill="none" stroke="#426849" stroke-width="4" stroke-linecap="round"><path d="M653 115V89h26m175-2h27v27M650 363v27h27m178 1h27v-27"/></g>
<g filter="url(#shadow)"><circle cx="911" cy="364" r="39" fill="#fff"/><circle cx="911" cy="364" r="30" fill="#e6eedd"/><path d="m897 364 10 10 19-22" fill="none" stroke="#426849" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`;
await writeFile(`${root}/assets/promo-master.svg`, promo);
await sharp(Buffer.from(promo), { density: 144 }).resize(1024, 500).flatten({ background: '#f8f9f5' }).png().toFile(`${root}/assets/promo-1024x500.png`);
await copyFile('public/privacy.html', `${root}/privacy-policy.html`);
await copyFile('public/licenses/third-party-notices.txt', `${root}/third-party-notices.txt`);
for (const name of ['icon-114.png', 'icon-512.png', 'promo-1024x500.png']) {
  const metadata = await sharp(`${root}/assets/${name}`).metadata();
  console.log(`${name}: ${metadata.width}x${metadata.height}, ${metadata.format}, ${metadata.channels} channels`);
}
console.log('Store artwork and policy copy prepared. Screenshots must come from, or be checked against, the final Fire APK; no screenshots were fabricated by this script.');
