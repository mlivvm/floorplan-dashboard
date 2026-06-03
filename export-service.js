(function (global) {
  const FD = global.FD = global.FD || {};

  const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const TEXT_ENCODER = new TextEncoder();
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function safeFilePart(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'export';
  }

  function todayIso(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function compareDoorCodes(left, right) {
    return String(left || '').localeCompare(String(right || ''), 'nl', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  function floorplanKey(record) {
    return [
      record?.customer,
      record?.name || record?.floorplan,
      record?.repo === 'uploads' ? 'uploads' : 'gallery',
      record?.file,
    ].map(value => String(value || '')).join('\n');
  }

  function doorCode(door) {
    return String(door?.code || door?.doorId || '').trim();
  }

  function buildDoorcodeRows({ floorplans, doors }) {
    const doorRows = Array.isArray(doors) ? doors : [];
    const rows = [];
    (Array.isArray(floorplans) ? floorplans : []).forEach((floorplan, index) => {
      if (index > 0) rows.push([]);
      rows.push(['Klant', floorplan.customer || '']);
      rows.push(['Plattegrond', floorplan.displayName || floorplan.name || '']);
      rows.push([]);
      rows.push(['Deurcode']);

      const codes = doorRows
        .filter(door => floorplanKey(door) === floorplanKey(floorplan))
        .map(doorCode)
        .filter(Boolean)
        .sort(compareDoorCodes);

      if (codes.length) {
        codes.forEach(code => rows.push([code]));
      } else {
        rows.push(['Geen deurcodes gevonden']);
      }
    });
    return rows;
  }

  function columnName(index) {
    let n = index + 1;
    let name = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      name = String.fromCharCode(65 + r) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function worksheetXml(rows) {
    const sheetData = rows.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = (Array.isArray(row) ? row : []).map((value, colIndex) => {
        const ref = `${columnName(colIndex)}${rowNumber}`;
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
      }).join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetData}</sheetData>
</worksheet>`;
  }

  function workbookFiles(rows) {
    return {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Deurcodes" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
      'xl/worksheets/sheet1.xml': worksheetXml(rows),
    };
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = (date.getDate() || 1);
    const month = (date.getMonth() + 1);
    const dateValue = ((year - 1980) << 9) | (month << 5) | day;
    return { time, date: dateValue };
  }

  function writeUint16(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
  }

  function concat(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    parts.forEach(part => {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    const entries = Object.entries(files).map(([name, content]) => ({
      nameBytes: TEXT_ENCODER.encode(name),
      data: TEXT_ENCODER.encode(content),
    }));
    const stamp = dosDateTime();
    let offset = 0;

    entries.forEach(entry => {
      const crc = crc32(entry.data);
      const local = new Uint8Array(30 + entry.nameBytes.length);
      writeUint32(local, 0, 0x04034b50);
      writeUint16(local, 4, 20);
      writeUint16(local, 6, 0);
      writeUint16(local, 8, 0);
      writeUint16(local, 10, stamp.time);
      writeUint16(local, 12, stamp.date);
      writeUint32(local, 14, crc);
      writeUint32(local, 18, entry.data.length);
      writeUint32(local, 22, entry.data.length);
      writeUint16(local, 26, entry.nameBytes.length);
      writeUint16(local, 28, 0);
      local.set(entry.nameBytes, 30);
      localParts.push(local, entry.data);

      const central = new Uint8Array(46 + entry.nameBytes.length);
      writeUint32(central, 0, 0x02014b50);
      writeUint16(central, 4, 20);
      writeUint16(central, 6, 20);
      writeUint16(central, 8, 0);
      writeUint16(central, 10, 0);
      writeUint16(central, 12, stamp.time);
      writeUint16(central, 14, stamp.date);
      writeUint32(central, 16, crc);
      writeUint32(central, 20, entry.data.length);
      writeUint32(central, 24, entry.data.length);
      writeUint16(central, 28, entry.nameBytes.length);
      writeUint16(central, 30, 0);
      writeUint16(central, 32, 0);
      writeUint16(central, 34, 0);
      writeUint16(central, 36, 0);
      writeUint32(central, 38, 0);
      writeUint32(central, 42, offset);
      central.set(entry.nameBytes, 46);
      centralParts.push(central);
      offset += local.length + entry.data.length;
    });

    const centralDirectory = concat(centralParts);
    const end = new Uint8Array(22);
    writeUint32(end, 0, 0x06054b50);
    writeUint16(end, 4, 0);
    writeUint16(end, 6, 0);
    writeUint16(end, 8, entries.length);
    writeUint16(end, 10, entries.length);
    writeUint32(end, 12, centralDirectory.length);
    writeUint32(end, 16, offset);
    writeUint16(end, 20, 0);
    return concat([...localParts, centralDirectory, end]);
  }

  function createWorkbookBytes(rows) {
    return createZip(workbookFiles(rows));
  }

  function createWorkbookBlob(rows) {
    return new Blob([createWorkbookBytes(rows)], { type: MIME_XLSX });
  }

  function downloadBlob(blob, filename, documentEl = document) {
    const url = global.URL.createObjectURL(blob);
    const link = documentEl.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    documentEl.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => global.URL.revokeObjectURL(url), 1000);
  }

  function doorcodeFilename(floorplans, date = new Date()) {
    const list = Array.isArray(floorplans) ? floorplans : [];
    const first = list[0] || {};
    const customer = safeFilePart(first.customer || 'klant');
    const suffix = todayIso(date);
    if (list.length === 1) {
      return `deurcodes_${customer}_${safeFilePart(first.displayName || first.name || 'plattegrond')}_${suffix}.xlsx`;
    }
    return `deurcodes_${customer}_${suffix}.xlsx`;
  }

  function downloadDoorcodeWorkbook({ floorplans, doors, documentEl = document }) {
    const selectedFloorplans = Array.isArray(floorplans) ? floorplans : [];
    const rows = buildDoorcodeRows({ floorplans: selectedFloorplans, doors });
    const blob = createWorkbookBlob(rows.length ? rows : [['Geen plattegronden geselecteerd']]);
    const filename = doorcodeFilename(selectedFloorplans);
    downloadBlob(blob, filename, documentEl);
    return { filename, rows };
  }

  FD.ExportService = {
    buildDoorcodeRows,
    createWorkbookBlob,
    createWorkbookBytes,
    doorcodeFilename,
    downloadDoorcodeWorkbook,
    floorplanKey,
  };
})(window);
