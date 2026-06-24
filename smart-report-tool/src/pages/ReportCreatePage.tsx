import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { useReportStore } from '@/stores/reportStore';
import { useAuthStore } from '@/stores/authStore';
import { useLogPersistence } from '@/hooks/useLogPersistence';
import { Script, OutputFormat, LogCategory, Report } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { BatchFileUploader } from '@/components/report/BatchFileUploader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ChevronRight, CheckCircle, Download, Terminal, History, Package, Check, AlertCircle, X as XIcon, RefreshCw } from 'lucide-react';
import { getApiUrl, fetchWithAuth, getRunningReportId, clearRunningReportId, pollReportLogs, pollReportStatus } from '@/services/api';

type CATEGORY_LABELS = Record<LogCategory, string>;
const CATEGORY_LABELS: CATEGORY_LABELS = { host: '主机', storage: '存储', database: '数据库', virtualization: '虚拟化', network: '网络' };
const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = { html: 'HTML', md: 'Markdown', docx: 'Word (DOCX)', xlsx: 'Excel', pdf: 'PDF' };

export default function ReportCreatePage() {
  const { scripts, fetchScripts } = useScriptStore();
  const { docTemplates, fetchDocTemplates } = useDocTemplateStore();
  const { generationState, setGenerationState, resetGenerationState, generateReport } = useReportStore();
  const { user } = useAuthStore();
  const logsEndRef = useRef<HTMLDivElement>(null);

  // AbortController for download requests
  const downloadAbortRef = useRef<AbortController | null>(null);

  // 使用日志持久化 hook
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    // 从 URL 或 localStorage 恢复会话ID
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('sessionId') || localStorage.getItem('current_report_session') || '';
  });

  const {
    logs: execLogs,
    isRestored,
    addLog,
    clearLogs,
    updateStatus,
    setSessionId,
    setLogLines,
  } = useLogPersistence(currentSessionId);

  const lastReportIdRef = useRef<string>('');
  const lastReportRef = useRef<Report | null>(null);
  const [manualTemplate, setManualTemplate] = useState(false);

  // 依赖未就绪警告弹窗
  const [showDepsWarning, setShowDepsWarning] = useState(false);

  // 保存当前会话ID到 localStorage
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('current_report_session', currentSessionId);
    }
  }, [currentSessionId]);

  const isDepsStatusDone = (status?: string) => status === 'done' || status === 'success';

  /** 判断脚本依赖是否已就绪 */
  const isDepsReady = (s: Script): boolean => {
    if (s.scriptType !== 'python') return true;
    if (!s.requirements || s.requirements.length === 0) return true;
    const ds = (s as any).depsStatus as { status?: string; packages?: string[] } | undefined;
    return isDepsStatusDone(ds?.status);
  };

  /** 获取脚本未就绪的依赖列表 */
  const getUnreadyDeps = (s: Script): string[] => {
    if (!s.requirements) return [];
    const ds = (s as any).depsStatus as { status?: string; packages?: string[] } | undefined;
    if (isDepsStatusDone(ds?.status)) return [];
    // 返回所有配置的依赖（因为它们都未安装/未状态）
    return s.requirements;
  };

  // 步骤配置：根据是否手动选模板决定步骤2是否可见
  const stepConfig = useMemo(() => {
    const all = [
      { key: 1, label: '选择脚本' },
      { key: 2, label: '选择模板' },
      { key: 3, label: '巡检数据' },
      { key: 4, label: '报告信息' },
      { key: 5, label: '确认生成' },
    ];
    return manualTemplate ? all : all.filter((s) => s.key !== 2);
  }, [manualTemplate]);

  const currentStepIndex = stepConfig.findIndex((s) => s.key === generationState.step);

  /** 按 stepConfig 获取下一步的 key */
  const nextStep = (): 1 | 2 | 3 | 4 | 5 => {
    const idx = stepConfig.findIndex((s) => s.key === generationState.step);
    return (idx >= 0 && idx < stepConfig.length - 1 ? stepConfig[idx + 1].key : generationState.step) as 1 | 2 | 3 | 4 | 5;
  };
  /** 按 stepConfig 获取上一步的 key */
  const prevStep = (): 1 | 2 | 3 | 4 | 5 => {
    const idx = stepConfig.findIndex((s) => s.key === generationState.step);
    return (idx > 0 ? stepConfig[idx - 1].key : generationState.step) as 1 | 2 | 3 | 4 | 5;
  };

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const LAST_NAME_KEY = 'report_last_name';

  useEffect(() => { fetchScripts(); fetchDocTemplates(); }, [fetchScripts, fetchDocTemplates]);

  // Deduplicate scripts by ID, then by fileName within filtered list
  const allScripts = useMemo(() => {
    const seen = new Map<string, Script>();
    for (const s of scripts) seen.set(s.id, s);
    return Array.from(seen.values());
  }, [scripts]);

  // 步骤2展示所有脚本，不再按分类过滤；去重（同 filename+name 只保留一个）
  // 区域过滤：成员只能看到自己区域的脚本 + "全部"区域的脚本
  const filteredScripts = useMemo(() => {
    const seen = new Map<string, Script>();
    for (const s of allScripts) {
      // 区域过滤
      if (user?.role === 'member') {
        const userRegion = user.region || '全部';
        const scriptRegion = s.region || '全部';
        if (userRegion !== '全部' && scriptRegion !== '全部' && scriptRegion !== userRegion) continue;
      }
      const key = s.fileName + '_' + s.name;
      if (!seen.has(key)) seen.set(key, s);
    }
    return Array.from(seen.values());
  }, [allScripts, user]);

  const selectedScript = allScripts.find((s) => s.id === generationState.selectedScriptId);
  const selectedDocTemplate = docTemplates.find((t) => t.id === generationState.selectedTemplateId);

  const doneInputFiles = generationState.inputFiles.filter((f) => f.status === 'done');

  // 填入步骤4的智能默认值
  const fillStep4Defaults = useCallback(() => {
    const patches = patchDefaults(generationState, selectedScript, user, today);
    if (Object.keys(patches).length > 0) {
      setGenerationState(patches);
    }
  }, [generationState, selectedScript, user, today, setGenerationState]);

  function patchDefaults(gs: typeof generationState, script: Script | undefined, u: typeof user, todayStr: string) {
    const patches: Partial<typeof generationState> = {};
    let info = gs.reportInfo;

    // 只有关键字段都为空时才填充默认值，避免覆盖用户已填写的内容
    if (!info.name && !info.date && !info.author) {
      if (!info.name) {
        info = { ...info, name: script ? `${script.name}报告` : '' };
      }
      if (!info.date) {
        info = { ...info, date: todayStr };
      }
      if (!info.author && u?.displayName) {
        info = { ...info, author: u.displayName, authorId: u.id };
      }
    }

    if (info !== gs.reportInfo) patches.reportInfo = info;
    if (gs.logCategory === 'host' && script?.category) {
      patches.logCategory = script.category as LogCategory;
    }
    return patches;
  }

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [execLogs]);

  /** 页面恢复后轮询获取最新日志和状态（修复：立即获取 + 持续轮询） */
  useEffect(() => {
    if (!currentSessionId) return;

    let stopPolling = false;

    const poll = async () => {
      // 等待 reportId 可用（SSE 的 started 事件可能还没触发），最多等 30 秒
      let reportId = getRunningReportId();
      for (let wait = 0; wait < 30 && !reportId && !stopPolling; wait++) {
        await new Promise((r) => setTimeout(r, 1000));
        reportId = getRunningReportId();
      }
      if (!reportId || stopPolling) return;

      setGenerationState({ status: 'generating' });
      // 首次不延迟，立即获取最新日志
      let firstFetch = true;

      const maxRetries = 300; // 最多等 5 分钟
      for (let i = 0; i < maxRetries; i++) {
        if (stopPolling) return;
        try {
          if (!firstFetch) {
            await new Promise((r) => setTimeout(r, 1000));
          }
          firstFetch = false;

          // 获取最新日志
          const freshLogs = await pollReportLogs(reportId);
          if (freshLogs.length > 0) {
            setLogLines(freshLogs);
          }

          // 获取状态
          const { report, isRunning } = await pollReportStatus(reportId);
          if (report) {
            lastReportIdRef.current = report.id;
            lastReportRef.current = report;
          }
          if (!isRunning && report && report.status !== 'generating') {
            const finalStatus = report.status === 'success' ? 'success' : 'failed';
            setGenerationState({ progress: 100, status: finalStatus });
            updateStatus(finalStatus);
            clearRunningReportId();
            if (report.status === 'failed') {
              addLog('');
              addLog('========================================');
              addLog('报告生成失败，请查看上方日志排查原因');
              addLog('========================================');
            }
            return;
          }
        } catch {
          // 网络错误等，继续重试
        }
      }
    };
    poll();

    return () => { stopPolling = true; };
  }, [currentSessionId]);

  const canGoNext = (): boolean => {
    switch (generationState.step) {
      case 1: return !!generationState.selectedScriptId;
      case 2: return manualTemplate && (!!generationState.selectedTemplateId);
      case 3: return doneInputFiles.length > 0;
      case 4: return !!generationState.reportInfo.name.trim();
      default: return true;
    }
  };

  const handleGenerate = async () => {
    // 生成新的会话ID用于日志持久化
    const newSessionId = `report_${Date.now()}_${crypto.randomUUID()}`;
    clearLogs(); // 先清除旧会话日志
    setCurrentSessionId(newSessionId);
    setSessionId(newSessionId);

    setGenerationState({ status: 'generating', progress: 0 });

    // 记录上次报告名称
    const name = generationState.reportInfo.name;
    if (name) localStorage.setItem(LAST_NAME_KEY, name);

    const info = generationState.reportInfo;
    const script = selectedScript;
    const template = selectedDocTemplate;
    const format = generationState.outputFormat;

    if (!script) {
      toast.error('未选择脚本');
      setGenerationState({ status: 'idle' });
      return;
    }

    // 脚本关联了模板但前端未手动选择 → 自动选第一个可用的关联模板
    let finalTemplateId = template?.id || '';
    if (!finalTemplateId && script.templateIds && script.templateIds.length > 0) {
      const validId = script.templateIds.find((tid) => docTemplates.some((t) => t.id === tid));
      if (validId) {
        finalTemplateId = validId;
        addLog(`[自动] 已选择关联模板: ${docTemplates.find(t => t.id === validId)?.name || validId}`);
      }
    }

    addLog('========================================');
    addLog('开始生成报告...');
    addLog(`报告名称: ${info.name}`);
    addLog(`处理脚本: ${script.name}`);
    addLog(`输出格式: ${OUTPUT_FORMAT_LABELS[format]}`);
    addLog(`会话ID: ${newSessionId}`);
    addLog('========================================');

    try {
      const backendReport = await generateReport({
        scriptId: script.id,
        templateId: finalTemplateId,
        inputFiles: doneInputFiles.map((f) => f.file),
        inputHashes: doneInputFiles.map((f) => f.hash || ''),
        outputFormat: format,
        requirements: script?.requirements || [],
        reportInfo: {
          name: info.name,
          date: info.date,
          author: info.author,
          category: generationState.logCategory,
        },
      }, (msg) => {
        addLog(msg);
      });

      // Use backend's actual status
      lastReportIdRef.current = backendReport?.id || '';
      lastReportRef.current = backendReport || null;
      if (backendReport && backendReport.status === 'failed') {
        setGenerationState({ progress: 100, status: 'failed' });
        updateStatus('failed');
        addLog('');
        addLog('========================================');
        addLog('报告生成失败，请查看上方日志排查原因');
        addLog('========================================');
        toast.error('报告生成失败，请查看执行日志');
      } else {
        setGenerationState({ progress: 100, status: 'success' });
        updateStatus('success');
        toast.success('报告生成成功！');
      }
    } catch (err: any) {
      addLog('');
      addLog(`生成失败: ${err.message || String(err)}`);
      addLog('请确认后端服务是否正常运行，然后重试');
      setGenerationState({ progress: 0, status: 'failed' });
      updateStatus('failed');
      toast.error(`生成失败: ${err.message || '后端服务不可用'}`);
    }
  };

  // ── Step 1–5 UI ──
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">
        {generationState.step === 1 ? '选择脚本生成报告文件' : selectedScript?.name || '生成报告'}
      </h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {stepConfig.map((s, idx) => (
          <div key={s.key} className="flex items-center gap-1">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
              currentStepIndex === idx ? 'bg-primary text-primary-foreground'
              : currentStepIndex > idx ? 'bg-primary/20 text-primary'
              : 'bg-muted text-muted-foreground'
            }`}>
              {currentStepIndex > idx ? <CheckCircle className="h-4 w-4" /> : idx + 1}
            </div>
            <span className={`text-xs ${currentStepIndex >= idx ? 'text-foreground' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {idx < stepConfig.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 1: Select script */}
      {generationState.step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>步骤1：选择脚本</CardTitle>
            <p className="text-sm text-muted-foreground">请选择用于处理巡检数据的脚本</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch checked={manualTemplate} onCheckedChange={setManualTemplate} />
              <Label className="cursor-pointer text-sm">手动选择模板</Label>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {filteredScripts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">暂无脚本，请先在「脚本与模板」页面添加脚本</p>
              )}
              {filteredScripts.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setGenerationState({ selectedScriptId: s.id })}
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${generationState.selectedScriptId === s.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{s.name}</p>
                        {s.scriptType === 'python' && s.requirements && s.requirements.length > 0 && (
                          isDepsReady(s)
                            ? <Badge className="text-xs bg-green-100 text-green-700 border-green-300 hover:bg-green-100 pointer-events-none"><Check className="h-3 w-3 mr-0.5" />已就绪</Badge>
                            : <Badge className="text-xs bg-red-50 text-red-600 border-red-200 hover:bg-red-50 pointer-events-none"><AlertCircle className="h-3 w-3 mr-0.5" />未就绪</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{s.description || s.fileName} · {formatFileSize(s.fileSize)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Python</Badge>
                      <Badge variant="outline">v{s.version}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button disabled={!canGoNext()} onClick={() => {
                // 检查依赖是否就绪
                if (selectedScript && !isDepsReady(selectedScript)) {
                  setShowDepsWarning(true);
                  return;
                }
                // 脚本关联了模板但未手动选择 → 自动选第一个
                if (selectedScript?.templateIds?.length && !generationState.selectedTemplateId) {
                  const validId = selectedScript.templateIds.find((tid) => docTemplates.some((t) => t.id === tid));
                  if (validId) setGenerationState({ selectedTemplateId: validId, step: nextStep() });
                  else setGenerationState({ step: nextStep() });
                } else {
                  setGenerationState({ step: nextStep() });
                }
              }}>
                下一步 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select template (conditional) */}
      {generationState.step === 2 && (
        <Card>
          <CardHeader><CardTitle>步骤2：选择报告模板</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {selectedScript && selectedScript.templateIds.length > 0 ? (
              <div className="rounded-lg border p-4 bg-primary/5 border-primary/30">
                <p className="text-sm font-medium">
                  当前脚本「{selectedScript.name}」已关联模板，
                  {selectedDocTemplate ? (
                    <span>正在使用：<Badge variant="default" className="ml-1">{selectedDocTemplate.name}</Badge></span>
                  ) : (
                    <span className="text-muted-foreground">已自动选中关联模板</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1">如需更换，可在下方点击其他模板；关联模板不再重复显示</p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3">
              {(() => {
                const available = selectedScript && selectedScript.templateIds && selectedScript.templateIds.length > 0
                  ? docTemplates.filter((t) => !selectedScript!.templateIds.includes(t.id))
                  : docTemplates;
                if (available.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-8">暂无其他可选模板</p>;
                }
                return available.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setGenerationState({ selectedTemplateId: t.id })}
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${generationState.selectedTemplateId === t.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{t.name}</p>
                      {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                    </div>
                    <Badge variant="outline">{t.fileType.toUpperCase()}</Badge>
                  </div>
                </div>
                ));
              })()}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGenerationState({ step: prevStep() })}>上一步</Button>
              <Button onClick={() => {
                if (!generationState.selectedTemplateId && selectedScript?.templateIds.length) {
                  const validId = selectedScript.templateIds.find((tid) => docTemplates.some((t) => t.id === tid));
                  if (validId) setGenerationState({ selectedTemplateId: validId });
                }
                setGenerationState({ step: nextStep() });
              }}>
                下一步 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Upload data */}
      {generationState.step === 3 && (
        <Card>
          <CardHeader><CardTitle>步骤{manualTemplate ? '3' : '2'}：上传巡检数据文件</CardTitle></CardHeader>
          <CardContent>
            <BatchFileUploader
              files={generationState.inputFiles}
              onFilesChange={(files) => setGenerationState({ inputFiles: files })}
              inputFormats={selectedScript?.inputFormats}
              navButtons={
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setGenerationState({ step: prevStep() })}>上一步</Button>
                  <Button disabled={!canGoNext()} onClick={() => { fillStep4Defaults(); setGenerationState({ step: nextStep() }); }}>
                    下一步 <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              }
            />
          </CardContent>
        </Card>
      )}

      {/* Step 4: Report info */}
      {generationState.step === 4 && (
        <Card>
          <CardHeader><CardTitle>步骤4：填写报告信息</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>报告名称</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    onClick={() => {
                      const last = localStorage.getItem(LAST_NAME_KEY);
                      if (last) {
                        setGenerationState({ reportInfo: { ...generationState.reportInfo, name: last } });
                      }
                    }}
                  >
                    <History className="mr-1 h-3 w-3" />使用上次填写
                  </Button>
                </div>
                <Input value={generationState.reportInfo.name} onChange={(e) => setGenerationState({ reportInfo: { ...generationState.reportInfo, name: e.target.value } })} placeholder="如：2026年6月主机巡检报告" />
              </div>
              <div className="space-y-2">
                <Label>报告日期</Label>
                <Input type="date" value={generationState.reportInfo.date} onChange={(e) => setGenerationState({ reportInfo: { ...generationState.reportInfo, date: e.target.value } })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>报告作者</Label>
                <Input value={generationState.reportInfo.author} onChange={(e) => setGenerationState({ reportInfo: { ...generationState.reportInfo, author: e.target.value } })} placeholder="请输入作者" />
              </div>
              <div className="space-y-2">
                <Label>输出格式</Label>
                <Select value={generationState.outputFormat} onValueChange={(v) => setGenerationState({ outputFormat: v as OutputFormat })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(OUTPUT_FORMAT_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>日志分类</Label>
              <Select value={generationState.logCategory} onValueChange={(v) => setGenerationState({ logCategory: v as LogCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGenerationState({ step: prevStep() })}>上一步</Button>
              <Button disabled={!canGoNext()} onClick={() => setGenerationState({ step: nextStep() })}>
                下一步 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Confirm & generate */}
      {generationState.step === 5 && generationState.status !== 'generating' && generationState.status !== 'success' && generationState.status !== 'failed' && (
        <Card>
          <CardHeader><CardTitle>步骤5：确认并生成报告</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">报告名称：</span><span>{generationState.reportInfo.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">报告日期：</span><span>{generationState.reportInfo.date}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">报告作者：</span><span>{generationState.reportInfo.author}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">日志分类：</span>
                <Badge variant="outline">{CATEGORY_LABELS[generationState.logCategory]}</Badge>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">巡检文件：</span><span>{doneInputFiles.length} 个文件</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">处理脚本：</span><span>{selectedScript?.name || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">报告模板：</span><span>{
                selectedDocTemplate?.name ||
                (selectedScript?.templateIds?.length ? docTemplates.find(t => selectedScript.templateIds.includes(t.id))?.name : null) ||
                '-'
              }</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">输出格式：</span><span>{OUTPUT_FORMAT_LABELS[generationState.outputFormat]}</span></div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGenerationState({ step: prevStep() })}>上一步</Button>
              <Button onClick={handleGenerate}>开始生成报告</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generating / Result */}
      {(generationState.status === 'generating' || generationState.status === 'success' || generationState.status === 'failed') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              {generationState.status === 'generating' ? '正在生成报告...' :
               generationState.status === 'success' ? '报告生成成功' : '报告生成失败'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Log panel header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isRestored && (
                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    已恢复历史日志
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  共 {execLogs.length} 条日志
                </span>
              </div>
              {execLogs.length > 0 && generationState.status !== 'generating' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    clearLogs();
                    toast.success('日志已清空');
                  }}
                >
                  清空日志
                </Button>
              )}
            </div>

            {/* Log panel */}
            <div className="rounded-lg bg-gray-950 p-4 max-h-80 overflow-y-auto font-mono text-xs">
              {execLogs.length === 0 ? (
                <p className="text-gray-500">等待执行...</p>
              ) : (
                execLogs.map((line, i) => (
                  <div key={i} className={`leading-relaxed ${line.includes('[ERR]') ? 'text-red-400' : line.includes('[OUT]') ? 'text-green-400' : line.includes('[判断]') ? 'text-yellow-400' : line.includes('[结果]') ? 'text-cyan-400' : 'text-gray-300'}`}>
                    {line}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            {/* 查看生成的文件 (on success) */}
            {generationState.status === 'success' && (() => {
              const report = lastReportRef.current;
              const filePaths = report?.filePaths || [];
              const reportId = lastReportIdRef.current;

              const handleDownload = async (fileIndex: number) => {
                if (!reportId) {
                  toast.error('报告ID为空');
                  return;
                }
                const url = getApiUrl(`/reports/${reportId}/download?fileIndex=${fileIndex}`);
                try {
                  const res = await fetchWithAuth(url);
                  if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    toast.error(errData.error || errData.message || `下载失败 (${res.status})`);
                    return;
                  }
                  const blob = await res.blob();
                  const objUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = objUrl;
                  const cd = res.headers.get('Content-Disposition');
                  const match = cd?.match(/filename="?([^"]+)"?/);
                  a.download = match ? decodeURIComponent(match[1]) : (filePaths[fileIndex]?.split(/[/\\]/).pop() || `report`);
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
                } catch (err: any) {
                  toast.error(`下载失败: ${err.message || '网络错误'}`);
                }
              };

              const handleDownloadAll = () => {
                for (let i = 0; i < filePaths.length; i++) {
                  // 逐个触发下载（浏览器会分别处理）
                  setTimeout(() => handleDownload(i), i * 300);
                }
              };

              const handleDownloadPackage = async () => {
                const currentReportId = reportId;
                if (!currentReportId) {
                  toast.error('报告ID为空，请重新生成报告');
                  return;
                }
                const url = getApiUrl(`/reports/${currentReportId}/download-all`);
                try {
                  const res = await fetchWithAuth(url);
                  if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    try { toast.error(errData.error || errData.message || `打包下载失败 (${res.status})`); } catch (e) { console.error('[打包下载] toast.error failed:', e); }
                    return;
                  }
                  const blob = await res.blob();
                  const objUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = objUrl;
                  const cd = res.headers.get('Content-Disposition');
                  const match = cd?.match(/filename="?([^"]+)"?/);
                  a.download = match ? decodeURIComponent(match[1]) : `${report?.name || '报告'}_全部文件.tar.gz`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  // 延迟释放 blob URL，给浏览器足够时间启动异步下载
                  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
                } catch (err: any) {
                  try { toast.error(`打包下载失败: ${err.message || '网络错误'}`); } catch (e) { console.error('[打包下载] toast.error failed:', e); }
                  console.error('[打包下载] 捕获异常:', err);
                }
              };

              return (
              <div className="space-y-3 pt-2">
                <div className="flex gap-2 justify-center flex-wrap">
                  <Button variant="outline" onClick={() => {
                    resetGenerationState();
                    clearLogs();
                    setCurrentSessionId('');
                    localStorage.removeItem('current_report_session');
                  }}>
                    生成新报告
                  </Button>
                  {filePaths.length > 1 && (
                    <>
                      <Button size="sm" onClick={handleDownloadAll}>
                        <Download className="mr-1 h-3 w-3" />一键下载全部 ({filePaths.length})
                      </Button>
                      <Button size="sm" variant="secondary" onClick={handleDownloadPackage}>
                        <Package className="mr-1 h-3 w-3" />打包下载 (.tar.gz)
                      </Button>
                    </>
                  )}
                </div>
                {filePaths.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">报告已生成，可在「报告管理」页面查看和下载</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center">
                      脚本生成了 {filePaths.length} 个报告文件：
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                      {filePaths.map((fp, idx) => {
                        const fileName = fp.split(/[/\\]/).pop() || `file_${idx + 1}`;
                        return (
                          <div key={idx} className="flex items-center justify-between rounded border p-2">
                            <span className="text-sm truncate mr-2 flex-1" title={fileName}>{fileName}</span>
                            <Button size="sm" variant="outline" onClick={() => handleDownload(idx)}>
                              <Download className="mr-1 h-3 w-3" />下载
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              );
            })()}

            {generationState.status === 'failed' && (
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" onClick={() => {
                  setGenerationState({ step: 5, status: 'idle' });
                  clearLogs();
                }}>
                  返回修改
                </Button>
                <Button onClick={() => {
                  handleGenerate();
                }}>
                  重新生成
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═════ 依赖未就绪警告弹窗 ═════ */}
      <Dialog open={showDepsWarning} onOpenChange={setShowDepsWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-yellow-600">
              <AlertCircle className="h-5 w-5" />依赖未就绪
            </DialogTitle>
            <DialogDescription>
              当前脚本「{selectedScript?.name}」的 Python 依赖尚未安装完成，直接生成报告可能会失败。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">以下依赖未就绪：</p>
            <div className="max-h-40 overflow-y-auto border rounded-lg p-3 bg-muted/30">
              {selectedScript && getUnreadyDeps(selectedScript).map((dep, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-1">
                  <XIcon className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  <span className="font-mono text-xs">{dep}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">建议先到「脚本及模板管理」页面安装依赖后再生成报告。</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDepsWarning(false)}>取消</Button>
            <Button variant="destructive" onClick={() => {
              setShowDepsWarning(false);
              // 继续下一步
              if (selectedScript?.templateIds?.length && !generationState.selectedTemplateId) {
                const validId = selectedScript.templateIds.find((tid) => docTemplates.some((t) => t.id === tid));
                if (validId) setGenerationState({ selectedTemplateId: validId, step: nextStep() });
                else setGenerationState({ step: nextStep() });
              } else {
                setGenerationState({ step: nextStep() });
              }
            }}>
              <AlertCircle className="h-4 w-4 mr-1" />我已了解，继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
