// npm run check — manifesto do Show Pack (DK-011): casos válidos e cada regra de recusa, na ordem da spec.
import assert from 'node:assert/strict';
import { LIMITS } from '../limits.ts';
import { MAX_ASSETS, MAX_TOTAL_BYTES, SCHEMA_VERSION, safeAssetPath, validateManifest, type AssetEntry } from './manifest.ts';

const sha = 'a'.repeat(64);
const asset = (o: Partial<AssetEntry> = {}): AssetEntry => ({ path: 'logo.png', kind: 'logo', bytes: 1000, sha256: sha, mime: 'image/png', refId: 'logo', ...o });
const base = () => ({
  schemaVersion: 1, appVersion: '0.3.1', createdAt: '2026-10-30T12:00:00Z', name: 'Show de teste', includeTracks: false,
  assets: [
    asset(),
    asset({ path: 'fundo.jpg', kind: 'bg', mime: 'image/jpeg', refId: 'bg', sha256: 'B'.repeat(64) }),
    asset({ path: 'loop1.mp4', kind: 'video', mime: 'video/mp4', refId: 'k3j2h1g0', bytes: 50 << 20 }),
  ],
});
const bad = (m: unknown, re: RegExp, opts?: Parameters<typeof validateManifest>[1]) => {
  const r = validateManifest(m, opts);
  assert.equal(r.ok, false, `devia recusar: ${re}`);
  if (!r.ok) assert.match(r.error, re);
};
const withAsset = (o: Partial<AssetEntry>) => ({ ...base(), assets: [asset({ path: 'x.mp4', kind: 'video', mime: 'video/mp4', refId: 'v1', ...o })] });

// --- safeAssetPath ---
assert.equal(safeAssetPath('logo.png'), 'logo.png');
assert.equal(safeAssetPath('Loop_01-final.webm'), 'Loop_01-final.webm');
for (const p of ['../logo.png', 'a/../b.png', '/logo.png', 'C:\\logo.png', 'sub\\logo.png', 'sub/logo.png', 'minha logo.png', '.png', '..', '', 'logo.png\n', 'lógo.png', 'con.png', 'NUL', 'x'.repeat(256)])
  assert.equal(safeAssetPath(p), null, `devia recusar: ${JSON.stringify(p)}`);

// --- válido: normaliza (hash minúsculo, nome sem espaços nas pontas, campos extras fora) ---
{
  const r = validateManifest({ ...base(), name: '  Show de teste ', extra: 1 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.manifest.name, 'Show de teste');
    assert.equal(r.manifest.assets[1].sha256, 'b'.repeat(64));
    assert.equal(r.manifest.assets.length, 3);
    assert.ok(!('extra' in r.manifest));
  }
  assert.ok(validateManifest({ ...base(), assets: [] }).ok, 'pacote sem assets (só estado) é válido');
  assert.ok(validateManifest({ ...base(), includeTracks: true, assets: [asset({ path: 'faixa.mp3', kind: 'track', mime: 'audio/mpeg', refId: 'abc123.mp3' })] }).ok);
  assert.ok(validateManifest({ ...base(), createdAt: '2026-10-30T09:00:00.123-03:00' }).ok);
  assert.ok(validateManifest({ ...base(), includeTracks: true, assets: [asset({ path: 'f.m4a', kind: 'track', mime: 'video/mp4', refId: 'f.m4a' })] }).ok, 'm4a às vezes vem como video/mp4');
}

// --- forma ---
bad(null, /precisa ser um objeto/);
bad('{}', /precisa ser um objeto/);
bad({ ...base(), name: '' }, /"name"/);
bad({ ...base(), name: 'x'.repeat(121) }, /"name"/);
bad({ ...base(), appVersion: '' }, /"appVersion"/);
bad({ ...base(), createdAt: 'ontem' }, /"createdAt"/);
bad({ ...base(), createdAt: '2026-10-30' }, /"createdAt"/);            // sem hora/fuso
bad({ ...base(), createdAt: '2026-13-45T00:00:00Z' }, /"createdAt"/);  // forma certa, data impossível
bad({ ...base(), includeTracks: 'sim' }, /"includeTracks"/);
bad({ ...base(), assets: {} }, /"assets" precisa ser uma lista/);
bad({ ...base(), assets: [1] }, /asset 1: precisa ser um objeto/);

// --- versão: futura é recusada antes de olhar os assets (nem caminho inválido aparece) ---
bad({ ...base(), schemaVersion: SCHEMA_VERSION + 1, assets: [asset({ path: '../x.png' })] }, /versão mais nova .*schema 2/);
bad({ ...base(), schemaVersion: 0 }, /"schemaVersion"/);
bad({ ...base(), schemaVersion: '1' }, /"schemaVersion"/);

// --- caminhos ---
bad(withAsset({ path: '../x.mp4' }), /asset 1 \(\.\.\/x\.mp4\): caminho inválido/);
bad(withAsset({ path: '/x.mp4' }), /caminho inválido/);
bad(withAsset({ path: 'a\\x.mp4' }), /caminho inválido/);
bad(withAsset({ path: 'meu loop.mp4' }), /caminho inválido/);
bad(withAsset({ path: 'assets/x.mp4' }), /caminho inválido/);          // relativo a assets/, sem o prefixo
bad({ ...base(), assets: [asset(), asset({ refId: 'bg', kind: 'bg' })] }, /asset 2 \(logo\.png\): caminho repetido/);

// --- tamanhos e limites ---
bad({ ...base(), assets: Array.from({ length: MAX_ASSETS + 1 }, (_, i) => asset({ path: `v${i}.mp4`, kind: 'video', mime: 'video/mp4', refId: `v${i}` })) }, /51 assets; máximo 50/);
assert.ok(validateManifest({ ...base(), assets: Array.from({ length: MAX_ASSETS }, (_, i) => asset({ path: `v${i}.mp4`, kind: 'video', mime: 'video/mp4', refId: `v${i}` })) }).ok);
bad({ ...base(), assets: [asset({ path: 'v0.mp4', kind: 'video', mime: 'video/mp4', refId: 'v0', bytes: 3 })] }, /máximo 0 MB/, { maxTotalBytes: 2 });
{
  // 4 vídeos de 600 MB = 2400 MB > 2 GiB (cada um dentro do teto do tipo; é o total que estoura)
  const vids = Array.from({ length: 4 }, (_, i) => asset({ path: `v${i}.mp4`, kind: 'video', mime: 'video/mp4', refId: `v${i}`, bytes: LIMITS.video }));
  bad({ ...base(), assets: vids }, /pacote grande demais .*máximo 2048 MB/);
  assert.ok(validateManifest({ ...base(), assets: vids.slice(0, 3) }).ok, '1800 MB passa');
  assert.equal(MAX_TOTAL_BYTES, 2147483648);
}
bad(withAsset({ kind: 'shader' as any }), /tipo desconhecido \(shader\)/);
bad(withAsset({ bytes: 0 }), /"bytes"/);
bad(withAsset({ bytes: 1.5 }), /"bytes"/);
bad(withAsset({ bytes: LIMITS.video + 1 }), /grande demais .*máximo 600 MB/);
bad({ ...base(), assets: [asset({ bytes: LIMITS.image + 1 })] }, /máximo 25 MB/);
bad(withAsset({ mime: 'image/png' }), /tipo não aceito \(image\/png\)/);           // mime de outro tipo
bad(withAsset({ mime: 'application/octet-stream' }), /"mime"/);                    // no manifesto o mime é obrigatório e real
bad(withAsset({ mime: '' }), /"mime"/);
bad(withAsset({ path: 'x.exe' }), /tipo não aceito \(\.exe\)/);
bad(withAsset({ path: 'x.png' }), /tipo não aceito \(\.png\); use mp4/);           // extensão de outro tipo
bad({ ...base(), assets: [asset({ path: 'f.mp3', kind: 'track', mime: 'audio/mpeg', refId: 'f.mp3' })] }, /"includeTracks" é false/);

// --- hashes ---
bad(withAsset({ sha256: 'abc' }), /"sha256" precisa ter 64/);
bad(withAsset({ sha256: 'g'.repeat(64) }), /"sha256"/);
bad(withAsset({ sha256: undefined }), /"sha256"/);

// --- referências ---
bad(withAsset({ refId: undefined }), /"refId" ausente/);
bad(withAsset({ refId: '' }), /"refId" ausente/);
bad(withAsset({ refId: 'a b' }), /"refId" ausente ou inválido/);
bad({ ...base(), assets: [asset({ refId: 'minha-logo' })] }, /"refId" de logo precisa ser "logo"/);
bad({ ...base(), assets: [asset(), asset({ path: 'logo2.png' })] }, /asset 2 \(logo2\.png\): "refId" repetido para o tipo logo/);
bad({ ...base(), assets: [withAsset({}).assets[0], withAsset({ path: 'y.mp4' }).assets[0]] }, /"refId" repetido para o tipo video \(v1\)/);

// --- ordem: com vários erros, o primeiro reportado segue a spec (caminho antes de tamanho antes de hash) ---
bad(withAsset({ path: '../x.mp4', bytes: 1e12, sha256: 'x' }), /caminho inválido/);
bad(withAsset({ bytes: 1e12, sha256: 'x' }), /grande demais/);
bad(withAsset({ sha256: 'x', refId: '' }), /"sha256"/);

console.log('showpack/manifest: ok');
