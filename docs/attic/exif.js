// Shows the "image information" for a photo by reading its EXIF data:
// the little block of text every camera and phone tucks inside a JPEG.
// It's the same thing a photo app shows when you tap "info".

(function () {
  'use strict';

  // The EXIF tags we care about (they're all plain text).
  const TAG = {
    LINK: 0x010D,     // DocumentName, used here as a "see also" link
    DATE: 0x0132,     // DateTime, written as "YYYY:MM:DD HH:MM:SS"
    ARTIST: 0x013B,   // Artist, i.e. who took the photo
  };

  const JPEG_START = 0xFFD8;
  const APP1 = 0xFFE1;              // the segment where EXIF lives
  const EXIF_SIGNATURE = 0x45786966; // the letters "Exif"
  const LITTLE_ENDIAN = 0x4949;     // "II", Intel byte order
  const TEXT_TYPE = 2;

  // Returns { tagNumber: "text value" } for every text tag in the photo.
  function readExif(buffer) {
    const bytes = new DataView(buffer);
    const tags = {};

    if (bytes.getUint16(0) !== JPEG_START) return tags;

    // A JPEG is a list of segments: [marker][length][data]. Walk them until we find EXIF.
    let pos = 2;
    while (pos + 4 < bytes.byteLength) {
      const marker = bytes.getUint16(pos);
      const length = bytes.getUint16(pos + 2);

      if (marker === APP1 && bytes.getUint32(pos + 4) === EXIF_SIGNATURE) {
        return readTextTags(bytes, pos + 10, tags);
      }
      if ((marker & 0xFF00) !== 0xFF00) break; // not a marker; give up
      pos += 2 + length;
    }

    return tags;
  }

  // Inside the EXIF segment is a small TIFF file. Its first directory lists the tags.
  function readTextTags(bytes, tiffStart, tags) {
    const littleEndian = bytes.getUint16(tiffStart) === LITTLE_ENDIAN;
    const read16 = (offset) => bytes.getUint16(tiffStart + offset, littleEndian);
    const read32 = (offset) => bytes.getUint32(tiffStart + offset, littleEndian);

    const directory = read32(4);
    const entryCount = read16(directory);

    for (let i = 0; i < entryCount; i++) {
      const entry = directory + 2 + i * 12;
      const tag = read16(entry);
      const type = read16(entry + 2);
      const length = read32(entry + 4);
      if (type !== TEXT_TYPE) continue;

      // Short values sit right in the entry; longer ones live elsewhere, at an offset.
      const valueAt = length > 4 ? read32(entry + 8) : entry + 8;
      let text = '';
      for (let k = 0; k < length - 1; k++) { // the last byte is a terminating zero
        text += String.fromCharCode(bytes.getUint8(tiffStart + valueAt + k));
      }
      tags[tag] = text;
    }

    return tags;
  }

  function escapeHtml(text) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(text).replace(/[&<>"]/g, (char) => entities[char]);
  }

  // "2018:09:22 18:47:10" becomes "2018-09-22 18:47". Anything else is shown as written.
  function formatDate(exifDate) {
    const match = /^(\d{4}):(\d\d):(\d\d) (\d\d:\d\d)/.exec(exifDate || '');
    if (!match) return exifDate;
    const [, year, month, day, time] = match;
    return `${year}-${month}-${day} ${time}`;
  }

  function link(href) {
    return `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
  }


  const photo = document.querySelector('.photo');
  const table = document.getElementById('exif');
  const file = photo.getAttribute('src');

  fetch(file)
    .then((response) => response.arrayBuffer())
    .then((buffer) => {
      const tags = readExif(buffer);

      const rows = [
        ['File', link(file)],
        ['Size', buffer.byteLength.toLocaleString() + ' bytes'],
        ['Dimensions', (photo.naturalWidth || photo.width) + ' × ' + (photo.naturalHeight || photo.height)],
        ['Date taken', escapeHtml(formatDate(tags[TAG.DATE]))],
        ['Artist', escapeHtml(tags[TAG.ARTIST] || '')],
      ];
      if (tags[TAG.LINK]) {
        rows.push(['See also', link(tags[TAG.LINK])]);
      }

      table.innerHTML = rows
        .filter(([, value]) => value)
        .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
        .join('');
    })
    .catch(() => {
      table.innerHTML = '<tr><td>this file won’t open here.</td></tr>';
    });
})();
