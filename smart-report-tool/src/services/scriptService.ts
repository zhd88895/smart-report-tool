import { Script, ExecutionLog } from '@/types';
import { getAllScripts, putScript, removeScript, getAllExecutionLogs, putExecutionLog, getExecutionLogById } from './db';

export async function getAllScriptsService(): Promise<Script[]> {
  return getAllScripts();
}

export async function addScript(script: Script): Promise<string> {
  return putScript(script);
}

export async function deleteScriptService(id: string): Promise<void> {
  return removeScript(id);
}

// ── Execution Log ──

export async function getAllExecutionLogsService(): Promise<ExecutionLog[]> {
  return getAllExecutionLogs();
}

export async function getExecutionLogsByScript(scriptId: string): Promise<ExecutionLog[]> {
  const logs = await getAllExecutionLogs();
  return logs.filter((l) => l.scriptId === scriptId);
}

export async function executeScriptService(
  _scriptId: string,
  params: { targetHost?: string; executedBy: string; executedById: string; scriptName: string }
): Promise<string> {
  const log: ExecutionLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    scriptId: _scriptId,
    scriptName: params.scriptName,
    executedBy: params.executedBy,
    executedById: params.executedById,
    targetHost: params.targetHost,
    status: 'running',
    output: [],
    startedAt: new Date().toISOString(),
  };
  await putExecutionLog(log);
  return log.id;
}

export async function updateExecutionLog(
  id: string,
  updates: Partial<Pick<ExecutionLog, 'status' | 'output' | 'completedAt'>>
): Promise<void> {
  const log = await getExecutionLogById(id);
  if (log) {
    Object.assign(log, updates);
    await putExecutionLog(log);
  }
}
