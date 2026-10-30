// Escritor de ZIP mínimo (DK-012): método STORE (sem compressão — mídia já vem comprimida e JSON é pequeno),
// CRC-32, cabeçalho local, diretório central e EOCD. Sem dependência, roda no Node e no WebView2.
// Limite: sem ZIP64, então cada arquivo e o total precisam ficar < 4 GiB (o manifesto já limita a 2 GiB).
// ponytail: só escreve; o leitor do pacote é da DK-013.

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
