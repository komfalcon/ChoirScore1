import Busboy from 'busboy';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Request } from 'express';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { MAX_MUSICXML_BYTES } from '@choirscore/shared';

export const MAX_UPLOAD_BYTES = MAX_MUSICXML_BYTES;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;
const MAX_MXL_ENTRIES = 256;
const MAX_MXL_EXPANDED_BYTES = MAX_MUSICXML_BYTES * 2;
const MAX_CONTAINER_BYTES = 64 * 1024;
const CONTAINER_PATH = 'META-INF/container.xml';

export class ScoreImportFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ScoreImportFailure';
  }
}

export interface MultipartScoreUpload {
  fileName: string;
  fileBytes: Buffer;
  fields: Record<string, string>;
}

const containerParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

export async function readMultipartScoreUpload(
  request: Request
): Promise<MultipartScoreUpload> {
  const contentLength = Number(request.get('content-length'));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD
  ) {
    throw new ScoreImportFailure(
      413,
      'BODY_TOO_LARGE',
      'The uploaded score exceeds the 6 MiB limit.'
    );
  }

  return await new Promise<MultipartScoreUpload>((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fileSize: MAX_UPLOAD_BYTES,
          files: 1,
          fields: 8,
          fieldSize: 4096,
          parts: 10,
          headerPairs: 2000,
        },
      });
    } catch {
      reject(
        new ScoreImportFailure(
          400,
          'VALIDATION_ERROR',
          'A valid multipart score upload is required.'
        )
      );
      return;
    }

    const fields: Record<string, string> = {};
    let fileName: string | undefined;
    let fileBytes: Buffer | undefined;
    let failure: ScoreImportFailure | undefined;
    let receivedBytes = 0;
    const fail = (error: ScoreImportFailure) => {
      failure ??= error;
    };

    request.on('data', (chunk: Buffer | string) => {
      receivedBytes += Buffer.isBuffer(chunk)
        ? chunk.byteLength
        : Buffer.byteLength(chunk);
      if (receivedBytes > MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD) {
        fail(
          new ScoreImportFailure(
            413,
            'BODY_TOO_LARGE',
            'The multipart score request exceeds the permitted size.'
          )
        );
      }
    });

    parser.on('field', (name, value, info) => {
      if (info.nameTruncated || info.valueTruncated) {
        fail(
          new ScoreImportFailure(
            400,
            'VALIDATION_ERROR',
            'A multipart field is too large.'
          )
        );
        return;
      }
      if (Object.hasOwn(fields, name)) {
        fail(
          new ScoreImportFailure(
            400,
            'VALIDATION_ERROR',
            'Multipart fields must not be repeated.'
          )
        );
        return;
      }
      fields[name] = value;
    });

    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'file' || fileName !== undefined) {
        fail(
          new ScoreImportFailure(
            400,
            'VALIDATION_ERROR',
            'Exactly one file field named file is required.'
          )
        );
        stream.resume();
        return;
      }
      fileName = info.filename;
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      stream.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bytes.byteLength;
        if (totalBytes <= MAX_UPLOAD_BYTES) chunks.push(bytes);
      });
      stream.on('limit', () => {
        fail(
          new ScoreImportFailure(
            413,
            'BODY_TOO_LARGE',
            'The uploaded score exceeds the 6 MiB limit.'
          )
        );
      });
      stream.on('error', () => {
        fail(
          new ScoreImportFailure(
            400,
            'VALIDATION_ERROR',
            'The multipart file stream could not be read.'
          )
        );
      });
      stream.on('end', () => {
        if (!stream.truncated) fileBytes = Buffer.concat(chunks, totalBytes);
      });
    });

    parser.on('filesLimit', () =>
      fail(
        new ScoreImportFailure(
          400,
          'VALIDATION_ERROR',
          'Exactly one score file is allowed.'
        )
      )
    );
    parser.on('fieldsLimit', () =>
      fail(
        new ScoreImportFailure(
          400,
          'VALIDATION_ERROR',
          'Too many multipart fields were supplied.'
        )
      )
    );
    parser.on('partsLimit', () =>
      fail(
        new ScoreImportFailure(
          400,
          'VALIDATION_ERROR',
          'Too many multipart parts were supplied.'
        )
      )
    );
    parser.on('error', () =>
      fail(
        new ScoreImportFailure(
          400,
          'VALIDATION_ERROR',
          'The multipart request is malformed.'
        )
      )
    );
    parser.on('finish', () => {
      if (failure) {
        reject(failure);
      } else if (!fileName || !fileBytes) {
        reject(
          new ScoreImportFailure(
            400,
            'VALIDATION_ERROR',
            'The multipart request must contain a non-empty file field named file.'
          )
        );
      } else {
        resolve({ fileName, fileBytes, fields });
      }
    });

    request.pipe(parser);
  });
}

export function decodeMusicXml(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ScoreImportFailure(
      400,
      'MALFORMED_XML',
      'The score file must contain valid UTF-8 MusicXML.'
    );
  }
}

export async function extractMxlMusicXml(
  archiveBytes: Buffer
): Promise<string> {
  const zip = await openZip(archiveBytes);
  try {
    const entries = await listSafeEntries(zip);
    const containerEntries = entries.filter(
      (entry) =>
        entry.fileName === CONTAINER_PATH && !entry.fileName.endsWith('/')
    );
    if (containerEntries.length === 0) {
      throw new ScoreImportFailure(
        400,
        'MISSING_CONTAINER_XML',
        'The compressed MusicXML archive has no META-INF/container.xml.'
      );
    }
    if (containerEntries.length !== 1) {
      throw invalidArchive();
    }

    const containerBytes = await readEntry(
      zip,
      containerEntries[0]!,
      MAX_CONTAINER_BYTES
    );
    const containerXml = decodeMusicXml(containerBytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(containerXml)) {
      throw new ScoreImportFailure(
        400,
        'DOCTYPE_NOT_ALLOWED',
        'DTD declarations are not allowed in the MXL container.'
      );
    }
    if (
      XMLValidator.validate(containerXml, { allowBooleanAttributes: false }) !==
      true
    ) {
      throw new ScoreImportFailure(
        400,
        'MISSING_CONTAINER_XML',
        'The MXL container document is malformed.'
      );
    }

    let parsed: unknown;
    try {
      parsed = containerParser.parse(containerXml);
    } catch {
      throw new ScoreImportFailure(
        400,
        'MISSING_CONTAINER_XML',
        'The MXL container document is malformed.'
      );
    }
    const root = parsed as {
      container?: {
        rootfiles?: { rootfile?: unknown | unknown[] };
      };
    };
    const rootfilesValue = root.container?.rootfiles?.rootfile;
    const rootfiles = Array.isArray(rootfilesValue)
      ? rootfilesValue
      : rootfilesValue
        ? [rootfilesValue]
        : [];
    const candidates = rootfiles.filter(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        typeof (candidate as Record<string, unknown>)['@_full-path'] ===
          'string'
    ) as Array<Record<string, unknown>>;
    const rootfile =
      candidates.find(
        (candidate) =>
          candidate['@_media-type'] === 'application/vnd.recordare.musicxml+xml'
      ) ?? (candidates.length === 1 ? candidates[0] : undefined);
    const rootPath = rootfile?.['@_full-path'];
    if (typeof rootPath !== 'string' || !isSafeArchivePath(rootPath, false)) {
      throw new ScoreImportFailure(
        400,
        'UNSAFE_CONTAINER_PATH',
        'The MXL container points to an unsafe score path.'
      );
    }
    const scoreEntries = entries.filter(
      (entry) => entry.fileName === rootPath && !entry.fileName.endsWith('/')
    );
    if (scoreEntries.length !== 1) {
      throw new ScoreImportFailure(
        400,
        'UNSAFE_CONTAINER_PATH',
        'The MXL container does not identify exactly one score file.'
      );
    }
    const musicXmlBytes = await readEntry(
      zip,
      scoreEntries[0]!,
      MAX_MUSICXML_BYTES
    );
    return decodeMusicXml(musicXmlBytes);
  } finally {
    try {
      zip.close();
    } catch {
      // Preserve the original validation or decompression result.
    }
  }
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zip) => {
        if (error || !zip) reject(invalidArchive());
        else resolve(zip);
      }
    );
  });
}

function listSafeEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    const seenNames = new Set<string>();
    let expandedBytes = 0;
    zip.on('error', () => reject(invalidArchive()));
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName;
      if (
        !isSafeArchivePath(name, name.endsWith('/')) ||
        seenNames.has(name) ||
        isSymbolicLink(entry)
      ) {
        reject(invalidArchive());
        return;
      }
      seenNames.add(name);
      if (!name.endsWith('/')) expandedBytes += entry.uncompressedSize;
      if (
        entries.length >= MAX_MXL_ENTRIES ||
        expandedBytes > MAX_MXL_EXPANDED_BYTES ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0
      ) {
        reject(invalidArchive());
        return;
      }
      entries.push(entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.readEntry();
  });
}

function isSafeArchivePath(name: string, allowDirectory: boolean): boolean {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(name) ||
    name.startsWith('//')
  ) {
    return false;
  }
  const normalized = allowDirectory ? name.replace(/\/$/, '') : name;
  if (!normalized) return false;
  const components = normalized.split('/');
  return components.every(
    (component) =>
      component.length > 0 && component !== '.' && component !== '..'
  );
}

function isSymbolicLink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

function readEntry(
  zip: ZipFile,
  entry: Entry,
  byteLimit: number
): Promise<Buffer> {
  if (entry.uncompressedSize > byteLimit) {
    throw new ScoreImportFailure(
      400,
      entry.fileName === CONTAINER_PATH
        ? 'MISSING_CONTAINER_XML'
        : 'INVALID_MXL_ARCHIVE',
      'An MXL archive entry exceeds its permitted decompressed size.'
    );
  }
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(invalidArchive());
        return;
      }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > byteLimit) {
          stream.destroy();
          reject(invalidArchive());
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', () => reject(invalidArchive()));
      stream.on('end', () => {
        if (totalBytes !== entry.uncompressedSize) reject(invalidArchive());
        else resolve(Buffer.concat(chunks, totalBytes));
      });
    });
  });
}

function invalidArchive(): ScoreImportFailure {
  return new ScoreImportFailure(
    400,
    'INVALID_MXL_ARCHIVE',
    'The compressed MusicXML archive is invalid or unsafe.'
  );
}
