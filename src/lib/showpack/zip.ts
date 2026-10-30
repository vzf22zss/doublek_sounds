// Escritor de ZIP mínimo (DK-012): método STORE (sem compressão — mídia já vem comprimida e JSON é pequeno),
// CRC-32, cabeçalho local, diretório central e EOCD. Sem dependência, roda no Node e no WebView2.
// Limite: sem ZIP64, então cada arquivo e o total precisam ficar < 4 GiB (o manifesto já limita a 2 GiB).
// Leitor (DK-013): só STORE, só o que o escritor produz; recusa ZIP64, descritor de dados e nome perigoso.

export type ZipEntry = { path: string; data: Uint8Array };

const TABLE = new Uint32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function crc32(d: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < d.length; i++) c = TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Data/hora no formato DOS do ZIP (resolução de 2 s, sem fuso). */
function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const MAX32 = 0xffffffff;

/** Monta o ZIP. Lança se algum nome for repetido/vazio ou se passar de 4 GiB (sem ZIP64). */
export function writeZip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder(), { time, date } = dosTime(when);
  const names = new Set<string>();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    if (!e.path || names.has(e.path)) throw new Error(`zip: nome de arquivo vazio ou repetido (${e.path})`);
    names.add(e.path);
    if (e.data.length > MAX32) throw new Error(`zip: arquivo acima de 4 GiB (${e.path})`);
    const name = enc.encode(e.path), crc = crc32(e.data), size = e.data.length;

    // cabeçalho local (30 bytes) + nome + dados
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);        // versão necessária: 2.0
    lh.setUint16(6, 0x0800, true);    // bit 11: nomes em UTF-8
    lh.setUint16(8, 0, true);         // método: STORE
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, e.data);

    // entrada do diretório central (46 bytes) + nome
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);        // feito por: 2.0
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);        // extra
    ch.setUint16(32, 0, true);        // comentário
    ch.setUint16(34, 0, true);        // disco
    ch.setUint16(36, 0, true);        // atributos internos
    ch.setUint32(38, 0, true);        // atributos externos
    ch.setUint32(42, offset, true);   // posição do cabeçalho local
    centrals.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + size;
    if (offset > MAX32) throw new Error('zip: pacote acima de 4 GiB');
  }

  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);   // início do diretório central
  eocd.setUint16(20, 0, true);

  const parts = [...locals, ...centrals, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let pos = 0;
  for (const b of parts) { out.set(b, pos); pos += b.length; }
  return out;
}

const MAX_EOCD_SCAN = 22 + 0xffff; // EOCD + comentário máximo

/** Nome de entrada aceitável: relativo, com `/`, sem `\`, sem `..`, sem unidade, sem controle. */
export function safeZipName(n: string): boolean {
  return n.length > 0 && n.length <= 512 && !/[\\\x00-\x1f]/.test(n) && !n.startsWith('/') && !/^[A-Za-z]:/.test(n)
    && n.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Lê um ZIP STORE. Lança Error (em português) em qualquer inconsistência; nunca devolve dados parciais. */
export function readZip(z: Uint8Array): ZipEntry[] {
  const bad = (m: string) => new Error(`arquivo .doublekshow inválido: ${m}`);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength), dec = new TextDecoder();
  const u16 = (p: number) => dv.getUint16(p, true), u32 = (p: number) => dv.getUint32(p, true);
  if (z.length < 22) throw bad('arquivo pequeno demais');

  let eocd = z.length - 22;
  const stop = Math.max(0, z.length - MAX_EOCD_SCAN);
  while (eocd >= stop && u32(eocd) !== 0x06054b50) eocd--;
  if (eocd < stop) throw bad('fim do ZIP não encontrado');
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) throw bad('ZIP em vários volumes não é aceito');
  const count = u16(eocd + 10), cdSize = u32(eocd + 12), cdOff = u32(eocd + 16);
  if (count === 0xffff || u16(eocd + 8) === 0xffff || cdSize === MAX32 || cdOff === MAX32 || (eocd >= 20 && u32(eocd - 20) === 0x07064b50)) throw bad('ZIP64 não é aceito');
  if (u16(eocd + 8) !== count) throw bad('contagem de entradas inconsistente');
  if (cdOff + cdSize !== eocd) throw bad('diretório central fora do lugar');

  const out: ZipEntry[] = [], names = new Set<string>();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50) throw bad('diretório central corrompido');
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), csize = u32(p + 20), size = u32(p + 24);
    const nlen = u16(p + 28), elen = u16(p + 30), clen = u16(p + 32), lo = u32(p + 42);
    if (p + 46 + nlen + elen + clen > eocd) throw bad('diretório central corrompido');
    const name = dec.decode(z.subarray(p + 46, p + 46 + nlen));
    if (!safeZipName(name)) throw bad(`nome de arquivo perigoso (${name})`);
    if (names.has(name)) throw bad(`arquivo repetido (${name})`);
    if (method !== 0) throw bad(`compressão não é aceita (${name}); o pacote usa só STORE`);
    if (flags & 0x0008) throw bad(`descritor de dados não é aceito (${name})`);
    if (flags & 0x0001) throw bad(`arquivo com senha não é aceito (${name})`);
    if (csize !== size) throw bad(`tamanhos inconsistentes (${name})`);
    if (lo + 30 > cdOff || u32(lo) !== 0x04034b50) throw bad(`cabeçalho local corrompido (${name})`);
    if (u16(lo + 8) !== 0 || u32(lo + 18) !== size || u32(lo + 22) !== size) throw bad(`cabeçalho local inconsistente (${name})`);
    const lnlen = u16(lo + 26), lelen = u16(lo + 28);
    if (dec.decode(z.subarray(lo + 30, lo + 30 + lnlen)) !== name) throw bad(`nome inconsistente (${name})`);
    const start = lo + 30 + lnlen + lelen;
    if (start + size > cdOff) throw bad(`dados fora do arquivo (${name})`);
    const data = z.subarray(start, start + size);
    if (crc32(data) !== crc) throw bad(`conteúdo corrompido (${name})`);
    names.add(name);
    out.push({ path: name, data });
    p += 46 + nlen + elen + clen;
  }
  if (p !== eocd) throw bad('tamanho do diretório central inconsistente');
  return out;
}
