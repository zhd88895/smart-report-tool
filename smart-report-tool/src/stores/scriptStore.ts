import { create } from 'zustand';
import { Script, ExecutionLog } from '@/types';
import { apiGet, apiDelete } from '@/services/api';
import { getAllScriptsService, addScript as addScriptService, deleteScriptService, executeScriptService, updateExecutionLog, getExecutionLogsByScript, getAllExecutionLogsService } from '@/services/scriptService';

interface ScriptState {
  scripts: Script[];
  executionLogs: ExecutionLog[];
  loading: boolean;
  fetchScripts: () => Promise<void>;
  addScript: (script: Script) => Promise<void>;
  removeScript: (id: string) => Promise<void>;
  executeScript: (scriptId: string, params: { targetHost?: string; executedBy: string; executedById: string; scriptName: string }) => Promise<string>;
  loadExecutionLogs: (scriptId?: string) => Promise<void>;
  appendExecutionOutput: (logId: string, line: string) => Promise<void>;
  completeExecution: (logId: string, status: 'success' | 'failed') => Promise<void>;
}

export const useScriptStore = create<ScriptState>((set, get) => ({
  scripts: [],
  executionLogs: [],
  loading: false,

  fetchScripts: async () => {
    set({ loading: true });
    // Always read local IndexedDB first — local edits take priority
    const localScripts = await getAllScriptsService().catch(() => []);
    const localMap = new Map<string, Script>(localScripts.map((s: Script) => [s.id, s]));
    try {
      const data = await apiGet('/scripts');
      const remoteScripts: Script[] = (data.scripts || []);
      // Merge: local IndexedDB overrides backend for same ID
      const merged = remoteScripts.map((rs) => localMap.get(rs.id) ?? rs);
      // Add any local-only scripts not on backend
      for (const local of localScripts) {
        if (!merged.find((s: Script) => s.id === local.id)) {
          merged.push(local);
        }
      }
      set({ scripts: merged, loading: false });
    } catch {
      set({ scripts: localScripts, loading: false });
    }
  },

  addScript: async (script: Script) => {
    await addScriptService(script);
    await get().fetchScripts();
  },

  removeScript: async (id: string) => {
    try {
      await apiDelete(`/scripts/${id}`);
    } catch {
      await deleteScriptService(id);
    }
    await get().fetchScripts();
  },

  executeScript: async (scriptId: string, params) => {
    const logId = await executeScriptService(scriptId, params);
    const logs = scriptId ? await getExecutionLogsByScript(scriptId) : await getAllExecutionLogsService();
    set({ executionLogs: logs });
    return logId;
  },

  loadExecutionLogs: async (scriptId?: string) => {
    const logs = scriptId ? await getExecutionLogsByScript(scriptId) : await getAllExecutionLogsService();
    set({ executionLogs: logs });
  },

  appendExecutionOutput: async (logId: string, line: string) => {
    const log = get().executionLogs.find((l) => l.id === logId);
    if (log) {
      log.output.push(line);
      await updateExecutionLog(logId, { output: log.output });
      set({ executionLogs: [...get().executionLogs] });
    }
  },

  completeExecution: async (logId: string, status: 'success' | 'failed') => {
    await updateExecutionLog(logId, { status, completedAt: new Date().toISOString() });
    const logs = await getAllExecutionLogsService();
    set({ executionLogs: logs });
  },
}));
