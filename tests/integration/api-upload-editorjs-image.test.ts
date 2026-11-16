import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("~/features/user", () => ({
  loadUploadProviderSettings: vi.fn(),
}));

vi.mock("~/features/upload/image-resize.server", () => ({
  processImageForWeb: vi.fn(),
  validateImageBuffer: vi.fn(),
  getImageInfo: vi.fn(),
}));

vi.mock("~/features/upload/s3.server", () => ({
  uploadEditorJSImage: vi.fn(),
}));

vi.mock("@remix-run/form-data-parser", () => ({
  parseFormData: vi.fn(async () => {
    const formData = new FormData();
    formData.append("image", "https://cdn.example.com/default.jpg");
    return formData;
  }),
}));

import { asRouteResponse } from "../utils/action-test-helpers";

import { requireUserId } from "~/features/auth";
import {
  processImageForWeb,
  validateImageBuffer,
  getImageInfo,
} from "~/features/upload/image-resize.server";
import { uploadEditorJSImage } from "~/features/upload/s3.server";
import { loadUploadProviderSettings } from "~/features/user";
import { action, loader } from "~/routes/api.upload-editorjs-image";

describe("API: Upload EditorJS Image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue("user-1");
    (validateImageBuffer as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getImageInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      width: 100,
      height: 100,
      format: "jpeg",
    });
    (processImageForWeb as ReturnType<typeof vi.fn>).mockResolvedValue(
      Buffer.from("processed-image")
    );
    (uploadEditorJSImage as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://s3.example.com/editorjs.jpg"
    );
  });

  it("accepts Blossom JSON payload with pre-uploaded URL", async () => {
    (loadUploadProviderSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "BLOSSOM_SFS",
    });

    const request = new Request(
      "http://localhost:3000/api/upload-editorjs-image",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: "https://blossom.smartflow.social/media/editor.jpg",
        }),
      }
    );

    const response = await action({ request, params: {}, context: {} });
    const responseObj = await asRouteResponse(response);
    const data = (await responseObj.json()) as {
      success?: number;
      file?: { url?: string };
    };

    expect(responseObj.status).toBe(200);
    expect(data.success).toBe(1);
    expect(data.file?.url).toBe(
      "https://blossom.smartflow.social/media/editor.jpg"
    );
  });

  it("rejects Blossom multipart file bodies (must be pre-uploaded URL)", async () => {
    (loadUploadProviderSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "BLOSSOM_SFS",
    });

    const { parseFormData } = await import("@remix-run/form-data-parser");
    const formData = new FormData();
    formData.append(
      "image",
      new File(["image-bytes"], "cover.jpg", { type: "image/jpeg" })
    );
    (parseFormData as ReturnType<typeof vi.fn>).mockResolvedValue(formData);

    const request = new Request(
      "http://localhost:3000/api/upload-editorjs-image",
      {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=----test",
        },
        body: new FormData(),
      }
    );

    const response = await action({ request, params: {}, context: {} });
    const responseObj = await asRouteResponse(response);

    expect(responseObj.status).toBe(400);
  });

  it("keeps S3 multipart flow for non-blossom provider", async () => {
    (loadUploadProviderSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "S3",
    });

    const { parseFormData } = await import("@remix-run/form-data-parser");
    const formData = new FormData();
    formData.append(
      "image",
      new File(["image-bytes"], "cover.jpg", { type: "image/jpeg" })
    );
    (parseFormData as ReturnType<typeof vi.fn>).mockResolvedValue(formData);

    const request = new Request(
      "http://localhost:3000/api/upload-editorjs-image",
      {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=----test",
        },
        body: new FormData(),
      }
    );

    const response = await action({ request, params: {}, context: {} });
    const responseObj = await asRouteResponse(response);
    const data = (await responseObj.json()) as {
      success?: number;
      file?: { url?: string };
    };

    expect(responseObj.status).toBe(200);
    expect(data.success).toBe(1);
    expect(data.file?.url).toBe("https://s3.example.com/editorjs.jpg");
    expect(uploadEditorJSImage).toHaveBeenCalled();
  });

  it("loader returns endpoint description", async () => {
    const response = await loader();
    const data = (await response.json()) as { message?: string };
    expect(data.message).toBe("EditorJS Image Upload API");
  });
});
