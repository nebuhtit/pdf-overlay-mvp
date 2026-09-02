type ZipEntry = {
  blob: Blob;
  fileName: string;
};

const textEncoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = async (blob: Blob) => {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let index = 0; index < value.length; index += 1) {
      crc = crcTable[(crc ^ value[index]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const zipDateTime = (date: Date) => ({
  date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
});

const uniqueFileNames = (entries: ZipEntry[]) => {
  const used = new Set<string>();
  return entries.map((entry) => {
    const safeName = entry.fileName.replace(/[\\/]/g, '-');
    const extensionIndex = safeName.lastIndexOf('.');
    const base = extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
    const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : '';
    let fileName = safeName;
    let suffix = 2;
    while (used.has(fileName.toLocaleLowerCase())) {
      fileName = `${base} (${suffix})${extension}`;
      suffix += 1;
    }
    used.add(fileName.toLocaleLowerCase());
    return { ...entry, fileName };
  });
};

export const createZipBlob = async (sourceEntries: ZipEntry[]) => {
  const entries = uniqueFileNames(sourceEntries);
  if (entries.length > 0xffff) throw new Error('Слишком много файлов для одного ZIP');
  const bodyParts: BlobPart[] = [];
  const directoryParts: BlobPart[] = [];
  const { date, time } = zipDateTime(new Date());
  let offset = 0;
  let directorySize = 0;

  for (const entry of entries) {
    if (entry.blob.size > 0xffffffff || offset > 0xffffffff) {
      throw new Error('ZIP больше 4 ГБ не поддерживается');
    }

    const fileName = textEncoder.encode(entry.fileName);
    if (fileName.byteLength > 0xffff) throw new Error('Слишком длинное имя файла');
    const checksum = await crc32(entry.blob);
    const localHeader = new ArrayBuffer(30);
    const local = new DataView(localHeader);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, entry.blob.size, true);
    local.setUint32(22, entry.blob.size, true);
    local.setUint16(26, fileName.byteLength, true);
    local.setUint16(28, 0, true);
    bodyParts.push(localHeader, fileName, entry.blob);

    const centralHeader = new ArrayBuffer(46);
    const central = new DataView(centralHeader);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, entry.blob.size, true);
    central.setUint32(24, entry.blob.size, true);
    central.setUint16(28, fileName.byteLength, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    directoryParts.push(centralHeader, fileName);

    offset += localHeader.byteLength + fileName.byteLength + entry.blob.size;
    directorySize += centralHeader.byteLength + fileName.byteLength;
  }

  if (offset + directorySize + 22 > 0xffffffff) {
    throw new Error('ZIP больше 4 ГБ не поддерживается');
  }

  const endRecord = new ArrayBuffer(22);
  const end = new DataView(endRecord);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...bodyParts, ...directoryParts, endRecord], { type: 'application/zip' });
};
