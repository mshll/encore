import { toApiError } from "../api/client";

/**
 * POSTs a multipart form and reports upload progress (0 to 1). fetch cannot report upload progress, so this uses XHR.
 * Errors come back as the same ApiError the rest of the client throws.
 */
export function uploadForm<T>(path: string, form: FormData, onProgress: (share: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else reject(toApiError(xhr.status, xhr.response as Parameters<typeof toApiError>[1]));
    };
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
