/**
 * API 服务模块（Cookie 认证版）
 *
 * 改造后：
 * - 不再通过 Authorization header 传递 JWT
 * - 默认使用 credentials: 'include' 自动发送 HttpOnly Cookie
 * - 401 响应时自动触发登出事件
 */

// 使用相对路径，通过 Vite proxy 转发到后端，同时支持本地和隧道访问
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

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

// Handle 401 responses - redirect to login
function handleUnauthorized(): void {
  // Dispatch a custom event that the auth store can listen to
  window.dispatchEvent(new CustomEvent('auth:unauthorized'));
}

/**
 * 获取默认的 fetch 选项（自动携带 Cookie）
 */
function getDefaultOptions(): RequestInit {
  return {
    credentials: 'include', // 自动发送 HttpOnly Cookie
  };
}

/**
 * 通用 fetch 封装（自动携带 Cookie）
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
  skipAuthRedirect: boolean = false,
  extraOptions?: { isFormData?: boolean; signal?: AbortSignal }
): Promise<Response> {
  const headers = new Headers(options.headers);

  // 如果是 FormData，浏览器自动设置 Content-Type（含 boundary），不手动设置
  if (!extraOptions?.isFormData) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const response = await fetch(url, {
    ...getDefaultOptions(),
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

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data.error || data.message || `POST ${path} failed: ${res.status}`
    );
  }

  return res.json().catch(() => ({}));
}

export async function apiDelete(path: string, signal?: AbortSignal, body?: any): Promise<any> {
  const res = await fetchWithAuth(`${API_BASE}${path}`, {
    method: 'DELETE',
    signal,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) {
    // 尽量透传后端的业务错误信息（如「管理员密码错误」）
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || data?.error || `DELETE ${path} failed: ${res.status}`);
  }
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
 * 下载文件（通过 fetch + Blob URL，确保携带 Cookie）
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

/**
 * 获取 Python 版本列表
 */
export async function apiGetPythonVersions(): Promise<{ versions: any[] }> {
  const res = await fetchWithAuth(`${API_BASE}/python-versions/available`);
  if (!res.ok) throw new Error(`获取 Python 版本列表失败: ${res.status}`);
  const data = await res.json();
  return { versions: data?.data?.versions || data?.versions || [] };
}

/**
 * 下载并安装 Python 版本（SSE 流式）
 */
export async function apiDownloadPythonVersion(
  version: string,
  onProgress: (progress: { stage: string; progress: number; message: string }) => void
): Promise<{ success: boolean; message: string }> {
  const url = getApiUrl(`/python-versions/${version}/download`);
  const res = await fetchWithAuth(url, { method: 'POST' });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '网络错误' }));
    throw new Error(err.error || '下载失败');
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { success: boolean; message: string } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          if (data.stage) {
            onProgress({
              stage: data.stage,
              progress: data.progress,
              message: data.message,
            });
          }
          if (data.success !== undefined) {
            result = { success: data.success, message: data.message };
          }
        } catch {}
      }
    }
  }

  return result || { success: false, message: '未收到完成事件' };
}

/**
 * 删除已安装的 Python 版本
 */
export async function apiDeletePythonVersion(version: string): Promise<{ success: boolean; message: string }> {
  const res = await fetchWithAuth(`${API_BASE}/python-versions/${version}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除失败: ${res.status}`);
  return res.json();
}

/**
 * 单个 Python 环境的探测结果
 */
export interface PythonEnvProbe {
  available: boolean;
  version: string | null;
  path: string | null;
}

/**
 * 脚本运行环境信息
 */
export interface PythonEnvironmentInfo {
  embedded: PythonEnvProbe;
  system: PythonEnvProbe;
  pipIndexUrl: string;
}

/**
 * 获取脚本运行环境信息（内嵌 Python / 系统 Python / pip 镜像源）
 */
export async function apiGetPythonEnvironment(): Promise<PythonEnvironmentInfo> {
  const res = await fetchWithAuth(`${API_BASE}/python-versions/environment`);
  if (!res.ok) throw new Error(`获取 Python 环境信息失败: ${res.status}`);
  const data = await res.json();
  return data?.data;
}

/**
 * 上传前 hash 预检查（秒传判定）：返回已存在于服务端去重存储的 hash → 文件信息
 */
export async function checkFileHashes(hashes: string[]): Promise<Record<string, { fileName: string; size: number }>> {
  try {
    const res = await fetchWithAuth(`${API_BASE}/files/check-hashes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.data?.existing || {};
  } catch {
    return {};
  }
}

/**
 * 生成报告（SSE 事件流，携带 Cookie）
 */
export async function apiGenerateReport(
  params: {
    scriptId: string;
    templateId: string;
    outputFormat: string;
    reportInfo: any;
    inputFiles: File[];
    inputHashes?: string[];
    /** 命中秒传的文件索引（与 inputFiles/inputHashes 同索引），这些文件不上传、按 hash 引用 */
    dedupIndices?: number[];
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
  const dedupSet = new Set(params.dedupIndices ?? []);
  const dedupRefs: Record<number, string> = {};
  params.inputFiles.forEach((file, idx) => {
    if (dedupSet.has(idx)) {
      dedupRefs[idx] = params.inputHashes?.[idx] || '';
    } else {
      formData.append(`inputFile${idx}`, file);
    }
  });
  if (Object.keys(dedupRefs).length > 0) {
    formData.append('dedupRefs', JSON.stringify(dedupRefs));
  }

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
          if (line.startsWith('event: ')) eventName = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataPayload += line.slice(6);
        }

        if (dataPayload) {
          try {
            const data = JSON.parse(dataPayload);
            if (eventName === 'log' && data.message !== undefined) {
              queueLog(String(data.message));
            } else if (eventName === 'started' && data.reportId) {
              sessionStorage.setItem('running_report_id', data.reportId);
            } else if (eventName === 'complete' && data.report) {
              sessionStorage.removeItem('running_report_id');
              report = data.report;
            } else if (eventName === 'error') {
              sessionStorage.removeItem('running_report_id');
              throw new Error(data.error || '报告生成失败');
            }
          } catch (parseError) {
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

export async function pollReportStatus(reportId: string): Promise<{ report: any; isRunning: boolean }> {
  const res = await fetchWithAuth(`${API_BASE}/reports/${reportId}`);
  if (!res.ok) throw new Error(`Poll status failed: ${res.status}`);
  return res.json().then((d) => d.data);
}

export async function pollReportLogs(reportId: string): Promise<string[]> {
  const res = await fetchWithAuth(`${API_BASE}/reports/${reportId}/logs`);
  if (!res.ok) throw new Error(`Poll logs failed: ${res.status}`);
  return res.json().then((d) => d.data?.logs || []);
}

/**
 * 上传压缩包并解压（报告创建流程中调用）
 * @param file 压缩包文件
 * @param password 可选解压密码
 * @returns 解压结果
 */
export async function apiExtractArchive(
  file: File,
  password?: string
): Promise<{
  success: boolean;
  needPassword?: boolean;
  files?: { name: string; path: string; size: number }[];
  totalSize?: number;
  extractDir?: string;
  error?: string;
  errorDetail?: string;
  errorCode?: string;
  archivePath?: string;
  needExtract?: boolean;
}> {
  const formData = new FormData();
  formData.append('file', file);
  if (password) {
    formData.append('password', password);
  }

  const res = await fetchWithAuth(`${API_BASE}/reports/extract-archive`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: '解压请求失败' }));
    throw new Error(data.message || data.data?.error || `解压失败 (${res.status})`);
  }

  const data = await res.json();
  return data.data || {};
}
