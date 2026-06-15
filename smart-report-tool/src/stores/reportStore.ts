import { create } from 'zustand';
import { Report, ReportGenerationState, OutputFormat } from '@/types';
import { apiGet, apiDelete, apiGenerateReport } from '@/services/api';
import { getAllReportsService, createReport as createReportService, deleteReport as deleteReportService, updateReportStatus } from '@/services/reportService';

interface ReportState {
  reports: Report[];
  generationState: ReportGenerationState;
  loading: boolean;
  fetchReports: () => Promise<void>;
  addReport: (report: Report) => Promise<void>;
  removeReport: (id: string) => Promise<void>;
  setGenerationState: (state: Partial<ReportGenerationState>) => void;
  resetGenerationState: () => void;
  updateReportStatusState: (id: string, status: Report['status'], fileUrl?: string) => Promise<void>;
  generateReport: (body: any, onLog: (msg: string) => void) => Promise<any>;
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
    try {
      const data = await apiGet('/reports');
      set({ reports: data.reports || [], loading: false });
    } catch {
      const reports = await getAllReportsService();
      set({ reports, loading: false });
    }
  },

  addReport: async (report: Report) => {
    await createReportService(report);
    await get().fetchReports();
  },

  removeReport: async (id: string) => {
    try {
      await apiDelete(`/reports/${id}`);
    } catch {
      await deleteReportService(id);
    }
    await get().fetchReports();
  },

  setGenerationState: (state) => {
    set({ generationState: { ...get().generationState, ...state } });
  },

  resetGenerationState: () => {
    set({ generationState: { ...initialGenerationState } });
  },

  updateReportStatusState: async (id, status, fileUrl) => {
    await updateReportStatus(id, status, fileUrl);
    await get().fetchReports();
  },

  generateReport: async (body, onLog) => {
    return await apiGenerateReport(body, onLog);
  },
}));
