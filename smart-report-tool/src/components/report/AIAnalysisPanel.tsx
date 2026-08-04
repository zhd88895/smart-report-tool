/**
 * AI 智能分析面板
 * 
 * 支持上传巡检日志文件，选择分析类别和 AI 模型，流式生成分析报告。
 * 未配置 AI 时显示引导提示。
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, Bot, Download, Trash2, AlertTriangle, CheckCircle, Zap, Settings, ChevronDown, ChevronUp, FileSpreadsheet, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { AssetSupplementForm, AssetSupplement, AssetType } from '@/components/AssetSupplementForm';
import { KnowledgeFilePicker } from '@/components/report/KnowledgeFilePicker';
import { ModelSelector } from '@/components/ai/ModelSelector';
import { AIFallbackNotice } from '@/components/ai/AIFallbackNotice';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import { useAuthStore } from '@/stores/authStore';
import { getApiUrl, checkFileHashes } from '@/services/api';
import { ROUTES } from '@/constants/routes';
import { DEFAULT_PROMPTS } from '@/constants/analysisPrompts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { key: 'host', label: '主机' },
  { key: 'storage', label: '存储' },
  { key: 'network', label: '交换机' },
  { key: 'virtualization', label: '虚拟化' },
  { key: 'database', label: '数据库' },
  { key: 'other', label: '其他' },
] as const;

/** 报告内容中的类别显示名（含支持包模式专用的 support 类别，不在胶囊选择器中展示） */
const CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])),
  support: '整机支持包',
};

/** 构建 AI 报告 Markdown 内容（导出与报告管理一致） */
function buildReportContent(result: string, categoryKey: string, fileName: string, model: string): string {
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
function buildReportFileName(originalFileName: string): string {
  const now = new Date();
  const dateStr = `${String(now.getFullYear()).slice(2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  return `AI分析报告（${originalFileName}）_${dateStr} ${timeStr}.md`;
}

export function AIAnalysisPanel() {
  const navigate = useNavigate();
  const { resolved, loadResolved, refreshResolved, currentModel } = useAIConfigStore();
  const { user } = useAuthStore();
  const [category, setCategory] = useState<string>('host');
  // 输入模式：单文件（默认）⇄ 支持包（压缩包整包分析）
  const [inputMode, setInputMode] = useState<'file' | 'archive'>('file');
  // 切到支持包模式前的类别，切回单文件模式时恢复
  const prevCategoryRef = useRef<string>('host');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 结果区自动滚动：流式输出时跟随到最新内容；用户手动上翻时暂停跟随，回到底部附近后恢复
  const resultScrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  // 页面级自动滚动：流式输出时整个网页同步滚到底部；用户上翻页面时暂停，回到底部附近恢复
  const pageFollowRef = useRef(true);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showSupplementForm, setShowSupplementForm] = useState(false);
  const [showKnowledgePicker, setShowKnowledgePicker] = useState(false);
  // 为每个类别独立保存自定义提示词；null 表示使用默认提示词
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [supplements, setSupplements] = useState<AssetSupplement[]>([]);
  const [knowledgeFileIds, setKnowledgeFileIds] = useState<string[]>([]);
  const [knowledgeFileNames, setKnowledgeFileNames] = useState<string[]>([]);
  // 用户补充提示（可选）：给 AI 的方向性背景信息
  const [userHint, setUserHint] = useState('');
  const [showHintEditor, setShowHintEditor] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 动态扩展名列表（从 /api/public-config 获取，与系统设置联动）
  const [archiveExts, setArchiveExts] = useState<string[]>(['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.tar.bz2', '.tar.xz']);
  const [textExts, setTextExts] = useState<string[]>(['.txt', '.log', '.conf', '.csv', '.xml', '.json', '.yml', '.yaml', '.out', '.err', '.md', '.xlsx', '.xls']);
  // Agentic 分析进度消息（支持包智能分析模式）
  const [packProgress, setPackProgress] = useState('');

  // 当前类别实际使用的提示词（自定义 > 默认）
  const currentPrompt = customPrompts[category] ?? DEFAULT_PROMPTS[category];
  const isCustomized = category in customPrompts;

  // 加载服务端解析后的 AI 配置（已有缓存时轻量刷新，同步设置页的变更）
  useEffect(() => {
    if (!resolved) loadResolved();
    else refreshResolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从后端公开配置同步扩展名列表（系统设置页可自定义）
  useEffect(() => {
    fetch(getApiUrl('/public-config'), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.data?.archiveExtensions) && d.data.archiveExtensions.length > 0) setArchiveExts(d.data.archiveExtensions);
        if (Array.isArray(d?.data?.textExtensions) && d.data.textExtensions.length > 0) setTextExts(d.data.textExtensions);
      })
      .catch(() => { /* 保持默认值 */ });
  }, []);

  /** 当前生效模型的展示名（用于报告内容） */
  const currentModelName = () => currentModel()?.displayName ?? '系统默认';

  /** 文件名是否匹配压缩包扩展名（含复合扩展名如 .tar.gz） */
  const isArchiveName = (name: string) => {
    const lower = name.toLowerCase();
    return archiveExts.some((ext) => lower.endsWith(ext));
  };

  /** 切换输入模式：保存/恢复类别，清空不匹配模式的已选文件 */
  const switchInputMode = (mode: 'file' | 'archive') => {
    if (mode === inputMode) return;
    if (mode === 'archive') {
      prevCategoryRef.current = category;
      setCategory('support');
      if (selectedFile && !isArchiveName(selectedFile.name)) setSelectedFile(null);
    } else {
      setCategory(prevCategoryRef.current);
      if (selectedFile && isArchiveName(selectedFile.name)) setSelectedFile(null);
    }
    setInputMode(mode);
    setResult(null); setStreamingText(''); setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { toast.error('文件不能超过 50MB'); return; }
      setSelectedFile(file); setResult(null); setStreamingText(''); setError(null);
      // 文件类型与模式不匹配时自动切换模式
      const isArchive = isArchiveName(file.name);
      if (isArchive && inputMode === 'file') {
        prevCategoryRef.current = category;
        setCategory('support');
        setInputMode('archive');
        toast.info('检测到压缩包，已切换到支持包模式，将自动提取包内关键日志进行整体分析');
      } else if (!isArchive && inputMode === 'archive') {
        setInputMode('file');
        setCategory(prevCategoryRef.current);
        toast.info('检测到单文件，已切换回单文件模式');
      }
    }
  };

  // 流式输出时自动滚动到最新内容（用户上翻阅读时暂停跟随，回到底部附近自动恢复）
  useEffect(() => {
    const el = resultScrollRef.current;
    if (!el || userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingText, result]);

  // 页面级跟随：主内容区（#app-main-scroll）滚动时，用户上翻离开底部则暂停，回到距底部 120px 内恢复
  useEffect(() => {
    const sc = document.getElementById('app-main-scroll');
    if (!sc) return;
    const onScroll = () => {
      pageFollowRef.current = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, []);

  // 流式输出时主内容区同步滚到底部，保证最新内容始终可见（完成时最后定位一次）
  useEffect(() => {
    if (!pageFollowRef.current) return;
    if (!analyzing && !result) return;
    const sc = document.getElementById('app-main-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [streamingText, result, analyzing]);

  // 用户手动滚动：离开底部则暂停跟随，回到距底部 60px 内恢复跟随
  const handleResultScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60;
  };

  const handleAnalyze = async () => {
    if (!selectedFile || analyzing) return;
    setAnalyzing(true); setResult(null); setStreamingText(''); setError(null);
    userScrolledUpRef.current = false; // 新一轮分析恢复自动跟随滚动
    pageFollowRef.current = true;      // 页面级跟随同步恢复
    try {
      // 秒传判定：完整计算文件 SHA-256，命中去重存储则不再上传
      let dedupHash = '';
      try {
        const buf = await selectedFile.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const existing = await checkFileHashes([hash]);
        if (existing[hash]) dedupHash = hash;
      } catch { /* 计算失败则走正常上传 */ }

      const formData = new FormData();
      if (dedupHash) formData.append('dedupHash', dedupHash);
      else formData.append('file', selectedFile);
      formData.append('category', category);
      formData.append('customPrompt', currentPrompt);
      formData.append('supplements', JSON.stringify(supplements));
      formData.append('knowledgeFileIds', JSON.stringify(knowledgeFileIds));
      formData.append('modelId', useAIConfigStore.getState().selectedModelId ?? '');
      if (userHint.trim()) formData.append('userHint', userHint.trim());
      const res = await fetch(getApiUrl('/ai/analyze-file'), { method: 'POST', credentials: 'include', body: formData });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || data.error || '分析请求失败'); }
      if (dedupHash) toast.info('文件已存在，使用秒传模式');
      // 后端走 .env 系统默认兜底时打 X-AI-Fallback 响应头，点亮共享提示条
      if (res.headers.get('X-AI-Fallback') === 'true') useAIConfigStore.getState().setFallbackNotice(true);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('不支持流式响应');
      const decoder = new TextDecoder(); let fullText = '';
      // 跨 read 循环的行缓冲：TCP 分片可能把一条 data: 行切断，
      // 只处理以 \n 结尾的完整行，不完整部分留给下一轮拼接（与 aiService.sendMessageStream 同款修法）
      let buffer = '';
      /** 解析一行 SSE 数据（忽略空行 / [DONE] / 非 data 行）；支持 pack_progress 进度消息和 fallback_notice */
      const handleLine = (line: string) => {
        const t = line.trim(); if (!t || !t.startsWith('data: ')) return;
        const dp = t.slice(6); if (dp === '[DONE]') return;
        try {
          const parsed = JSON.parse(dp);
          // Agentic 支持包分析的进度消息
          if (parsed.type === 'pack_progress' && parsed.message) { setPackProgress(parsed.message); return; }
          // Agentic 模式的 fallback 通知（无响应头，通过 SSE 传递）
          if (parsed.type === 'fallback_notice') { useAIConfigStore.getState().setFallbackNotice(true); return; }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) { fullText += delta; setStreamingText(fullText); }
        } catch { /* 忽略无法解析的行 */ }
      };
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 末尾不完整的一行（可能为空串）留到下一轮
          buffer = lines.pop() || '';
          for (const line of lines) handleLine(line);
        }
        // 流结束后若 buffer 还残留完整行，再处理一次
        if (buffer.trim()) handleLine(buffer);
      } finally { reader.releaseLock(); }
      setResult(fullText); setStreamingText(''); setPackProgress('');
      // 分析完成后自动保存到后端（保存与前端导出完全一致的内容和文件名）
      try {
        const reportContent = buildReportContent(fullText, category, selectedFile.name, currentModelName());
        const saveRes = await fetch(getApiUrl('/reports/ai-save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            content: reportContent,
            originalFileName: selectedFile.name,
            category,
            author: user?.displayName || user?.username || '当前用户',
          }),
        });
        if (saveRes.ok) {
          toast.success('AI分析报告已自动保存到报告管理');
        } else {
          const errData = await saveRes.json().catch(() => ({}));
          toast.error(errData.message || '报告保存失败');
        }
      } catch { /* 保存失败不影响分析结果展示 */ }
    } catch (err: any) { setError(err.message || '分析失败'); toast.error(err.message || '分析失败'); }
    finally { setAnalyzing(false); }
  };

  const handleExport = () => {
    if (!result || !selectedFile) return;
    const reportContent = buildReportContent(result, category, selectedFile.name, currentModelName());
    const fileName = buildReportFileName(selectedFile.name);
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = fileName; a.click();
    URL.revokeObjectURL(url); toast.success('报告已导出');
  };

  const formatFileSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 配置尚未加载完成时不渲染（ModelSelector 同样返回 null，行为一致）
  if (!resolved) return null;

  // 未配置状态（服务端无任何可用模型）
  if (!currentModel()) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="flex flex-col items-center py-12 space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500" />
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold text-amber-700">AI 模型未配置</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              在使用 AI 智能分析功能前，需要先配置 AI 模型的 API Key 和接口地址。
              支持 DeepSeek、Kimi、通义千问、小米 MiMo 等主流厂商。
            </p>
          </div>
          <Button onClick={() => navigate(ROUTES.AI_SETTINGS)}>
            <Settings className="h-4 w-4 mr-2" />
            前往 AI 设置
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />AI 智能分析
            </CardTitle>
            <ModelSelector />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 系统默认配置兜底提示（X-AI-Fallback） */}
          <AIFallbackNotice />
          {/* 分析类别（可换行胶囊选择器，任意数量类别都不会溢出）；支持包模式自动使用整机支持包提示词，隐藏类别选择 */}
          {inputMode === 'file' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">分析类别</div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    disabled={analyzing}
                    onClick={() => setCategory(cat.key)}
                    className={cn(
                      'px-4 py-2 rounded-full text-sm border transition-all',
                      category === cat.key
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
              支持包模式将自动拆包，并使用「整机支持包」分析提示词，无需选择分析类别。
            </p>
          )}

          {/* 输入模式 */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">输入模式</div>
            <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => switchInputMode('file')}
                className={cn('px-4 py-2 rounded-md transition-all',
                  inputMode === 'file'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')}
              >
                单文件模式
              </button>
              <button
                type="button"
                onClick={() => switchInputMode('archive')}
                className={cn('px-4 py-2 rounded-md transition-all',
                  inputMode === 'archive'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')}
              >
                支持包模式
              </button>
            </div>
          </div>

          {/* 高级选项 */}
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground pb-0.5">高级选项</div>
          {/* 补充信息表单：主机/存储/交换机为「设备信息补充」，虚拟化/数据库为「信息补充」，「其他」类别不展示 */}
          {category !== 'other' && (
          <div className="space-y-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              onClick={() => setShowSupplementForm(!showSupplementForm)}
            >
              {showSupplementForm ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {category === 'virtualization' || category === 'database' ? '信息补充' : '设备信息补充'} {showSupplementForm ? '（点击收起）' : '（点击展开添加）'}
              {supplements.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">{supplements.length} 条</Badge>
              )}
            </button>
            {showSupplementForm && (
              <AssetSupplementForm
                reportId={`temp_${Date.now()}`}
                assetType={category as AssetType}
                onSupplementsChange={setSupplements}
                initialSupplements={supplements}
              />
            )}
          </div>
          )}

          {/* 知识库文件选择器 */}
          <div className="space-y-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              onClick={() => setShowKnowledgePicker(!showKnowledgePicker)}
            >
              {showKnowledgePicker ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              知识库参考 {showKnowledgePicker ? '（点击收起）' : '（点击展开选择）'}
              {knowledgeFileIds.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">{knowledgeFileIds.length} 个文件</Badge>
              )}
            </button>
            {showKnowledgePicker && (
              <KnowledgeFilePicker
                selectedIds={knowledgeFileIds}
                selectedNames={knowledgeFileNames}
                onChange={(ids, names) => { setKnowledgeFileIds(ids); setKnowledgeFileNames(names); }}
              />
            )}
          </div>

          {/* 提示词编辑器 */}
          <div className="space-y-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              onClick={() => setShowPromptEditor(!showPromptEditor)}
            >
              {showPromptEditor ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              分析提示词 {showPromptEditor ? '（点击收起）' : '（点击展开编辑）'}
              {isCustomized && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">已自定义</Badge>
              )}
            </button>
            {showPromptEditor && (
              <div className="space-y-1.5">
                <Textarea
                  value={currentPrompt}
                  onChange={(e) => setCustomPrompts((prev) => ({ ...prev, [category]: e.target.value }))}
                  className="min-h-[140px] text-sm font-mono"
                  placeholder="输入自定义分析提示词..."
                  disabled={analyzing}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-sm"
                    disabled={!isCustomized}
                    onClick={() => {
                      setCustomPrompts((prev) => {
                        const next = { ...prev };
                        delete next[category];
                        return next;
                      });
                    }}
                  >
                    恢复默认
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 补充提示（可选） */}
          <div className="space-y-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              onClick={() => setShowHintEditor(!showHintEditor)}
            >
              {showHintEditor ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              补充提示 {showHintEditor ? '（点击收起）' : '（点击展开填写）'}
              {userHint.trim() && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">已填写</Badge>
              )}
            </button>
            {showHintEditor && (
              <Textarea
                value={userHint}
                onChange={(e) => setUserHint(e.target.value)}
                className="min-h-[60px] text-sm"
                placeholder="可选：告诉 AI 重点关注方向，例如「已确认硬盘故障，请重点检查存储子系统」"
                disabled={analyzing}
                maxLength={2000}
              />
            )}
          </div>
          </div>

          {/* 文件上传 */}
          <div className={cn('group border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
            selectedFile ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/60 hover:bg-primary/[0.03]',
            analyzing && 'pointer-events-none opacity-50')}
            onClick={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" className="hidden" accept={[...textExts, ...archiveExts].join(',')} onChange={handleFileChange} />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                {selectedFile.name.match(/\.(xlsx|xls)$/i) ? <FileSpreadsheet className="h-8 w-8 text-green-600" />
                 : isArchiveName(selectedFile.name) ? <Archive className="h-8 w-8 text-amber-600" />
                 : <FileText className="h-8 w-8 text-primary" />}
                {isArchiveName(selectedFile.name) && (
                  <Badge variant="secondary" className="text-[10px]">整包智能分析</Badge>
                )}
                <div className="text-left"><p className="font-medium">{selectedFile.name}</p><p className="text-sm text-muted-foreground">{formatFileSize(selectedFile.size)}</p></div>
                {!analyzing && <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setResult(null); }}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}
              </div>
            ) : (
              <div className="space-y-3">
                <div className={cn('mx-auto h-12 w-12 rounded-full flex items-center justify-center transition-colors',
                  inputMode === 'archive' ? 'bg-amber-500/10 group-hover:bg-amber-500/15' : 'bg-primary/10 group-hover:bg-primary/15')}>
                  {inputMode === 'archive'
                    ? <Archive className="h-5 w-5 text-amber-600" />
                    : <Upload className="h-5 w-5 text-primary" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">{inputMode === 'archive' ? '点击上传支持包压缩包' : '点击上传巡检日志文件'}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{inputMode === 'archive' ? `支持 ${archiveExts.join(' ')}，最大 50MB，将自动拆包分析` : `支持 ${textExts.slice(0, 6).join(' ')} 等，最大 50MB`}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={handleAnalyze} disabled={!selectedFile || analyzing} className="flex-1 h-10 shadow-sm">
              {analyzing ? <LoadingSpinner className="inline-flex py-0 mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              {analyzing ? 'AI 分析中...' : '开始 AI 分析'}
            </Button>
            {result && <Button variant="outline" className="h-10" onClick={handleExport}><Download className="h-4 w-4 mr-2" />导出报告</Button>}
          </div>
          {/* Agentic 支持包分析进度 */}
          {analyzing && packProgress && (
            <div className="flex items-center gap-2 rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-sm text-primary animate-pulse">
              <Bot className="h-4 w-4 shrink-0" />
              {packProgress}
            </div>
          )}
        </CardContent>
      </Card>

      {(streamingText || result || error) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {error ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <CheckCircle className="h-5 w-5 text-green-500" />}
                {analyzing ? '分析中...' : error ? '分析出错' : '分析结果'}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">{error}</p>
                {error.includes('401') || error.includes('无效') || error.includes('过期') ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.AI_SETTINGS)}>
                    <Settings className="h-3.5 w-3.5 mr-1" />检查 API 配置
                  </Button>
                ) : null}
              </div>
            ) : (
              <div ref={resultScrollRef} onScroll={handleResultScroll} className="max-h-[60vh] overflow-y-auto pr-2">
                <div className="prose prose-sm max-w-none">
                  <MarkdownRenderer content={streamingText || result || ''} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
