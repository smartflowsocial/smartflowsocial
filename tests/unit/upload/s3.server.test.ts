import type { FileUpload } from "@remix-run/form-data-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface EnvState {
  STORAGE_ACCESS_KEY: string | undefined;
  STORAGE_SECRET: string | undefined;
  STORAGE_REGION: string | undefined;
  STORAGE_BUCKET: string | undefined;
  STORAGE_CDN_URL: string | undefined;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  detectedMimeType?: string;
}

interface PutParams {
  Bucket: string;
  Key: string;
  Body: Buffer;
  ContentType: string;
  ServerSideEncryption: string;
  ACL: string;
  CacheControl: string;
}

interface S3Config {
  region: string | undefined;
  credentials: {
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  };
}

interface LogContext {
  message?: string;
  userId?: string;
  filename?: string;
  key?: string;
  bucket?: string;
}

interface UploadShape {
  name: string;
  type: string;
  stream: () => ReadableStream<Uint8Array>;
}

const envState = vi.hoisted(() => {
  const env: EnvState = {
    STORAGE_ACCESS_KEY: "access-key",
    STORAGE_SECRET: "secret-key",
    STORAGE_REGION: "eu-central-1",
    STORAGE_BUCKET: "media-bucket",
    STORAGE_CDN_URL: undefined,
  };
  return { env };
});

const validation = vi.hoisted(() => ({
  validateUpload: vi.fn(
    async (
      _buffer: Buffer,
      _filename: string,
      _contentType?: string
    ): Promise<ValidationResult> => ({
      valid: true,
      detectedMimeType: "image/png",
    })
  ),
  getS3ContentType: vi.fn((mime: string) =>
    mime === "image/jpg" ? "image/jpeg" : mime
  ),
}));

const logger = vi.hoisted(() => ({
  logError: vi.fn((_error: Error, _context?: LogContext) => undefined),
}));

const s3 = vi.hoisted(() => {
  const commands: PutParams[] = [];
  const clients: S3Config[] = [];
  const send = vi.fn(async (_command: PutParams) => ({ ok: true }));
  class S3Client {
    constructor(config: S3Config) {
      clients.push(config);
    }
    send = send;
  }
  class PutObjectCommand {
    constructor(input: PutParams) {
      commands.push(input);
    }
  }
  return { commands, clients, send, S3Client, PutObjectCommand };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: s3.S3Client,
  PutObjectCommand: s3.PutObjectCommand,
}));
vi.mock("uuid", () => ({ v4: () => "fixed-uuid" }));
vi.mock("~/lib/env.server", () => ({ env: envState.env }));
vi.mock("~/lib/error-logger.server", () => ({ logError: logger.logError }));
vi.mock("~/features/upload/validation.server", () => ({
  validateUpload: validation.validateUpload,
  getS3ContentType: validation.getS3ContentType,
}));

import {
  createS3Client,
  createUploadHandler,
  uploadBufferToS3,
  uploadEditorJSImage,
} from "~/features/upload/s3.server";

const CACHE_CONTROL = "public, max-age=31536000";

function isFileUpload(value: UploadShape): value is FileUpload {
  return typeof value.stream === "function";
}

function isLogContext(value: unknown): value is LogContext {
  return typeof value === "object" && value !== null && "message" in value;
}

function uploadFrom(
  name: string,
  type: string,
  chunks: Uint8Array[],
  explode?: "error" | "string"
): FileUpload {
  const candidate: UploadShape = {
    name,
    type,
    stream() {
      if (explode === "error") {
        throw new Error("stream broke");
      }
      if (explode === "string") {
        throw "stream string";
      }
      return new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
    },
  };
  if (!isFileUpload(candidate)) {
    throw new Error("expected upload");
  }
  return candidate;
}

function lastLog(): { error: Error; context: LogContext } {
  const call = logger.logError.mock.calls.at(-1);
  if (!call || !isLogContext(call[1])) {
    throw new Error("expected log context");
  }
  return { error: call[0], context: call[1] };
}

describe("s3 uploads", () => {
  beforeEach(() => {
    envState.env.STORAGE_ACCESS_KEY = "access-key";
    envState.env.STORAGE_SECRET = "secret-key";
    envState.env.STORAGE_REGION = "eu-central-1";
    envState.env.STORAGE_BUCKET = "media-bucket";
    envState.env.STORAGE_CDN_URL = undefined;
    validation.validateUpload.mockReset();
    validation.validateUpload.mockResolvedValue({
      valid: true,
      detectedMimeType: "image/png",
    });
    validation.getS3ContentType.mockClear();
    logger.logError.mockClear();
    s3.commands.length = 0;
    s3.clients.length = 0;
    s3.send.mockReset();
    s3.send.mockResolvedValue({ ok: true });
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("builds the client from storage env", () => {
    createS3Client();
    expect(s3.clients.at(-1)).toEqual({
      region: "eu-central-1",
      credentials: {
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
      },
    });
  });

  it("uploads a buffer with a generated key and a CDN url", async () => {
    envState.env.STORAGE_CDN_URL = "https://cdn.example.com///";
    const body = Buffer.from("png");
    const url = await uploadBufferToS3(
      body,
      "user-1",
      "Photo.PNG",
      undefined,
      "image/png"
    );
    expect(url).toBe(
      "https://cdn.example.com/clients/user-1/1700000000000-i.png"
    );
    expect(s3.commands).toHaveLength(1);
    expect(s3.commands[0]).toEqual({
      Bucket: "media-bucket",
      Key: "clients/user-1/1700000000000-i.png",
      Body: body,
      ContentType: "image/png",
      ServerSideEncryption: "AES256",
      ACL: "private",
      CacheControl: CACHE_CONTROL,
    });
    expect(validation.validateUpload).toHaveBeenCalledWith(
      body,
      "1700000000000-i.png",
      "image/png"
    );
  });

  it("uses a custom key, a blank filename, and the bucket url", async () => {
    const body = Buffer.from("jpg");
    const unnamed = await uploadBufferToS3(body, "user-1");
    expect(unnamed).toBe(
      "https://media-bucket.s3.eu-central-1.amazonaws.com/clients/user-1/1700000000000-i.jpg"
    );
    const custom = await uploadBufferToS3(
      body,
      "user-1",
      "archive.tar.gz",
      "custom/key.bin"
    );
    expect(custom).toBe(
      "https://media-bucket.s3.eu-central-1.amazonaws.com/custom/key.bin"
    );
    expect(s3.commands[1]?.Key).toBe("custom/key.bin");
    expect(validation.validateUpload.mock.calls[1]?.[1]).toBe(
      "1700000000000-i.gz"
    );
  });

  it("drops a blank CDN and an empty bucket from the public url", async () => {
    envState.env.STORAGE_CDN_URL = "   ";
    envState.env.STORAGE_BUCKET = "";
    envState.env.STORAGE_REGION = "";
    const url = await uploadBufferToS3(Buffer.from("a"), "user-1", "dot.");
    expect(url).toBe(
      "https://.s3..amazonaws.com/clients/user-1/1700000000000-i."
    );
  });

  it("normalizes jpg and rejects invalid buffers before talking to S3", async () => {
    validation.validateUpload.mockResolvedValueOnce({
      valid: true,
      detectedMimeType: "image/jpg",
    });
    await uploadBufferToS3(Buffer.from("a"), "user-1", "pic.jpg", "k.jpg");
    expect(s3.commands[0]?.ContentType).toBe("image/jpeg");

    validation.validateUpload.mockResolvedValueOnce({
      valid: false,
      error: "too big",
    });
    await expect(
      uploadBufferToS3(Buffer.from("a"), "user-1", "pic.jpg")
    ).rejects.toThrow("too big");

    validation.validateUpload.mockResolvedValueOnce({ valid: false });
    await expect(
      uploadBufferToS3(Buffer.from("a"), "user-1", "pic.jpg")
    ).rejects.toThrow("Upload validation failed");
    expect(s3.send).toHaveBeenCalledTimes(1);
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("logs buffer upload failures for Error and string throws", async () => {
    s3.send.mockRejectedValueOnce(new Error("s3 down"));
    await expect(
      uploadBufferToS3(Buffer.from("a"), "user-1", "pic.png", "custom.png")
    ).rejects.toThrow("s3 down");
    expect(lastLog().context).toEqual({
      userId: "user-1",
      filename: "1700000000000-i.png",
      key: "custom.png",
      message: "S3 buffer upload error",
    });

    s3.send.mockRejectedValueOnce("s3 string");
    await expect(uploadBufferToS3(Buffer.from("a"), "user-1")).rejects.toBe(
      "s3 string"
    );
    expect(lastLog().error).toEqual(new Error("s3 string"));
    expect(lastLog().context.message).toBe("S3 buffer upload error");
  });

  it("lets validateUpload throws escape the buffer helper", async () => {
    validation.validateUpload.mockRejectedValueOnce(new Error("detector down"));
    await expect(uploadBufferToS3(Buffer.from("a"), "user-1")).rejects.toThrow(
      "detector down"
    );
    validation.validateUpload.mockRejectedValueOnce("detector string");
    await expect(uploadBufferToS3(Buffer.from("a"), "user-1")).rejects.toBe(
      "detector string"
    );
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("streams file bytes and lowercases the extension", async () => {
    envState.env.STORAGE_CDN_URL = "https://cdn.example.com/";
    const handler = createUploadHandler("user-9");
    const url = await handler(
      uploadFrom("Photo.PNG", "image/png", [
        Buffer.from([1, 2]),
        Uint8Array.from([3]),
      ])
    );
    expect(url).toBe("https://cdn.example.com/clients/user-9/fixed-uuid.png");
    expect(s3.commands[0]?.Body).toEqual(Buffer.from([1, 2, 3]));
    expect(validation.validateUpload).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
      "Photo.PNG",
      "image/png"
    );
    expect(s3.clients[0]).toEqual({
      region: "eu-central-1",
      credentials: {
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
      },
    });
  });

  it("uses the whole token when a file has no dot and omits an empty type", async () => {
    const handler = createUploadHandler("user-9");
    const url = await handler(uploadFrom("README", "", [Uint8Array.from([4])]));
    expect(url).toBe(
      "https://media-bucket.s3.eu-central-1.amazonaws.com/clients/user-9/fixed-uuid.readme"
    );
    expect(validation.validateUpload.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("logs handler failures from validation, S3, and the stream", async () => {
    const handler = createUploadHandler("user-9");
    validation.validateUpload.mockResolvedValueOnce({
      valid: false,
      error: "bad type",
    });
    await expect(
      handler(uploadFrom("a.png", "image/png", [Uint8Array.from([1])]))
    ).rejects.toThrow("bad type");
    expect(lastLog().context).toEqual({
      userId: "user-9",
      filename: "a.png",
      message: "Upload handler error",
    });

    validation.validateUpload.mockResolvedValueOnce({ valid: false });
    await expect(
      handler(uploadFrom("a.png", "image/png", [Uint8Array.from([1])]))
    ).rejects.toThrow("Upload validation failed");

    s3.send.mockRejectedValueOnce(new Error("put failed"));
    await expect(
      handler(uploadFrom("a.png", "image/png", [Uint8Array.from([1])]))
    ).rejects.toThrow("put failed");
    expect(logger.logError.mock.calls.map((call) => call[1]?.message)).toEqual([
      "Upload handler error",
      "Upload handler error",
      "S3 upload error",
      "Upload handler error",
    ]);

    s3.send.mockRejectedValueOnce("put string");
    await expect(
      handler(uploadFrom("a.png", "image/png", [Uint8Array.from([1])]))
    ).rejects.toBe("put string");
    expect(lastLog().error).toEqual(new Error("put string"));

    await expect(
      handler(uploadFrom("a.png", "image/png", [], "error"))
    ).rejects.toThrow("stream broke");
    await expect(
      handler(uploadFrom("a.png", "image/png", [], "string"))
    ).rejects.toBe("stream string");
    expect(lastLog().error).toEqual(new Error("stream string"));
    expect(lastLog().context.message).toBe("Upload handler error");
  });

  it("uploads an editor image and wraps every failure", async () => {
    envState.env.STORAGE_CDN_URL = "https://cdn.example.com";
    const body = Buffer.from("edit");
    const url = await uploadEditorJSImage(body, "user-3", "Scan.JPEG");
    expect(url).toBe(
      "https://cdn.example.com/clients/user-3/editorjs/editorjs-1700000000000-i.jpeg"
    );
    expect(s3.commands[0]).toEqual({
      Bucket: "media-bucket",
      Key: "clients/user-3/editorjs/editorjs-1700000000000-i.jpeg",
      Body: body,
      ContentType: "image/png",
      ServerSideEncryption: "AES256",
      ACL: "private",
      CacheControl: CACHE_CONTROL,
    });
    expect(validation.validateUpload).toHaveBeenCalledWith(body, "Scan.JPEG");

    validation.validateUpload.mockResolvedValueOnce({
      valid: false,
      error: "too big",
    });
    await expect(
      uploadEditorJSImage(body, "user-3", "Scan.JPEG")
    ).rejects.toThrow("Failed to upload image: too big");
    expect(lastLog().context.message).toBe("EditorJS S3 upload error");

    const withoutExtension = await uploadEditorJSImage(body, "user-3", "noext");
    expect(withoutExtension).toContain(".noext");
    validation.validateUpload.mockResolvedValueOnce({ valid: false });
    await expect(uploadEditorJSImage(body, "user-3", "noext")).rejects.toThrow(
      "Failed to upload image: Upload validation failed"
    );

    s3.send.mockRejectedValueOnce(new Error("editor down"));
    await expect(uploadEditorJSImage(body, "user-3", "a.png")).rejects.toThrow(
      "Failed to upload image: editor down"
    );
    s3.send.mockRejectedValueOnce("editor string");
    await expect(uploadEditorJSImage(body, "user-3", "a.png")).rejects.toThrow(
      "Failed to upload image: editor string"
    );
    expect(lastLog().error).toEqual(new Error("editor string"));

    validation.validateUpload.mockRejectedValueOnce(new Error("detector down"));
    await expect(uploadEditorJSImage(body, "user-3", "a.png")).rejects.toThrow(
      "Failed to upload image: detector down"
    );
    validation.validateUpload.mockRejectedValueOnce("detector string");
    await expect(uploadEditorJSImage(body, "user-3", "a.png")).rejects.toThrow(
      "Failed to upload image: detector string"
    );
  });
});
