import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { providerFetch } from '../../lib/providerHttp.js';

type S3StorageConfig = {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  verifyUploadSha256: boolean;
};

const sanitizeFilename = (value: string) => {
  const basename = path.basename(value).trim();
  const sanitized = basename
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  return sanitized || 'upload.bin';
};

const hashSha256 = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value).digest();

const hmacHex = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value).digest('hex');

const encodePathSegment = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

const buildCanonicalPath = (bucket: string, storageKey: string) =>
  `/${[bucket, ...storageKey.split('/').filter(Boolean)].map(encodePathSegment).join('/')}`;

const toAmzDate = (date: Date) => {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
};

const normalizeEndpoint = (endpoint: string) =>
  endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;

export class S3DocumentStorage {
  public readonly driverCode = 's3' as const;

  public constructor(private readonly config: S3StorageConfig) {}

  public buildStorageKey(ownerAccountPublicId: string, documentPublicId: string, fileName: string) {
    const safeOwner = ownerAccountPublicId.replace(/[^A-Za-z0-9_-]+/g, '-');
    const safeDate = new Date().toISOString().slice(0, 10);
    return path.posix.join(safeOwner, safeDate, `${documentPublicId}-${sanitizeFilename(fileName)}`);
  }

  public async ensureReady() {
    if (!this.config.endpoint || !this.config.bucket) {
      throw new Error('S3 storage requires endpoint and bucket configuration.');
    }
  }

  public getAbsolutePath(storageKey: string) {
    return `${normalizeEndpoint(this.config.endpoint)}/${this.config.bucket}/${storageKey}`;
  }

  public async writeBuffer(storageKey: string, content: Buffer) {
    await this.request('PUT', storageKey, content);

    if (this.config.verifyUploadSha256) {
      const stored = await this.readBuffer(storageKey);
      if (hashSha256(stored) !== hashSha256(content)) {
        throw new Error('S3 upload SHA-256 verification failed.');
      }
    }

    return this.getAbsolutePath(storageKey);
  }

  public async readBuffer(storageKey: string) {
    const response = await this.request('GET', storageKey);
    return Buffer.from(await response.arrayBuffer());
  }

  private async request(method: 'GET' | 'PUT', storageKey: string, body?: Buffer) {
    const endpoint = normalizeEndpoint(this.config.endpoint);
    const canonicalUri = buildCanonicalPath(this.config.bucket, storageKey);
    const url = new URL(`${endpoint}${canonicalUri}`);
    const payloadHash = body ? hashSha256(body) : hashSha256('');
    const { amzDate, dateStamp } = toAmzDate(new Date());
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };

    if (this.config.sessionToken) {
      headers['x-amz-security-token'] = this.config.sessionToken;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      hashSha256(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.config.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmacHex(signingKey, stringToSign);

    const requestBody = body ? new Blob([new Uint8Array(body)]) : undefined;
    const response = await providerFetch(url, {
      body: requestBody,
      headers: {
        ...headers,
        authorization:
          `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        ...(body ? { 'content-type': 'application/octet-stream' } : {}),
      },
      method,
      operation: `s3_document_${method.toLowerCase()}`,
      providerCode: 's3',
      retryDelayMs: 250,
      safeToRetry: method === 'GET',
    });

    if (!response.ok) {
      const safeBody = (await response.text()).slice(0, 500);
      throw new Error(`S3 ${method} failed with ${response.status}: ${safeBody}`);
    }

    return response;
  }
}
