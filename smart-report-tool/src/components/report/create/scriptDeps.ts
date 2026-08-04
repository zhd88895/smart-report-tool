import { Script } from '@/types';

const isDepsStatusDone = (status?: string) => status === 'done' || status === 'success';

/** 判断脚本依赖是否已就绪 */
export const isDepsReady = (s: Script): boolean => {
  if (s.scriptType !== 'python') return true;
  if (!s.requirements || s.requirements.length === 0) return true;
  const ds = (s as any).depsStatus as { status?: string; packages?: string[] } | undefined;
  return isDepsStatusDone(ds?.status);
};

/** 获取脚本未就绪的依赖列表 */
export const getUnreadyDeps = (s: Script): string[] => {
  if (!s.requirements) return [];
  const ds = (s as any).depsStatus as { status?: string; packages?: string[] } | undefined;
  if (isDepsStatusDone(ds?.status)) return [];
  // 返回所有配置的依赖（因为它们都未安装/未状态）
  return s.requirements;
};
