import { auth } from './firebase';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getBearerToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new ApiError('กรุณาเข้าสู่ระบบก่อนดำเนินการ (Authentication required)', 401);
  }
  return currentUser.getIdToken();
}

export async function apiFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const token = await getBearerToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  let serializedBody: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    serializedBody = JSON.stringify(options.body);
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: serializedBody,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = await getBearerToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Upload failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return payload as T;
}

export async function apiDownloadBlob(path: string, fallbackFilename: string): Promise<void> {
  const token = await getBearerToken();
  const res = await fetch(path, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Download failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] || fallbackFilename;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

