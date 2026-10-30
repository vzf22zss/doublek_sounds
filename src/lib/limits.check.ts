// npm run check — limites de arquivo (DK-005): extensão, tamanho, tipo.
import assert from 'node:assert/strict';
import { checkFile, LIMITS, ext } from './limits.ts';

assert.equal(ext('a.b.MP3'), 'mp3');
assert.equal(ext('semext'), '');

assert.equal(checkFile('image', { name: 'logo.png', size: 1000, type: 'image/png' }), null);
assert.equal(checkFile('image', { name: 'logo.png', size: 1000, type: '' }), null);                        // tipo desconhecido: vale a extensão
assert.equal(checkFile('image', { name: 'logo.png', size: 1000, type: 'application/octet-stream' }), null);
assert.match(checkFile('image', { name: 'logo.exe', size: 1000, type: 'image/png' })!, /tipo não aceito \(\.exe\)/);
assert.match(checkFile('image', { name: 'logo.png', size: 1000, type: 'text/html' })!, /tipo não aceito \(text\/html\)/);
assert.match(checkFile('image', { name: 'logo.png', size: 0 })!, /vazio/);
assert.match(checkFile('image', { name: 'logo.png', size: LIMITS.image + 1 })!, /grande demais .*máximo 25 MB/);
assert.equal(checkFile('image', { name: 'logo.png', size: LIMITS.image }), null);

assert.equal(checkFile('video', { name: 'loop.webm', size: 5e6, type: 'video/webm' }), null);
assert.match(checkFile('video', { name: 'loop.avi', size: 5e6, type: 'video/x-msvideo' })!, /use mp4, webm/);
assert.equal(checkFile('audio', { name: 'faixa.m4a', size: 5e6, type: 'video/mp4' }), null);              // m4a às vezes vem como video/mp4
assert.match(checkFile('audio', { name: 'faixa.mp3', size: LIMITS.audio + 1, type: 'audio/mpeg' })!, /máximo 300 MB/);
assert.equal(checkFile('json', { name: 'preset.json', size: 100, type: 'application/json' }), null);
assert.equal(checkFile('json', { name: 'preset.json', size: 100, type: 'text/plain' }), null);
assert.match(checkFile('json', { name: 'preset.json', size: LIMITS.json + 1 })!, /máximo 2 MB/);
assert.match(checkFile('json', { name: 'preset.txt', size: 100 })!, /tipo não aceito/);

console.log('limits: ok');
