/**
 * AI 智能分析任务队列 Store（服务端队列版）
 *
 * 任务由后端集中排队执行（analysis_tasks 表 + 服务端调度器）：
 * - 入队即上传：文件进入服务端去重存储，任务记录落数据库
 * - 全局串行：同一时刻只执行一个任务，其余排队，自动接续
 * - 断线/刷新恢复：运行中的输出在服务端累积，前端通过 SSE 重连
 *   先补发已累积内容再接续实时增量；刷新页面后任务状态完整恢复
 * - 完成后由后端自动保存 AI 报告
 *
 * @module stores/analysisTaskStore
 */

import { create } from 'zustand';
import { toast } from 'sonner';
import { getApiUrl, checkFileHashes } from '@/services/api';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import type { AssetSupplement } from '@/components/AssetSupplementForm';

/** 提交分析所需的完整参数（入队时从表单快照） */
export interface AnalysisTaskPayload {
  file: File;
  category: string;
  customPrompt: string;
  supplements: AssetSupplement[];
  knowledgeFileIds: string[];
  /** 会话级选择的模型记录 ID，null 表示用服务端默认 */
  modelId: string | null;
  userHint: string;
  /** 报告作者显示名 */
  author: string;
  /** 生效模型显示名（用于报告内容） */
  modelName: string;
}

export interface AnalysisTask {
  id: string;
  fileName: string;
  category: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  streamingText: string;
  packProgress: string;
  result: string | null;
  error: string | null;
  /** 后端自动保存的报告 ID */
  reportId: string | null;
  createdAt: number;
  /** 展示/导出用元数据（不含 File 对象） */
  payload: {
    category: string;
    modelId: string | null;
    modelName: string;
    author: string;
  };
}

/** 类别显示名（含支持包模式专用的 support 类别） */
const CATEGORY_LABELS: Record<string, string> = {
  host: '主机', storage: '存储', network: '交换机',
  virtualization: '虚拟化', database: '数据库', other: '其他',
  support: '整机支持包',
};

/** 构建 AI 报告 Markdown 内容（导出与报告管理一致） */
export function buildReportContent(result: string, categoryKey: string, fileName: string, model: string): string {
  const categoryLabel = CATEGORY_LABELS[categoryKey] || categoryKey;
  return `# AI 巡检分析报告

类别: ${categoryLabel}
文件: ${fileName}
模型: ${model}
生成时间: ${new Date().toLocaleString()}

---

${result}`;
}

/** 构建 AI 报告文件名（导出与报告管理一致） */
export function buildReportFileName(originalFileName: string): string {
  const now = new Date();
  const dateStr = `${String(now.getFullYear()).slice(2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  return `AI分析报告（${originalFileName}）_${dateStr} ${timeStr}.md`;
}

/** 后端任务记录 → 前端任务对象 */
function mapRecord(r: any): AnalysisTask {
  return {
    id: r.id,
    fileName: r.fileName,
    category: r.category,
    status: r.status,
    streamingText: '',
    packProgress: '',
    result: r.resultText ?? null,
    error: r.error ?? null,
    reportId: r.reportId ?? null,
    createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(),
    payload: {
      category: r.category,
      modelId: r.modelId ?? null,
      modelName: r.modelName ?? '',
      author: r.author ?? '',
    },
  };
}

interface AnalysisTaskState {
  tasks: AnalysisTask[];
  /** 当前在页面上展示的任务（切页后回来自动恢复为该任务） */
  activeTaskId: string | null;
  /** 是否已从后端加载过任务列表 */
  loaded: boolean;
  /** 从后端加载任务列表，并对排队/运行中的任务建立事件流（页面挂载时调用） */
  loadTasks: () => Promise<void>;
  /** 入队一个新分析任务（上传文件到后端队列）；返回任务 ID */
  enqueue: (payload: AnalysisTaskPayload) => Promise<string | null>;
  setActiveTask: (id: string | null) => void;
  /** 移除任务：排队中的先取消，终态的直接删除记录；运行中的不允许 */
  removeTask: (id: string) => Promise<void>;
}

/** 已建立事件流的任务（防重复连接） */
const streaming = new Set<string>();

export const useAnalysisTaskStore = create<AnalysisTaskState>((set, get) => {
  const update = (id: string, patch: Partial<AnalysisTask>) => {
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  };

  /**
   * 连接任务事件流：SSE 逐行解析。
   * 运行中重连时服务端先补发已累积文本（作为一次完整 delta），再接续增量，
   * 因此本地从空串开始累加即可得到完整输出。
   */
  const connectStream = async (id: string) => {
    if (streaming.has(id)) return;
    streaming.add(id);
    let fullText = '';
    try {
      const res = await fetch(getApiUrl(`/ai/analysis-tasks/${id}/stream`), { credentials: 'include' });
      if (!res.ok) {
        // 任务不存在或失败：静默交给 loadTasks 的下次同步
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      const handleLine = (line: string): boolean => {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) return false;
        const dp = t.slice(6);
        if (dp === '[DONE]') return true;
        try {
          const parsed = JSON.parse(dp);
          if (parsed.type === 'pack_progress' && parsed.message) {
            update(id, { packProgress: parsed.message });
            return false;
          }
          if (parsed.type === 'fallback_notice') {
            useAIConfigStore.getState().setFallbackNotice(true);
            return false;
          }
          if (parsed.type === 'task_done') {
            update(id, { status: 'done', result: fullText, streamingText: '', packProgress: '', reportId: parsed.reportId ?? null });
            const task = get().tasks.find((x) => x.id === id);
            toast.success(`「${task?.fileName ?? '文件'}」分析完成，报告已自动保存`);
            return true;
          }
          if (parsed.type === 'task_error') {
            update(id, { status: 'error', error: parsed.message || '分析失败', packProgress: '' });
            const task = get().tasks.find((x) => x.id === id);
            toast.error(`「${task?.fileName ?? '文件'}」${parsed.message || '分析失败'}`);
            return true;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            update(id, { status: 'running', streamingText: fullText });
          }
        } catch { /* 忽略无法解析的行 */ }
        return false;
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (handleLine(line)) { reader.releaseLock(); return; }
          }
        }
        if (buffer.trim()) handleLine(buffer);
      } finally {
        reader.releaseLock();
      }
      // 连接结束但未收到终态事件（网络抖动/服务重启）：回源同步一次状态
      await syncTask(id);
    } catch {
      await syncTask(id);
    } finally {
      streaming.delete(id);
    }
  };

  /** 从后端同步单个任务的最新状态（流异常结束后的兜底） */
  const syncTask = async (id: string) => {
    try {
      const res = await fetch(getApiUrl(`/ai/analysis-tasks/${id}`), { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const rec = data?.data?.task;
      if (!rec) return;
      const mapped = mapRecord(rec);
      const cur = get().tasks.find((t) => t.id === id);
      update(id, {
        status: mapped.status,
        error: mapped.error,
        reportId: mapped.reportId,
        // 终态时用后端结果覆盖；运行中保留本地流式文本
        result: mapped.status === 'done' ? (mapped.result ?? cur?.result ?? null) : cur?.result ?? null,
        streamingText: mapped.status === 'done' ? '' : cur?.streamingText ?? '',
      });
      // 仍在排队/运行则延迟重连事件流
      if (mapped.status === 'queued' || mapped.status === 'running') {
        setTimeout(() => { void connectStream(id); }, 2000);
      }
    } catch { /* 下次 loadTasks 再同步 */ }
  };

  return {
    tasks: [],
    activeTaskId: null,
    loaded: false,

    loadTasks: async () => {
      try {
        const res = await fetch(getApiUrl('/ai/analysis-tasks'), { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const records: any[] = data?.data?.tasks ?? [];
        // 列表新的在前；页面展示按创建时间升序（先建的在上）
        const mapped = records.map(mapRecord).sort((a, b) => a.createdAt - b.createdAt);
        // 保留正在流式接收的本地文本（mapRecord 里 streamingText 为空）
        const prev = new Map(get().tasks.map((t) => [t.id, t]));
        for (const t of mapped) {
          const p = prev.get(t.id);
          if (p && (t.status === 'running' || t.status === 'queued')) {
            t.streamingText = p.streamingText;
            t.packProgress = p.packProgress;
          }
        }
        set((s) => ({
          tasks: mapped,
          loaded: true,
          // 当前活跃任务不在列表里时，回退到运行中的任务
          activeTaskId: s.activeTaskId && mapped.some((t) => t.id === s.activeTaskId)
            ? s.activeTaskId
            : (mapped.find((t) => t.status === 'running')?.id ?? s.activeTaskId),
        }));
        // 对排队/运行中的任务建立事件流（刷新页面后恢复实时输出）
        for (const t of mapped) {
          if (t.status === 'queued' || t.status === 'running') void connectStream(t.id);
        }
      } catch { /* 网络异常时下一次操作再同步 */ }
    },

    enqueue: async (payload) => {
      try {
        // 秒传判定：完整计算文件 SHA-256，命中去重存储则不再上传
        let dedupHash = '';
        try {
          const buf = await payload.file.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', buf);
          const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
          const existing = await checkFileHashes([hash]);
          if (existing[hash]) dedupHash = hash;
        } catch { /* 计算失败则走正常上传 */ }

        const formData = new FormData();
        if (dedupHash) formData.append('dedupHash', dedupHash);
        else formData.append('file', payload.file);
        formData.append('category', payload.category);
        formData.append('customPrompt', payload.customPrompt);
        formData.append('supplements', JSON.stringify(payload.supplements));
        formData.append('knowledgeFileIds', JSON.stringify(payload.knowledgeFileIds));
        formData.append('modelId', payload.modelId ?? '');
        formData.append('modelName', payload.modelName);
        formData.append('author', payload.author);
        if (payload.userHint.trim()) formData.append('userHint', payload.userHint.trim());

        const res = await fetch(getApiUrl('/ai/analysis-tasks'), { method: 'POST', credentials: 'include', body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || data.error || '任务创建失败');
        }
        if (dedupHash) toast.info(`「${payload.file.name}」文件已存在，使用秒传模式`);
        const data = await res.json();
        const rec = data?.data?.task;
        if (!rec) throw new Error('任务创建失败');

        const task = mapRecord(rec);
        set((s) => ({ tasks: [...s.tasks.filter((t) => t.id !== task.id), task], activeTaskId: task.id }));

        const hasRunning = get().tasks.some((t) => t.status === 'running' && t.id !== task.id);
        if (hasRunning || task.status === 'queued') {
          const pos = get().tasks.filter((t) => t.status === 'queued').length;
          if (hasRunning) toast.info(`已有分析任务进行中，「${task.fileName}」已加入队列（第 ${pos} 位）`);
        }
        // 建立事件流：排队中的任务会在开始执行后自动推送进度与增量
        void connectStream(task.id);
        return task.id as string;
      } catch (err: any) {
        toast.error(err.message || '任务创建失败');
        return null;
      }
    },

    setActiveTask: (id) => set({ activeTaskId: id }),

    removeTask: async (id) => {
      const t = get().tasks.find((x) => x.id === id);
      if (!t || t.status === 'running') return;
      try {
        if (t.status === 'queued') {
          await fetch(getApiUrl(`/ai/analysis-tasks/${id}/cancel`), { method: 'POST', credentials: 'include' });
        } else {
          await fetch(getApiUrl(`/ai/analysis-tasks/${id}`), { method: 'DELETE', credentials: 'include' });
        }
      } catch { /* 后端失败也先本地移除，下次 loadTasks 校准 */ }
      set((s) => ({
        tasks: s.tasks.filter((x) => x.id !== id),
        activeTaskId: s.activeTaskId === id ? null : s.activeTaskId,
      }));
    },
  };
});
