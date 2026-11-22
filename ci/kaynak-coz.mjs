// K-068 — GitHub Actions macOS makinesinde çalışır (depoda ci/kaynak-coz.mjs olarak durur; asıl kopya AtlasCAD klasöründe
// scripts/mac-ci/). Taslak yayındaki şifreli kaynak arşivini indirir, KAYNAK_ANAHTARI (Actions gizli değişkeni) ile çözer, açar.
// Kaynak herkese açık depoda AÇIK olarak hiç durmaz; anahtar her derlemede yeniden üretilir (scripts/mac-derle.mjs).
// Kullanım: node ci/kaynak-coz.mjs <varlık no> <hedef klasör>
import { createDecipheriv } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [, , varlik, hedef] = process.argv;
const { GH_TOKEN, KAYNAK_ANAHTARI, GITHUB_REPOSITORY } = process.env;
const dur = (m) => { console.error(`HATA: ${m}`); process.exit(1); };
if (!/^\d+$/.test(varlik ?? '') || !hedef) dur('kullanım: kaynak-coz.mjs <varlık no> <hedef>');
if (!KAYNAK_ANAHTARI) dur('KAYNAK_ANAHTARI gizli değişkeni yok');
if (!GH_TOKEN) dur('GH_TOKEN yok');

const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/assets/${varlik}`, {
  headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/octet-stream', 'User-Agent': 'atlascad-mac-ci', 'X-GitHub-Api-Version': '2022-11-28' },
  redirect: 'follow',
});
if (!r.ok) dur(`şifreli kaynak indirilemedi (${r.status})`);
const veri = Buffer.from(await r.arrayBuffer());
// Biçim: "ATLK1" + 12 bayt IV + 16 bayt doğrulama etiketi + AES-256-GCM şifreli tar.gz
if (veri.subarray(0, 5).toString('latin1') !== 'ATLK1') dur('şifreli kaynak biçimi tanınmadı');
const anahtar = Buffer.from(KAYNAK_ANAHTARI, 'base64');
if (anahtar.length !== 32) dur('anahtar uzunluğu yanlış');
const cozucu = createDecipheriv('aes-256-gcm', anahtar, veri.subarray(5, 17));
cozucu.setAuthTag(veri.subarray(17, 33));
let arsiv;
try {
  arsiv = Buffer.concat([cozucu.update(veri.subarray(33)), cozucu.final()]);
} catch {
  dur('kaynak çözülemedi (anahtar bu arşive ait değil)');
}
const gecici = join(tmpdir(), `kaynak-${Date.now()}.tar.gz`);
writeFileSync(gecici, arsiv);
mkdirSync(hedef, { recursive: true });
execFileSync('tar', ['-xzf', gecici, '-C', hedef], { stdio: 'inherit' });
rmSync(gecici, { force: true });
console.log(`Kaynak açıldı (${(arsiv.length / 1048576).toFixed(1)} MB arşiv).`);
