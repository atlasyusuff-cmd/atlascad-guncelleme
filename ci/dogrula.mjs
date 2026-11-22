// K-068 — GitHub Actions macOS makinesinde Mac paketinin doğrulaması (depoda ci/dogrula.mjs; asıl kopya scripts/mac-ci/).
// dmg → /Applications'a kopyala → imza / mimari / Info.plist / içerik denetimi → programı geçici profille aç, Chrome hata ayıklama
// kapısından (CDP) sür: lisans (deneme → kurcalama → kilit → geçerli anahtar), ayar / proje / oturum, örnek mutfak, 3B, parça listesi,
// kesim planı; ekran görüntüleri (program içi + bütün ekran). Sonra web sitesi için Türkçe macOS'ta dmg penceresi ve Gatekeeper uyarısı.
// Lisans: makine kodu taslak yayına bırakılır; yerelde (Yusuf'un bilgisayarı) scripts/mac-derle.mjs özel anahtarla deneme lisansı
// üretip geri koyar. Özel anahtar bu makineye hiç gelmez.
// Kullanım: node ci/dogrula.mjs <kaynak klasörü> <kanıt klasörü> <arm64|x64> <etiket> <taslak yayın no>
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , KAYNAK, KANIT, MIMARI, ETIKET, YAYIN] = process.argv;
const { GH_TOKEN, GITHUB_REPOSITORY } = process.env;
mkdirSync(KANIT, { recursive: true });
const APP = '/Applications/AtlasCAD.app';
const sonuc = [];
const yaz = (ad, ok, ayrinti = '', kritik = true) => {
  sonuc.push({ ad, ok: !!ok, ayrinti: String(ayrinti).slice(0, 600), kritik });
  console.log(`${ok ? 'TAMAM' : kritik ? 'HATA ' : 'BİLGİ'} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 300)}` : ''}`);
};
const sh = (komut, argumanlar, ayar = {}) => {
  const r = spawnSync(komut, argumanlar, { encoding: 'utf8', timeout: 180_000, ...ayar });
  return { ok: r.status === 0, kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const ekran = (ad) => {
  const r = sh('screencapture', ['-x', '-t', 'png', join(KANIT, `${ad}.png`)]);
  if (!r.ok) console.log(`screencapture ${ad}: ${r.cikti}`);
  return r.ok && existsSync(join(KANIT, `${ad}.png`));
};
const gh = async (yol, ayar = {}) => {
  const r = await fetch(yol.startsWith('http') ? yol : `https://api.github.com/repos/${GITHUB_REPOSITORY}${yol}`, {
    ...ayar,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'atlascad-mac-ci', ...(ayar.headers ?? {}) },
  });
  return { durum: r.status, govde: r.status === 204 ? null : await r.json().catch(() => null) };
};

// ------------------------------------------------------------------ 0. Makine
yaz('macOS', true, `${sh('sw_vers', []).cikti.replace(/\s+/g, ' ')} · ${sh('uname', ['-m']).cikti} · ${sh('sysctl', ['-n', 'machdep.cpu.brand_string']).cikti}`);

// ------------------------------------------------------------------ 1. dmg ve paket içeriği
const distMac = join(KAYNAK, 'dist-mac');
const dmgler = existsSync(distMac) ? readdirSync(distMac).filter((d) => d.endsWith('.dmg')) : [];
const dmg = dmgler.length === 1 ? join(distMac, dmgler[0]) : null;
yaz('dmg üretildi', !!dmg, dmg ? `${dmgler[0]} · ${(statSync(dmg).size / 1048576).toFixed(0)} MB` : dmgler.join(', '));
if (!dmg) finish();
const bag = '/tmp/atlascad-dmg';
const ek = sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', bag, dmg]);
const dmgIcerik = ek.ok ? readdirSync(bag) : [];
yaz('dmg açıldı: AtlasCAD.app + Uygulamalar kısayolu', dmgIcerik.includes('AtlasCAD.app') && dmgIcerik.includes('Applications'), ek.ok ? dmgIcerik.join(', ') : ek.cikti);
rmSync(APP, { recursive: true, force: true });
const kopya = sh('ditto', [join(bag, 'AtlasCAD.app'), APP]);
sh('hdiutil', ['detach', bag]);
yaz('Uygulamalar klasörüne kopyalandı', kopya.ok && existsSync(APP), kopya.cikti);
if (!existsSync(APP)) finish();

const imza = sh('codesign', ['--verify', '--deep', '--strict', '--verbose=2', APP]);
yaz('imza geçerli (codesign --verify --deep --strict)', imza.ok, imza.cikti.split('\n').slice(-2).join(' '));
const imzaBilgi = sh('codesign', ['-dv', '--verbose=2', APP]).cikti;
yaz('imza türü ad-hoc (Apple Developer hesabı yok)', /Signature=adhoc/.test(imzaBilgi), (imzaBilgi.match(/(Signature=.*|flags=.*|Identifier=.*)/g) ?? []).join(' · '));
const ikili = join(APP, 'Contents', 'MacOS', 'AtlasCAD');
const mimariler = sh('lipo', ['-archs', ikili]).cikti;
yaz(`işlemci mimarisi ${MIMARI}`, mimariler.trim() === (MIMARI === 'x64' ? 'x86_64' : 'arm64'), mimariler);
let plist = {};
try {
  plist = JSON.parse(sh('plutil', ['-convert', 'json', '-o', '-', join(APP, 'Contents', 'Info.plist')]).cikti);
} catch { /* aşağıda HATA */ }
const turler = (plist.CFBundleDocumentTypes ?? []).flatMap((t) => t.CFBundleTypeExtensions ?? []);
yaz('Info.plist: sürüm, kimlik, .mcad dosya türü', !!plist.CFBundleShortVersionString && plist.CFBundleIdentifier === 'tr.atlascad.app' && turler.includes('mcad'),
  `sürüm ${plist.CFBundleShortVersionString} · ${plist.CFBundleIdentifier} · en düşük macOS ${plist.LSMinimumSystemVersion} · türler ${turler.join(',')}`);
const kaynaklar = join(APP, 'Contents', 'Resources');
yaz('Blender betiği var, Windows Blender programı YOK', existsSync(join(kaynaklar, 'blender', 'render.py')) && !existsSync(join(kaynaklar, 'blender-program')),
  readdirSync(kaynaklar).filter((d) => !d.endsWith('.lproj')).join(', '));
yaz('otomatik güncelleme ayarı (app-update.yml) yok', !existsSync(join(kaynaklar, 'app-update.yml')));
const boyut = sh('du', ['-sh', APP]).cikti.split(/\s/)[0];
yaz('uygulama boyutu', true, boyut, false);
const fuses = join(KAYNAK, 'node_modules', '@electron', 'fuses', 'dist', 'bin.js');
if (existsSync(fuses)) {
  const f = sh('node', [fuses, 'read', '--app', APP]).cikti;
  yaz('fuses: RunAsNode kapalı, asar bütünlüğü açık', /RunAsNode is Disabled/i.test(f) && /EnableEmbeddedAsarIntegrityValidation is Enabled/i.test(f) && /OnlyLoadAppFromAsar is Enabled/i.test(f), f.replace(/\s+/g, ' ').slice(0, 400));
}

// Gatekeeper (internetten inmiş gibi karantina bayraklı kopya): Apple Developer imzası olmadığı için reddedilmesi beklenir; sitede anlatılan ilk açılış adımı bunun için
const karantina = '/tmp/karantina/AtlasCAD.app';
rmSync('/tmp/karantina', { recursive: true, force: true });
mkdirSync('/tmp/karantina', { recursive: true });
sh('ditto', [APP, karantina]);
sh('xattr', ['-w', 'com.apple.quarantine', `0083;${Math.floor(Date.now() / 1000).toString(16)};Safari;`, karantina]);
yaz('Gatekeeper durumu', true, sh('spctl', ['--status']).cikti, false);
yaz('Gatekeeper değerlendirmesi (karantinalı kopya)', true, sh('spctl', ['--assess', '--type', 'execute', '-vv', karantina]).cikti, false);

// ------------------------------------------------------------------ 2. Programı aç ve sür (CDP)
const kapi = 9377;
const profil = mkdtempSync(join(tmpdir(), 'atlascad-mac-profil-'));
const denemeMac = join(homedir(), 'Library', 'Preferences', '.atlascad-d.json');
rmSync(denemeMac, { force: true });
sh('defaults', ['delete', 'tr.atlascad.kayit']);
const gunluk = [];
let surec = null;
let cikisKodu = null;
let ws;
let sira = 0;
const bekleyen = new Map();
const konsol = [];
const gonder = (method, params = {}) => new Promise((coz, red) => { const id = ++sira; bekleyen.set(id, { coz, red }); ws.send(JSON.stringify({ id, method, params })); });
const calistir = async (ifade, sureMs = 30_000) => {
  const r = await Promise.race([gonder('Runtime.evaluate', { expression: `(async () => { ${ifade} })()`, awaitPromise: true, returnByValue: true }), bekle(sureMs).then(() => ({ zamanAsimi: true }))]);
  if (r.zamanAsimi) throw new Error('zaman aşımı');
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const sayfaGoruntu = async (ad) => {
  try {
    const r = await gonder('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(KANIT, `${ad}.png`), Buffer.from(r.data, 'base64'));
    return true;
  } catch (e) {
    console.log(`sayfa görüntüsü ${ad}: ${e.message}`);
    return false;
  }
};
const lisansDurumu = async () => JSON.parse(await calistir('return JSON.stringify(await window.api.lisansDurumu());'));

/** Programı geçici profille açar ve CDP'ye bağlanır. `ek`: ek Chromium bayrakları (ekran kartsız makinede yazılım çizici). */
async function baslat(ek = []) {
  cikisKodu = null;
  surec = spawn(ikili, [`--remote-debugging-port=${kapi}`, `--user-data-dir=${profil}`, ...ek], { stdio: ['ignore', 'pipe', 'pipe'] });
  surec.stdout.on('data', (b) => gunluk.push(String(b)));
  surec.stderr.on('data', (b) => gunluk.push(String(b)));
  surec.on('exit', (k, s) => { cikisKodu = `${k ?? ''}${s ?? ''}`; });
  let hedef;
  for (let i = 0; i < 90 && !hedef; i++) {
    await bekle(1000);
    if (cikisKodu !== null) throw new Error(`program kapandı (çıkış ${cikisKodu}): ${gunluk.join('').slice(-800)}`);
    try { hedef = (await (await fetch(`http://127.0.0.1:${kapi}/json`)).json()).find((t) => t.type === 'page' && !/devtools/.test(t.url)); } catch { /* henüz açılmadı */ }
  }
  if (!hedef) throw new Error(`program penceresi açılmadı: ${gunluk.join('').slice(-800)}`);
  ws = new WebSocket(hedef.webSocketDebuggerUrl);
  await new Promise((coz, red) => { ws.onopen = coz; ws.onerror = () => red(new Error('CDP bağlantısı kurulamadı')); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && bekleyen.has(m.id)) { const b = bekleyen.get(m.id); bekleyen.delete(m.id); if (m.error) b.red(new Error(m.error.message)); else b.coz(m.result); }
    else if (m.method === 'Runtime.consoleAPICalled') konsol.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') konsol.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  };
  await gonder('Runtime.enable');
  await bekle(4000);
  return hedef;
}
const ortamOku = async () => JSON.parse(await calistir(`const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return JSON.stringify({ ua: navigator.userAgent, webgl2: !!g, gpu: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, webgpu: !!navigator.gpu, ekran: screen.width + 'x' + screen.height, pencere: innerWidth + 'x' + innerHeight });`));

try {
  let hedef = await baslat();
  yaz('program açıldı (pencere)', true, `${hedef.title}`);
  yaz('program arayüzü (window.api) var', await calistir(`return typeof window.api === 'object' && typeof window.api.projeKaydet === 'function';`));
  let ortam = await ortamOku();
  if (!ortam.webgl2) {
    // GitHub'ın Intel sanal makinesinde ekran kartı yok (gerçek Intel Mac'lerde var): ekran görüntüsü alınıp yazılım çiziciyle yeniden açılır
    yaz('bu CI makinesinde donanım WebGL yok (sanal makine) → yazılım çiziciyle (SwiftShader) yeniden açılıyor', true, `${ortam.gpu} · ekran ${ortam.ekran}`, false);
    ekran('0-ekran-karti-yok');
    try { ws.close(); } catch { /* yok */ }
    surec.kill();
    await bekle(3000);
    hedef = await baslat(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
    ortam = await ortamOku();
  }
  yaz('Mac ortamı (Macintosh), WebGL2', /Macintosh/.test(ortam.ua) && ortam.webgl2, `${ortam.gpu} · WebGPU ${ortam.webgpu} · ekran ${ortam.ekran} · pencere ${ortam.pencere}`);

  // Lisans 1: ilk açılış → 14 gün deneme; makine kodu taslak yayına (yerel betik lisans üretir)
  const ld = await lisansDurumu();
  yaz('satış: ilk açılışta 14 gün deneme', ld.durum === 'deneme' && ld.kalanGun >= 13 && ld.kalanGun <= 14, JSON.stringify(ld));
  // Donanım kimliği yerel betiğe gider: kodun bilgisayar adından değil bu kimlikten türediğini orada denetler (hesap yöntemi bu
  // herkese açık depoda yazılmaz)
  const uuid = (/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/.exec(sh('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).cikti) ?? [])[1] ?? '';
  yaz('makine kodu biçimi (16 karakter)', /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(ld.makine ?? ''), ld.makine);
  yaz('deneme kaydı üç yerde (2 dosya + defaults)', existsSync(join(profil, 'deneme.json')) && existsSync(denemeMac) && sh('defaults', ['read', 'tr.atlascad.kayit', 'd']).ok,
    `${existsSync(join(profil, 'deneme.json'))} ${existsSync(denemeMac)} ${sh('defaults', ['read', 'tr.atlascad.kayit', 'd']).ok}`);
  if (YAYIN && GH_TOKEN) {
    const ad = `makine-${MIMARI}-${ETIKET}.json`;
    const r = await fetch(`https://uploads.github.com/repos/${GITHUB_REPOSITORY}/releases/${YAYIN}/assets?name=${ad}`, {
      method: 'POST', body: JSON.stringify({ makine: ld.makine, uuid }),
      headers: { Authorization: `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'atlascad-mac-ci', Accept: 'application/vnd.github+json' },
    });
    yaz('makine kodu yerel lisans üreticisine bırakıldı', r.status === 201, `${r.status}`, false);
  }
  await bekle(1500);
  await sayfaGoruntu('1-acilis-program');
  ekran('1-acilis-ekran');

  const ayar = await calistir(`const a = await window.api.ayarlariOku(); await window.api.ayarlariYaz(JSON.stringify({ deneme: 42 })); const b = await window.api.ayarlariOku(); await window.api.ayarlariYaz(JSON.stringify(a ?? null)); return JSON.stringify(b);`);
  yaz('ayar yaz / oku (geçici profil)', ayar === '{"deneme":42}' && existsSync(join(profil, 'ayarlar.json')));

  const projeYolu = join(profil, 'deneme projesi ğüşiöç.mcad');
  const kayit = await calistir(`const icerik = JSON.stringify({ tur: 'mobilyacad-proje', surum: 1, ad: 'Mac testi', moduller: [], duvarlar: [] }); const y = await window.api.projeKaydet(icerik, ${JSON.stringify(projeYolu)}, false, 'x'); const a = await window.api.projeAc(y); const son = await window.api.sonDosyalar(); return JSON.stringify({ y: !!y, ayni: a?.icerik === icerik, son: son.includes(y) });`);
  yaz('proje kaydet / aç / son dosyalar (Türkçe adlı dosya)', kayit === '{"y":true,"ayni":true,"son":true}', kayit);
  const sil = await calistir(`const y = ${JSON.stringify(projeYolu)}; await window.api.projeSil(y); const l = await window.api.projeListesi(); return JSON.stringify({ kalkti: !l.some((x) => x.yol === y) });`);
  yaz('proje silme (Çöp Sepeti\'ne)', sil === '{"kalkti":true}' && !existsSync(projeYolu), sil);
  const oturum = await calistir(`await window.api.oturumYaz('{"x":1}'); return await window.api.oturumOku();`);
  yaz('oturum (kaldığı yerden devam) yaz / oku', oturum === '{"x":1}');
  await calistir(`await window.api.oturumYaz('');`).catch(() => {});
  const bl = JSON.parse(await calistir(`return JSON.stringify(await window.api.blenderBul(null));`));
  yaz('Blender araması çalışıyor (bu makinede Blender kurulu değil)', true, `${bl.yol ?? 'bulunamadı'} ${bl.surum ?? ''}`, false);
  const usb = await calistir(`return JSON.stringify(await window.api.hariciSuruculer());`);
  yaz('USB bellek listesi çalışıyor', Array.isArray(JSON.parse(usb)), usb, false);

  // Arayüz: örnek mutfak → 3B → Üretim → Parça Listesi → Kesim Planı
  await calistir(`
    window.confirm = () => true;
    window.tikla = (re, kok = document) => { const e = [...kok.querySelectorAll('button')].find(b => re.test(b.textContent.trim()) && !b.disabled); e?.click(); return !!e; };
    window.uyu = (ms) => new Promise(r => setTimeout(r, ms));`);
  const acildi = await calistir(`tikla(/^Yeni$/); await uyu(700); tikla(/^Kaydetmeden devam$/); await uyu(900); [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Örnek mutfağı incele')?.click(); await uyu(3000); tikla(/^3B$/); await uyu(3500); const c = [...document.querySelectorAll('main.orta canvas')].filter((x) => x.width > 300 && x.height > 200).length; return JSON.stringify({ c, metin: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 3000) });`, 60_000);
  const aj = JSON.parse(acildi);
  const dolap = (aj.metin.match(/örnek mutfak \((\d+) dolap\)/) ?? [])[1];
  yaz('örnek mutfak açıldı (3B)', Number(dolap) > 0 && aj.c > 0, `${dolap} dolap · 3B tuval ${aj.c}`);
  await sayfaGoruntu('2-ornek-mutfak-3b');
  ekran('2-ornek-mutfak-3b-ekran');
  const liste = await calistir(`tikla(/Üretim$/, document.querySelector('.ust-adimlar')); await uyu(1500); tikla(/^Parça Listesi$/); await uyu(2500); const t = document.querySelector('main.orta'); return JSON.stringify({ satir: t?.querySelectorAll('tr').length ?? 0, metin: (t?.innerText ?? '').slice(0, 200).replace(/\\s+/g, ' ') });`, 60_000);
  const lj = JSON.parse(liste);
  yaz('parça listesi (kesim listesi) dolu', lj.satir > 10, `${lj.satir} satır · ${lj.metin.slice(0, 120)}`);
  await sayfaGoruntu('3-parca-listesi');
  const kesim = await calistir(`tikla(/^Kesim Planı$/); await uyu(1500); tikla(/^Optimize et$/); for (let i = 0; i < 90; i++) { await uyu(1000); const s = document.querySelectorAll('main.orta .plaka-kart').length; if (s > 0) { await uyu(2000); return JSON.stringify({ svg: s, metin: (document.querySelector('main.orta')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300) }); } } return JSON.stringify({ svg: 0, metin: (document.querySelector('main.orta')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300) });`, 120_000);
  const kj = JSON.parse(kesim);
  yaz('kesim planı (plaka yerleşimi) çizildi', kj.svg > 0, `${kj.svg} plaka · ${(kj.metin ?? '').slice(0, 120)}`);
  await sayfaGoruntu('4-kesim-plani');
  ekran('4-kesim-plani-ekran');

  // Mac menüsü ve gerçek Cmd+Z (System Events ile klavyeden): çizimdeki "geri al" kısayolu sayfaya ulaşıyor mu, menü yutuyor mu?
  // (Erişilebilirlik izni yoksa osascript çalışmaz → bilgi olarak yazılır)
  sh('osascript', ['-e', 'tell application "AtlasCAD" to activate']);
  await bekle(1500);
  const menu = sh('osascript', ['-e', 'tell application "System Events" to get name of menu bar items of menu bar 1 of process "AtlasCAD"']);
  yaz('Mac menüsü Türkçe (AtlasCAD · Düzen · Görünüm · Pencere)', menu.ok && /Düzen/.test(menu.cikti) && !/Developer|View/.test(menu.cikti), menu.cikti.slice(0, 200), false);
  await calistir(`window.__cmdz = 0; document.activeElement?.blur?.(); window.addEventListener('keydown', (e) => { if (e.metaKey && e.key.toLowerCase() === 'z') window.__cmdz++; }, true); return true;`);
  const tus = sh('osascript', ['-e', 'tell application "System Events" to keystroke "z" using command down']);
  await bekle(1200);
  const cmdz = await calistir('return window.__cmdz;');
  yaz('klavyeden Cmd+Z sayfaya ulaşıyor (çizimde geri al çalışır)', tus.ok && cmdz >= 1, tus.ok ? `sayfaya ulaşan Cmd+Z: ${cmdz}` : `osascript: ${tus.cikti.slice(0, 160)}`, false);

  // Program içi gerçekçi render (ekran kartına bağlı; CI sanal makinesinde yavaş olabilir — bilgi amaçlı)
  try {
    const r = await calistir(`tikla(/^Çizim$|Çizim$/, document.querySelector('.ust-adimlar')); await uyu(1200); tikla(/^3B$/); await uyu(1500); if (!tikla(/^Gerçekçi render/)) return JSON.stringify({ hata: 'düğme yok' }); await uyu(1500); const s = [...document.querySelectorAll('.render-pencere select')]; const sec = (d) => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; const x = s.find(x => [...x.options].some(o => o.value === d)); if (x) { set.call(x, d); x.dispatchEvent(new Event('change', { bubbles: true })); } }; for (const d of ['1280x720', 'hizli', 'goz', 'otomatik']) sec(d); await uyu(500); tikla(/^Fotoğraf al$/); for (let i = 0; i < 300; i++) { const img = document.querySelector('img.render-resim'); if (!document.querySelector('.render-pencere progress') && img?.src?.startsWith('data:')) return JSON.stringify({ tamam: true, sn: i / 2 }); const h = document.querySelector('.render-pencere .kutu-hata'); if (h) return JSON.stringify({ hata: h.textContent }); await uyu(500); } return JSON.stringify({ hata: 'zaman aşımı (150 sn)' });`, 200_000);
    const motor = konsol.filter((k) => /Yol izleme/.test(k)).slice(-1)[0] ?? '';
    yaz('gerçekçi render (program içi)', JSON.parse(r).tamam, `${r} ${motor.slice(0, 160)}`, false);
    await sayfaGoruntu('5-gercekci-render');
    await calistir(`tikla(/^Kapat$/); await uyu(500);`).catch(() => {});
  } catch (e) {
    yaz('gerçekçi render (program içi)', false, e.message, false);
  }

  // Yerel lisans üreticisinin cevabı: { makineDogru, anahtar (bu makineye deneme lisansı), suresiDolmus (mühürlü, süresi geçmiş deneme kaydı) }
  let yerel = null;
  if (YAYIN && GH_TOKEN) {
    const ad = `lisans-${MIMARI}-${ETIKET}.json`;
    for (let i = 0; i < 90 && !yerel; i++) {
      const y = await gh(`/releases/${YAYIN}`);
      const v = y.govde?.assets?.find((a) => a.name === ad);
      if (v) {
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/assets/${v.id}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/octet-stream', 'User-Agent': 'atlascad-mac-ci' } });
        if (r.ok) yerel = JSON.parse(await r.text());
      } else await bekle(10_000);
    }
  }
  yaz('makine kodu donanım kimliğinden (IOPlatformUUID) türüyor (yerelde denetlendi)', yerel?.makineDogru === true, yerel ? `${yerel.makineDogru}` : 'yerel lisans üreticisinden cevap gelmedi (15 dk)');

  // Lisans 2: elle değiştirilmiş deneme kaydı → kilit; süresi dolmuş (mühürlü) kayıt → kilit; kilitliyken kayıt reddi; sahte anahtar reddi
  const eski = Buffer.from(JSON.stringify({ ilk: new Date(Date.now() - 30 * 86400000).toISOString(), son: new Date(Date.now() - 86400000).toISOString() })).toString('base64');
  writeFileSync(join(profil, 'deneme.json'), eski);
  writeFileSync(denemeMac, eski);
  sh('defaults', ['delete', 'tr.atlascad.kayit']);
  const kurcali = await lisansDurumu();
  yaz('satış: elle değiştirilen deneme kaydı kabul edilmez', kurcali.durum === 'kilitli', JSON.stringify(kurcali));
  if (yerel?.suresiDolmus) {
    writeFileSync(join(profil, 'deneme.json'), yerel.suresiDolmus);
    writeFileSync(denemeMac, yerel.suresiDolmus);
    sh('defaults', ['delete', 'tr.atlascad.kayit']);
    const kilit = await lisansDurumu();
    yaz('satış: deneme süresi dolunca kilitli', kilit.durum === 'kilitli' && /süresi doldu/i.test(kilit.neden ?? ''), JSON.stringify(kilit));
  }
  const ret = await calistir(`try { await window.api.projeKaydet('{}', ${JSON.stringify(join(profil, 'kilitli.mcad'))}, false, 'x'); return 'KAYDETTİ'; } catch (e) { return String(e.message); }`);
  yaz('satış: kilitliyken kaydetme reddedilir (ana süreçte)', /Lisans gerekli/.test(ret) && !existsSync(join(profil, 'kilitli.mcad')), ret.slice(0, 140));
  const sahte = JSON.parse(await calistir(`return JSON.stringify(await window.api.lisansGir('ATLAS1.eyJtIjoiQUFBQS1BQUFBLUFBQUEtQUFBQSIsImFkIjoieCIsImIiOm51bGwsIm5vIjoxfQ.AAAA'));`));
  yaz('satış: sahte anahtar kabul edilmez', sahte.tamam === false, sahte.neden);
  await calistir(`location.reload();`).catch(() => {});
  await bekle(5000);
  await sayfaGoruntu('6-kilitli-ekran');

  // Lisans 3: yerelde üretilen gerçek anahtar (bu makinenin kodu için, deneme lisansı) → lisanslı → kayıt yine çalışır
  const anahtar = yerel?.anahtar ?? null;
  if (!anahtar) yaz('satış: geçerli anahtar kabul edilir', false, 'yerel lisans üreticisinden anahtar gelmedi');
  else {
    const g = JSON.parse(await calistir(`return JSON.stringify(await window.api.lisansGir(${JSON.stringify(anahtar)}));`));
    yaz('satış: geçerli anahtar kabul edilir → lisanslı', g.tamam === true && g.durum?.durum === 'lisansli', `${g.durum?.ad ?? g.neden} · no ${g.durum?.no}`);
    const sonra = await calistir(`try { const y = await window.api.projeKaydet('{"tur":"mobilyacad-proje"}', ${JSON.stringify(join(profil, 'lisansli.mcad'))}, false, 'x'); return y ? 'tamam' : 'boş'; } catch (e) { return String(e.message); }`);
    yaz('satış: lisanslıyken kaydetme çalışır', sonra === 'tamam' && existsSync(join(profil, 'lisansli.mcad')), sonra);
    await calistir(`location.reload();`).catch(() => {});
    await bekle(6000);
    await sayfaGoruntu('7-lisansli');
  }

  const hatalar = konsol.filter((k) => /^(error|exception)/.test(k) && !/X4000|uninitialized|iridescence/.test(k));
  yaz('konsolda hata yok', hatalar.length === 0, hatalar.slice(0, 4).join(' | ').slice(0, 400), false);
} catch (e) {
  yaz('test akışı', false, e.message);
  ekran('hata-ekran');
} finally {
  try { ws?.close(); } catch { /* yok */ }
  surec.kill();
  await bekle(1500);
  writeFileSync(join(KANIT, 'program-gunlugu.txt'), gunluk.join('').slice(-20000));
  writeFileSync(join(KANIT, 'konsol.txt'), konsol.join('\n').slice(-20000));
}

// ------------------------------------------------------------------ 3. Web sitesi için Türkçe macOS görüntüleri (bilgi amaçlı)
try {
  sh('defaults', ['write', '-g', 'AppleLanguages', '-array', 'tr-TR', 'en-US']);
  sh('defaults', ['write', '-g', 'AppleLocale', '-string', 'tr_TR']);
  // Sistem uyarı penceresi (CoreServicesUIAgent) dili yeniden başlayınca okur: tercih önbelleği + ajan yeniden başlatılır
  sh('killall', ['cfprefsd']);
  sh('killall', ['Finder']);
  sh('killall', ['CoreServicesUIAgent']);
  sh('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.apple.coreservices.uiagent`]);
  await bekle(5000);
  // dmg penceresi: "AtlasCAD'i Uygulamalar'a sürükleyin"
  const ek2 = sh('hdiutil', ['attach', '-readonly', dmg]);
  const nokta = (ek2.cikti.match(/\/Volumes\/[^\n]+/) ?? [''])[0].trim();
  if (nokta) {
    sh('open', [nokta]);
    await bekle(5000);
    ekran('site-1-dmg-penceresi');
    sh('osascript', ['-e', 'tell application "Finder" to close every window']);
    sh('hdiutil', ['detach', nokta, '-force']);
  }
  // Gatekeeper uyarısı (karantinalı kopya). Değerlendirme kapalıysa açılır (runner'da parolasız sudo)
  if (/disabled/i.test(sh('spctl', ['--status']).cikti)) {
    sh('sudo', ['spctl', '--global-enable']);
    sh('sudo', ['spctl', '--master-enable']);
  }
  yaz('Gatekeeper durumu (site görüntüsü öncesi)', true, sh('spctl', ['--status']).cikti, false);
  sh('open', [karantina]);
  await bekle(7000);
  ekran('site-2-gatekeeper-uyarisi');
  // Uyarıdaki düğmeler (dil İngilizce ya da Türkçe olabilir); "Bitti / Done" — ÇÖP SEPETİNE TAŞI'ya değil
  const uyariMetni = sh('osascript', ['-e', 'tell application "System Events" to tell process "CoreServicesUIAgent" to get {name of every button of window 1, value of every static text of window 1}']);
  yaz('Gatekeeper uyarısının metni', true, uyariMetni.cikti.slice(0, 400), false);
  const bitti = sh('osascript', ['-e', 'tell application "System Events" to tell process "CoreServicesUIAgent" to click (first button of window 1 whose name is "Bitti" or name is "Done")']);
  yaz('uyarıda "Bitti"ye basıldı', bitti.ok, bitti.cikti.slice(0, 200), false);
  await bekle(3000);
  sh('killall', ['AtlasCAD']);
  // Sistem Ayarları → Gizlilik ve Güvenlik → Güvenlik bölümünde "AtlasCAD engellendi … Yine de Aç"
  sh('open', ['x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension']);
  await bekle(8000);
  ekran('site-3-gizlilik-guvenlik');
  sh('open', ['x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Security']);
  await bekle(6000);
  ekran('site-4-guvenlik-bolumu');
  // "Yine de Aç" düğmesini bul (ekranın altındaysa görünür olsun diye) ve bas → onay / parola penceresi (iptal edilir)
  const yineDe = sh('osascript', ['-e', `tell application "System Events" to tell process "System Settings"
    set bulunan to missing value
    repeat with e in (entire contents of window 1)
      try
        if (role of e is "AXButton") and (name of e is "Yine de Aç" or name of e is "Open Anyway") then set bulunan to e
      end try
    end repeat
    if bulunan is missing value then return "yok"
    click bulunan
    return "basıldı"
  end tell`], { timeout: 120_000 });
  yaz('Gizlilik ve Güvenlik: "Yine de Aç" düğmesi', /basıldı/.test(yineDe.cikti), yineDe.cikti.slice(0, 200), false);
  await bekle(4000);
  ekran('site-5-yine-de-ac-onayi');
  sh('osascript', ['-e', 'tell application "System Events" to key code 53']);
  await bekle(1500);
  sh('killall', ['System Settings']);
} catch (e) {
  yaz('site görüntüleri', false, e.message, false);
}
finish();

function finish() {
  writeFileSync(join(KANIT, `sonuc-${MIMARI}.json`), JSON.stringify(sonuc, null, 1));
  const kalan = sonuc.filter((s) => !s.ok && s.kritik).length;
  console.log(`\nMAC DOĞRULAMA (${MIMARI}): ${sonuc.filter((s) => s.kritik).length - kalan} / ${sonuc.filter((s) => s.kritik).length} kritik denetim geçti`);
  process.exit(kalan ? 1 : 0);
}
