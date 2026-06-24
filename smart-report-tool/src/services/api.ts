const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

export function getApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// 获取运行中的报告 ID（页面切换后用于轮询恢复）
export function getRunningReportId(): string | null {
  return sessionStorage.getItem('running_report_id');
}

export function clearRunningReportId(): void {
  sessionStorage.removeItem('running_report_id');
}

// Token management
const AUTH_TOKEN_KEY = 'smart_report_auth_token';

export function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

// Helper to get auth headers
function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  if (token) {
    return {
      'Authorization': `Bearer ${token}`,
    };
  }
  return {};
}

// Handle 401 responses - redirect to login
function handleUnauthorized(): void {
  removeToken();
  // Dispatch a custom event that the auth store can listen to
  window.dispatchEvent(new CustomEvent('auth:unauthorized'));
}

// Generic fetch wrapper with auth
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  skipAuthRedirect: boolean = false,
  extraOptions?: { isFormData?: boolean; signal?: AbortSignal }
): Promise<Response> {
  const headers = new Headers(options.headers);

  // Add auth headers (skip Content-Type for FormData, browser sets it with boundary)
  const authHeaders = getAuthHeaders();
  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  // Don't set Content-Type for FormData (browser handles it)
  if (!extraOptions?.isFormData) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: extraOptions?.signal,
  });

  // Handle 401 Unauthorized (skip for login/register so caller can read error body)
  if (response.status === 401 && !skipAuthRedirect) {
    handleUnauthorized();
    throw new Error('认证已过期，请重新登录');
  }

  return response;
}

export async function apiGet(path: string, signal?: AbortSignal): Promise<any> {
  const res = await fetchWithAuth(`${API_BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost(
  path: string,
  body?: any,
  skipAuthRedirect: boolean = false,
  signal?: AbortSignal
): Promise<any> {
  const isFormData = body instanceof FormData;
  const headers: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };

  const res = await fetchWithAuth(
    `${API_BASE}${path}`,
    {
      method: 'POST',
      headers,
      body: isFormData ? body : JSON.stringify(body),
      signal,
    },
    skipAuthRedirect,
    isFormData ? { isFormData: true } : undefined
  );

  // 非 2xx 响应统一抛异常，由调用方 catch 处理。
  // 优先使用后端返回的 error/message 字段作为错误信息。
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error || data.message || `POST ${path} failed: ${res.status}`
    );
  }

  return res.json().catch(() => ({}));
}

export async function apiDelete(path: string, signal?: AbortSignal): Promise<any> {
  const res = await fetchWithAuth(`${API_BASE}${path}`, { method: 'DELETE', signal });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPut(path: string, body?: any): Promise<any> {
  const res = await fetchWithAuth(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `PUT ${path} failed: ${res.status}`);
  }
  return data;
}

export async function apiPutFormData(path: string, formData: FormData): Promise<any> {
  const res = await fetchWithAuth(
    `${API_BASE}${path}`,
    {
      method: 'PUT',
      body: formData,
    },
    false,
    { isFormData: true }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `PUT ${path} failed: ${res.status}`);
  }
  return data;
}

/**
 * 下载文件（通过 fetch + Blob URL，确保携带认证头）
 * 
 * @param path - API 路径，如 /scripts/:id/download
 * @param filename - 下载后的文件名
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`下载失败: ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放 Blob URL 确保下载启动
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function apiPatch(path: string, body?: any): Promise<any> {
  const res = await fetchWithAuth(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `PATCH ${path} failed: ${res.status}`);
  }
  return data;
}

// Generate report with multipart upload (includes actual File objects)
export async function apiGenerateReport(
  params: {
    scriptId: string;
    templateId: string;
    outputFormat: string;
    reportInfo: any;
    inputFiles: File[];
    inputHashes?: string[];
    requirements?: string[];
  },
  onLog: (msg: string) => void,
  signal?: AbortSignal
): Promise<any> {
  const formData = new FormData();
  formData.append('scriptId', params.scriptId);
  formData.append('templateId', params.templateId);
  formData.append('outputFormat', params.outputFormat);
  formData.append('reportInfo', JSON.stringify(params.reportInfo));
  if (params.requirements && params.requirements.length > 0) {
    formData.append('requirements', JSON.stringify(params.requirements));
  }
  if (params.inputHashes && params.inputHashes.length > 0) {
    formData.append('inputHashes', JSON.stringify(params.inputHashes));
  }
  params.inputFiles.forEach((file, idx) => {
    formData.append(`inputFile${idx}`, file);
  });

  const res = await fetchWithAuth(
    `${API_BASE}/reports/generate`,
    {
      method: 'POST',
      body: formData,
      signal,
    },
    false,
    { isFormData: true }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Generate failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let report: any = null;
  let buffer = '';

  if (!reader) throw new Error('No response body');

  // 日志缓冲：高频日志流分批回调，避免 React 状态更新过于频繁
  let logBuffer: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_INTERVAL_MS = 80;

  const flushLogs = () => {
    if (logBuffer.length === 0) return;
    const batch = logBuffer;
    logBuffer = [];
    for (const msg of batch) onLog(msg);
  };

  const queueLog = (msg: string) => {
    logBuffer.push(msg);
    if (logBuffer.length >= 50) {
      if (flushTimer) clearTimeout(flushTimer);
      flushLogs();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushLogs();
      }, FLUSH_INTERVAL_MS);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按 SSE 事件边界（双换行）分割，保留未完整事件
      const eventEndIndex = buffer.lastIndexOf('\n\n');
      if (eventEndIndex === -1) continue;

      const completeEvents = buffer.slice(0, eventEndIndex);
      buffer = buffer.slice(eventEndIndex + 2);

      const events = completeEvents.split('\n\n');
      for (const event of events) {
        if (!event.trim()) continue;
        const lines = event.split('\n');
        let eventName = 'message';
        let dataPayload = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataPayload += line.slice(6);
          }
        }

        if (dataPayload) {
          try {
            const data = JSON.parse(dataPayload);
            if (eventName === 'log' && data.message !== undefined) {
              queueLog(String(data.message));
            } else if (eventName === 'started' && data.reportId) {
              // 保存 reportId 到 sessionStorage 供页面切换后轮询恢复
              sessionStorage.setItem('running_report_id', data.reportId);
            } else if (eventName === 'complete' && data.report) {
              sessionStorage.removeItem('running_report_id');
              report = data.report;
            } else if (eventName === 'error') {
              sessionStorage.removeItem('running_report_id');
              throw new Error(data.error || '报告生成失败');
            }
          } catch (parseError) {
            // 如果 JSON 解析失败，尝试作为纯文本日志输出
            if (eventName === 'log') {
              queueLog(String(dataPayload));
            }
          }
        }
      }
    }
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    flushLogs();
  }

  return report;
}

// ── 轮询 API（用于 SSE 断开后恢复日志显示）──

/** 轮询获取报告最新状态 */
export async function pollReportStatus(reportId: string): Promise<{ report: any; isRunning: boolean }> {
  const res = await fetchWithAuth(`${API_BASE}/reports/${reportId}`);
  if (!res.ok) throw new Error(`Poll status failed: ${res.status}`);
  return res.json().then((d) => d.data);
}

/** 轮询获取报告日志 */
export async function pollReportLogs(reportId: string): Promise<string[]> {
  const res = await fetchWithAuth(`${API_BASE}/reports/${reportId}/logs`);
  if (!res.ok) throw new Error(`Poll logs failed: ${res.status}`);
  return res.json().then((d) => d.data?.logs || []);
}