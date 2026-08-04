import { ScriptType, ScriptRegion, LogCategory, AuxFile } from '@/types';

export const SCRIPT_TYPE_LABELS: Record<ScriptType, string> = { python: 'Python', bat: 'BAT', ps1: 'PowerShell', sh: 'Shell', powershell: 'PowerShell 7' };
export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = { host: '主机', storage: '存储', database: '数据库', virtualization: '虚拟化', network: '交换机' };
export const REGION_LIST: ScriptRegion[] = ['全部', '华南区', '西北区', '华东区', '东北区', '西南区', '华北区', '北京区', '华中区'];
export const INPUT_FORMAT_SUGGESTIONS = ['doc', 'docx', 'xlsx', 'txt', 'log', 'html'];

export const emptyMeta = () => ({ name: '', description: '', scriptType: 'python' as ScriptType, region: '全部' as ScriptRegion, inputFormats: '', inputFormatManual: false, version: '1.0.0', category: 'host' as LogCategory, templateRequired: false, templateIds: [] as string[], auxiliaryFiles: [] as AuxFile[], extraFiles: [] as AuxFile[], requirements: [] as string[], pythonVersion: 'embedded', isMultiFile: false });

export type ScriptMeta = ReturnType<typeof emptyMeta>;

/** 判断依赖是否已就绪（兼容后端旧数据 'success' 和新数据 'done'） */
export function isDepsStatusDone(status?: string): boolean {
  return status === 'done' || status === 'success';
}
