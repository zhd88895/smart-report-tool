/**
 * 统一模型选择器
 * 数据来自服务端解析结果（useAIConfigStore.resolved），
 * 未配置任何模型时渲染「配置 AI 模型」按钮并跳转 AI 设置页。
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import { ROUTES } from '@/constants/routes';
import { cn } from '@/lib/utils';

export function ModelSelector({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { resolved, selectedModelId, selectModel, loadResolved, refreshResolved } = useAIConfigStore();

  useEffect(() => {
    // 首次挂载拉取配置；已有缓存时也轻量刷新一次，
    // 保证在 AI 设置页变更后切回来能看到最新状态（无需手动刷新页面）
    if (!resolved) loadResolved();
    else refreshResolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当前生效模型：会话级选择优先，否则服务端默认模型
  const current = selectedModelId
    ? (resolved?.models.find((m) => m.id === selectedModelId) ?? resolved?.defaultModel ?? null)
    : (resolved?.defaultModel ?? null);

  if (!resolved) return null;

  if (!current) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-7 text-xs text-amber-500', className)}
        type="button"
        onClick={() => navigate(ROUTES.AI_SETTINGS)}
      >
        <Sparkles className="h-3.5 w-3.5 mr-1" />
        配置 AI 模型
      </Button>
    );
  }

  return (
    <Select value={selectedModelId ?? current.id} onValueChange={selectModel}>
      <SelectTrigger className={cn('h-7 text-xs w-auto gap-1', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {resolved.models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.displayName || m.modelId}（{m.providerName}）{m.isDefault ? ' ·默认' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
