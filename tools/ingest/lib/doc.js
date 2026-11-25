// The text of an old binary Word file (.doc, Word 97-2003), without
// dependencies: the compound file's streams, then the document's pieces
// (the piece table in the Clx, found through the FIB). Formatting is not
// read, so sub/superscripts come out as plain characters.

function readCfb(buf) {
  if (buf.readUInt32LE(0) !== 0xe011cfd0) throw new Error('not a compound file');
  const secSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readInt32LE(60);
  let difatStart = buf.readInt32LE(68);
  const sector = (n) => buf.subarray(512 + n * secSize, 512 + (n + 1) * secSize);
  // The FAT's sectors: 109 listed in the header, the rest in the DIFAT chain.
  const fatSecs = [];
  for (let i = 0; i < 109; i++) { const s = buf.readInt32LE(76 + i * 4); if (s >= 0) fatSecs.push(s); }
  while (difatStart >= 0) {
    const d = sector(difatStart);
    for (let i = 0; i < secSize / 4 - 1; i++) { const s = d.readInt32LE(i * 4); if (s >= 0) fatSecs.push(s); }
    difatStart = d.readInt32LE(secSize - 4);
  }
  const fat = [];
  fatSecs.forEach((s) => { const d = sector(s); for (let i = 0; i < secSize / 4; i++) fat.push(d.readInt32LE(i * 4)); });
  const chain = (start, table, get) => {
    const parts = [];
    for (let s = start, guard = 0; s >= 0 && guard < 1e6; s = table[s], guard++) parts.push(get(s));
    return Buffer.concat(parts);
  };
  const dir = chain(dirStart, fat, sector);
  const entries = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameLen = dir.readUInt16LE(at + 64);
    entries.push({
      name: dir.toString('utf16le', at, at + Math.max(0, nameLen - 2)),
      type: dir[at + 66],
      start: dir.readInt32LE(at + 116),
      size: dir.readUInt32LE(at + 120),
    });
  }
  const root = entries[0];
  const miniStream = chain(root.start, fat, sector);
  const miniFat = [];
  if (miniFatStart >= 0) {
    const d = chain(miniFatStart, fat, sector);
    for (let i = 0; i < d.length / 4; i++) miniFat.push(d.readInt32LE(i * 4));
  }
  return (name) => {
    const e = entries.find((x) => x.name === name && x.type === 2);
    if (!e) return null;
    const data = e.size < miniCutoff
      ? chain(e.start, miniFat, (n) => miniStream.subarray(n * miniSize, (n + 1) * miniSize))
      : chain(e.start, fat, sector);
    return data.subarray(0, e.size);
  };
}

function docText(buf) {
  const stream = readCfb(buf);
  const word = stream('WordDocument');
  if (!word || word.readUInt16LE(0) !== 0xa5ec) throw new Error('not a Word document');
  const table = stream(word.readUInt16LE(0x0a) & 0x0200 ? '1Table' : '0Table');
  const fcClx = word.readUInt32LE(0x1a2);
  const lcbClx = word.readUInt32LE(0x1a6);
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  let at = 0;
  while (clx[at] === 0x01) at += 3 + clx.readUInt16LE(at + 1); // Prc: formatting, skipped
  if (clx[at] !== 0x02) throw new Error('no piece table');
  const lcb = clx.readUInt32LE(at + 1);
  const plc = clx.subarray(at + 5, at + 5 + lcb);
  const n = (lcb - 4) / 12;
  let text = '';
  for (let i = 0; i < n; i++) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    let fc = plc.readUInt32LE((n + 1) * 4 + i * 8 + 2);
    const compressed = (fc & 0x40000000) !== 0;
    const len = cpEnd - cpStart;
    if (compressed) {
      fc = (fc & ~0x40000000) >>> 1;
      text += Buffer.from(word.subarray(fc, fc + len)).toString('latin1')
        .replace(/[\x80-\x9f]/g, (ch) => ({ '\x91': '‘', '\x92': '’', '\x93': '“', '\x94': '”', '\x96': '–', '\x97': '—', '\x85': '…', '\x95': '•' }[ch] || ch));
    } else {
      text += word.toString('utf16le', fc, fc + len * 2);
    }
  }
  // Field codes keep only their result; paragraph, line and cell marks
  // become line breaks and tabs.
  return text
    .replace(/\x13[^\x13\x14\x15]*\x14([^\x13\x14\x15]*)\x15/g, '$1')
    .replace(/\x13[^\x13\x14\x15]*\x15/g, '')
    .replace(/[\r\x0b\x0c]/g, '\n')
    .replace(/\x07/g, '\t')
    .replace(/[\x00-\x08\x0e-\x1f]/g, '');
}

module.exports = { docText };
