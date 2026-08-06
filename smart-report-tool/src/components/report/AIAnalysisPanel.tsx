/**
 * AI 智能分析面板
 *
 * 支持上传巡检日志文件，选择分析类别和 AI 模型，流式生成分析报告。
 * 未配置 AI 时显示引导提示。
 *
 * 分析任务由全局任务队列（analysisTaskStore）执行：
 * - 切换到其他页面再回来，正在进行的分析状态完整保留
 * - 分析中可「转后台运行」，立即准备下一个分析；多个任务自动排队逐个执行
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, Bot, Download, Trash2, AlertTriangle, CheckCircle, Zap, Settings, ChevronDown, ChevronUp, FileSpreadsheet, Archive, ListTodo, X, Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer';
import { AssetSupplementForm, AssetSupplement, AssetType } from '@/components/AssetSupplementForm';
import { KnowledgeFilePicker } from '@/components/report/KnowledgeFilePicker';
import { ModelSelector } from '@/components/ai/ModelSelector';
import { AIFallbackNotice } from '@/components/ai/AIFallbackNotice';
import { useAIConfigStore } from '@/stores/aiConfigStore';
import { useAuthStore } from '@/stores/authStore';
import { useAnalysisTaskStore, buildReportContent, buildReportFileName } from '@/stores/analysisTaskStore';
import { getApiUrl } from '@/services/api';
import { ROUTES } from '@/constants/routes';
import { DEFAULT_PROMPTS } from '@/constants/analysisPrompts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** 分析类别（胶囊选择器） */
const CATEGORIES = [
  { key: 'host', label: '主机' },
  { key: 'storage', label: '存储' },
  { key: 'network', label: '交换机' },
  { key: 'virtualization', label: '虚拟化' },
  { key: 'database', label: '数据库' },
  { key: 'other', label: '其他' },
] as const;

export function AIAnalysisPanel() {
  const navigate = useNavigate();
  const { resolved, loadResolved, refreshResolved, currentModel } = useAIConfigStore();
  const { user } = useAuthStore();
  const { tasks, activeTaskId, enqueue, setActiveTask, removeTask, loadTasks } = useAnalysisTaskStore();
  const [category, setCategory] = useState<string>('host');
  // 输入模式：单文件（默认）⇄ 支持包（压缩包整包分析）
  const [inputMode, setInputMode] = useState<'file' | 'archive'>('file');
  // 切到支持包模式前的类别，切回单文件模式时恢复
  const prevCategoryRef = useRef<string>('host');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  /** 当前正在查看的任务（切页回来自动恢复） */
  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;
  const taskRunning = activeTask?.status === 'running';
  const hasRunningTask = tasks.some((t) => t.status === 'running');
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;

  // 当前类别实际使用的提示词（自定义 > 默认）
  const currentPrompt = customPrompts[category] ?? DEFAULT_PROMPTS[category];
  const isCustomized = category in customPrompts;

  // 加载服务端解析后的 AI 配置（已有缓存时轻量刷新，同步设置页的变更）
  useEffect(() => {
    if (!resolved) loadResolved();
    else refreshResolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 挂载时从后端恢复任务队列：刷新页面/换页后能看到进行中的任务并接续实时输出
  useEffect(() => {
    void loadTasks();
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
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { toast.error('文件不能超过 50MB'); return; }
      setSelectedFile(file);
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
  }, [activeTask?.streamingText, activeTask?.result]);

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
    if (!taskRunning && !activeTask?.result) return;
    const sc = document.getElementById('app-main-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [activeTask?.streamingText, activeTask?.result, taskRunning]);

  // 用户手动滚动：离开底部则暂停跟随，回到距底部 60px 内恢复跟随
  const handleResultScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60;
  };

  /** 提交分析：快照当前表单参数入队；有任务在跑则自动排队 */
  const handleAnalyze = () => {
    if (!selectedFile) return;
    enqueue({
      file: selectedFile,
      category,
      customPrompt: currentPrompt,
      supplements,
      knowledgeFileIds,
      modelId: useAIConfigStore.getState().selectedModelId ?? null,
      userHint,
      author: user?.displayName || user?.username || '当前用户',
      modelName: currentModelName(),
    });
    // 新一轮分析恢复自动跟随滚动
    userScrolledUpRef.current = false;
    pageFollowRef.current = true;
    // 清空已选文件，便于直接准备下一个分析任务
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExport = () => {
    if (!activeTask?.result) return;
    const reportContent = buildReportContent(activeTask.result, activeTask.category, activeTask.fileName, activeTask.payload.modelName);
    const fileName = buildReportFileName(activeTask.fileName);
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
      {/* 任务队列条：运行中 / 排队 / 已完成任务一览，点击切换查看 */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border bg-card px-3 py-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            <ListTodo className="h-3.5 w-3.5" />
            分析任务
            {hasRunningTask && <span className="text-primary">· 1 个进行中</span>}
            {queuedCount > 0 && <span className="text-amber-600">· {queuedCount} 个排队</span>}
          </span>
          {tasks.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs cursor-pointer transition-colors max-w-64',
                t.id === activeTaskId ? 'border-primary bg-primary/10' : 'hover:bg-accent',
              )}
              onClick={() => setActiveTask(t.id)}
              title={t.fileName}
            >
              {t.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
              {t.status === 'queued' && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
              {t.status === 'done' && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
              {t.status === 'error' && <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}
              <span className="truncate">{t.fileName}</span>
              {t.status !== 'running' && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground/50 hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); removeTask(t.id); }}
                  title="移除记录"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />AI 智能分析
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
              <div className="flex flex-wrap gap-1 rounded-lg border p-1 w-fit">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={cn('px-3.5 py-1.5 text-sm rounded-md transition-colors',
                      category === c.key ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted')}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              支持包模式将自动拆包，并使用「整机支持包」分析提示词，无需选择分析类别。
            </div>
          )}

          {/* 输入模式切换 */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">输入模式</div>
            <div className="flex flex-wrap gap-1 rounded-lg border p-1 w-fit">
              <button
                type="button"
                onClick={() => switchInputMode('file')}
                className={cn('px-3.5 py-1.5 text-sm rounded-md transition-colors',
                  inputMode === 'file' ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')}
              >
                单文件模式
              </button>
              <button
                type="button"
                onClick={() => switchInputMode('archive')}
                className={cn('px-3.5 py-1.5 text-sm rounded-md transition-colors',
                  inputMode === 'archive' ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground')}
              >
                支持包模式
              </button>
            </div>
          </div>

          {/* 高级选项 */}
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground pb-0.5">高级选项</div>
          {/* 补充信息表单：主机/存储/交换机为「设备信息补充」，虚拟化/数据库为「信息补充」，「其他」类别不展示；
              支持包模式（support）按整机对待，复用主机（服务器）字段 */}
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
                assetType={(category === 'support' ? 'host' : category) as AssetType}
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
                maxLength={2000}
              />
            )}
          </div>
          </div>

          {/* 文件上传 */}
          <div className={cn('group border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
            selectedFile ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/60 hover:bg-primary/[0.03]')}
            onClick={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" className="hidden" accept={inputMode === 'archive' ? archiveExts.join(',') : textExts.join(',')} onChange={handleFileChange} />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                {selectedFile.name.match(/\.(xlsx|xls)$/i) ? <FileSpreadsheet className="h-8 w-8 text-green-600" />
                 : isArchiveName(selectedFile.name) ? <Archive className="h-8 w-8 text-amber-600" />
                 : <FileText className="h-8 w-8 text-primary" />}
                {isArchiveName(selectedFile.name) && (
                  <Badge variant="secondary" className="text-[10px]">整包智能分析</Badge>
                )}
                <div className="text-left"><p className="font-medium">{selectedFile.name}</p><p className="text-sm text-muted-foreground">{formatFileSize(selectedFile.size)}</p></div>
                <Button variant="ghost" size="icon" className="shrink-0" onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
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
            <Button onClick={handleAnalyze} disabled={!selectedFile} className="flex-1 h-10 shadow-sm">
              <Zap className="h-4 w-4 mr-2" />
              {hasRunningTask || queuedCount > 0 ? '加入分析队列' : '开始 AI 分析'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 结果卡片：查看中的任务（运行中/完成/失败） */}
      {activeTask && (activeTask.status === 'running' || activeTask.streamingText || activeTask.result || activeTask.error) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                {activeTask.error ? <AlertTriangle className="h-4 w-4 text-destructive" />
                  : taskRunning ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  : <CheckCircle className="h-4 w-4 text-green-500" />}
                {taskRunning ? '分析中...' : activeTask.error ? '分析出错' : '分析结果'}
                <span className="text-xs font-normal text-muted-foreground truncate max-w-72" title={activeTask.fileName}>
                  {activeTask.fileName}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                {taskRunning && (
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setActiveTask(null)}>
                    <ListTodo className="h-3.5 w-3.5 mr-1.5" />转后台运行
                  </Button>
                )}
                {activeTask.result && (
                  <Button variant="outline" size="sm" className="h-8" onClick={handleExport}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />导出报告
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Agentic 支持包分析进度 */}
            {taskRunning && activeTask.packProgress && (
              <div className="flex items-center gap-2 rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-sm text-primary animate-pulse">
                <Bot className="h-4 w-4 shrink-0" />
                {activeTask.packProgress}
              </div>
            )}
            {activeTask.error ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">{activeTask.error}</p>
                {activeTask.error.includes('401') || activeTask.error.includes('无效') || activeTask.error.includes('过期') ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.AI_SETTINGS)}>
                    <Settings className="h-3.5 w-3.5 mr-1" />检查 API 配置
                  </Button>
                ) : null}
              </div>
            ) : (
              <div ref={resultScrollRef} onScroll={handleResultScroll} className="max-h-[60vh] overflow-y-auto pr-2">
                <div className="prose prose-sm max-w-none">
                  <MarkdownRenderer content={activeTask.streamingText || activeTask.result || ''} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
