/**
 * 系统默认配置兜底提示条（非阻塞）
 * 后端返回 X-AI-Fallback 响应头（或 resolved 显示无默认模型但兜底可用）时显示，
 * 提示用户当前正在使用系统默认配置。
 */

import { Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import { ROUTES } from '@/constants/routes';

export function AIFallbackNotice() {
  const navigate = useNavigate();
  const fallbackNotice = useAIConfigStore((s) => s.fallbackNotice);
  if (!fallbackNotice) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span>
        正在使用系统默认配置，建议在
        <button
          type="button"
          className="mx-0.5 underline hover:text-amber-800"
          onClick={() => navigate(ROUTES.AI_SETTINGS)}
        >
          AI 设置
        </button>
        中配置自己的模型
      </span>
    </div>
  );
}
