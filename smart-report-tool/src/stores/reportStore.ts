import { create } from 'zustand';
import { Report, ReportGenerationState, OutputFormat } from '@/types';
import { apiGet, apiDelete, apiGenerateReport, pollReportStatus, pollReportLogs } from '@/services/api';

interface ReportState {
  reports: Report[];
  generationState: ReportGenerationState;
  loading: boolean;
  fetchReports: () => Promise<void>;
  removeReport: (id: string) => Promise<void>;
  setGenerationState: (state: Partial<ReportGenerationState>) => void;
  resetGenerationState: () => void;
  generateReport: (body: any, onLog: (msg: string) => void) => Promise<any>;
  /** 轮询获取报告状态和日志（用于 SSE 断开后恢复） */
  pollRunningReport: (reportId: string, onLog: (msg: string) => void) => Promise<{ report: any; done: boolean }>;
}

const initialGenerationState: ReportGenerationState = {
  step: 1,
  logCategory: 'host',
  inputFiles: [],
  selectedScriptId: null,
  selectedTemplateId: null,
  reportInfo: { name: '', date: '', author: '', authorId: '' },
  outputFormat: 'html' as OutputFormat,
  enableAIAnalysis: false,
  progress: 0,
  status: 'idle',
};

export const useReportStore = create<ReportState>((set, get) => ({
  reports: [],
  generationState: { ...initialGenerationState },
  loading: false,

  fetchReports: async () => {
    set({ loading: true });
    const data = await apiGet('/reports');
    set({ reports: data.data?.reports || [], loading: false });
  },

  removeReport: async (id: string) => {
    await apiDelete(`/reports/${id}`);
    await get().fetchReports();
  },

  setGenerationState: (state) => {
    set({ generationState: { ...get().generationState, ...state } });
  },

  resetGenerationState: () => {
    set({ generationState: { ...initialGenerationState } });
  },

  generateReport: async (body, onLog) => {
    return await apiGenerateReport(body, onLog);
  },

  pollRunningReport: async (reportId, onLog) => {
    // 先获取当前完整日志
    const logs = await pollReportLogs(reportId);
    for (const msg of logs) onLog(msg);

    // 轮询等待完成
    const maxRetries = 300; // 最多等 5 分钟 (1s × 300)
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const { report, isRunning } = await pollReportStatus(reportId);
      if (!isRunning || report.status !== 'generating') {
        // 获取最终日志
        await pollReportLogs(reportId);
        return { report, done: true };
      }
    }
    throw new Error('轮询超时');
  },
}));
