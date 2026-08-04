/**
 * AI 模型配置 Store（重写版）
 * 数据源为服务端 /api/ai-config/resolved，不再 persist 到 localStorage。
 * 首次加载时自动执行旧 localStorage 配置的一次性迁移。
 */

import { create } from 'zustand';
import {
  fetchResolved,
  migrateLegacyConfig,
  type ResolvedAIConfig,
  type ResolvedModel,
} from '@/services/aiConfigService';

interface AIConfigState {
  /** 服务端解析后的 AI 配置（未加载时为 null） */
  resolved: ResolvedAIConfig | null;
  /** 会话级选择的模型 id，null = 使用服务端默认模型 */
  selectedModelId: string | null;
  /** 是否正在加载配置 */
  isLoading: boolean;
  /** 后端走 .env 系统默认兜底（X-AI-Fallback 响应头或 resolved 推导），用于提示条 */
  fallbackNotice: boolean;
  /** 加载配置：先执行旧配置迁移，再拉取服务端解析结果 */
  loadResolved: () => Promise<void>;
  /** 轻量刷新配置（不执行迁移），用于配置变更后同步各页面的缓存状态 */
  refreshResolved: () => Promise<void>;
  /** 选择模型（会话级，不持久化） */
  selectModel: (modelId: string | null) => void;
  /** 设置兜底提示状态（由 AI 请求检测到 X-AI-Fallback 响应头时调用） */
  setFallbackNotice: (notice: boolean) => void;
  /** 当前生效模型（selectedModelId 优先，否则 defaultModel） */
  currentModel: () => ResolvedModel | null;
}

export const useAIConfigStore = create<AIConfigState>()((set, get) => ({
  resolved: null,
  selectedModelId: null,
  isLoading: false,
  fallbackNotice: false,

  loadResolved: async () => {
    set({ isLoading: true });
    try {
      // 一次性迁移旧 localStorage 配置（无旧配置或已迁移时为空操作）
      await migrateLegacyConfig();
      const resolved = await fetchResolved();
      set({
        resolved,
        isLoading: false,
        // 无默认模型但 .env 兜底可用时，请求必将走系统默认配置，提前点亮提示条
        fallbackNotice: !resolved.defaultModel && resolved.fallbackAvailable,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  refreshResolved: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const resolved = await fetchResolved();
      set({
        resolved,
        isLoading: false,
        fallbackNotice: !resolved.defaultModel && resolved.fallbackAvailable,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  selectModel: (modelId) => set({ selectedModelId: modelId }),

  setFallbackNotice: (notice) => set({ fallbackNotice: notice }),

  currentModel: () => {
    const { resolved, selectedModelId } = get();
    if (!resolved) return null;
    if (selectedModelId) {
      const found = resolved.models.find((m) => m.id === selectedModelId);
      if (found) return found;
    }
    return resolved.defaultModel;
  },
}));
