const API_BASE = 'http://localhost:3001/api';

export async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost(path: string, body?: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiDelete(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

export function apiPostSSE(path: string, body: any, onMessage: (data: any) => void, onComplete?: () => void, onError?: (err: Error) => void) {
  const evtSource = new EventSource(`${API_BASE}${path}`, {
    // @ts-ignore
    body: JSON.stringify(body),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  } as any);

  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
      if (data.type === 'complete') {
        evtSource.close();
        onComplete?.();
      }
    } catch (err) {
      onMessage({ type: 'log', message: e.data });
    }
  };

  evtSource.onerror = (_err) => {
    evtSource.close();
    onError?.(new Error('SSE connection error'));
  };

  return evtSource;
}

// Generate report with multipart upload (includes actual File objects)
export async function apiGenerateReport(
  params: {
    scriptId: string;
    templateId: string;
    outputFormat: string;
    reportInfo: any;
    inputFiles: File[];
    requirements?: string[];
  },
  onLog: (msg: string) => void
): Promise<any> {
  const formData = new FormData();
  formData.append('scriptId', params.scriptId);
  formData.append('templateId', params.templateId);
  formData.append('outputFormat', params.outputFormat);
  formData.append('reportInfo', JSON.stringify(params.reportInfo));
  if (params.requirements && params.requirements.length > 0) {
    formData.append('requirements', JSON.stringify(params.requirements));
  }
  params.inputFiles.forEach((file, idx) => {
    formData.append(`inputFile${idx}`, file);
  });

  const res = await fetch(`${API_BASE}/reports/generate`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw new Error(`Generate failed: ${res.status}`);

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let report: any = null;

  if (!reader) throw new Error('No response body');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'log') onLog(data.message);
          if (data.type === 'complete') report = data.report;
        } catch {
          // ignore parse errors
        }
      }
    }
  }

  return report;
}
