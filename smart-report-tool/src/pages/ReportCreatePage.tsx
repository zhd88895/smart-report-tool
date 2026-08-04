import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { useReportStore } from '@/stores/reportStore';
import { useAuthStore } from '@/stores/authStore';
import { useLogPersistence } from '@/hooks/useLogPersistence';
import { Script, LogCategory, Report } from '@/types';
import { AIAnalysisPanel } from '@/components/report/AIAnalysisPanel';
import { StepScript } from '@/components/report/create/StepScript';
import { StepTemplate } from '@/components/report/create/StepTemplate';
import { StepUpload } from '@/components/report/create/StepUpload';
import { StepInfo } from '@/components/report/create/StepInfo';
import { StepConfirm } from '@/components/report/create/StepConfirm';
import { GeneratingResultCard } from '@/components/report/create/GeneratingResultCard';
import { OUTPUT_FORMAT_LABELS, LAST_NAME_KEY } from '@/components/report/create/constants';
import { isDepsReady, getUnreadyDeps } from '@/components/report/create/scriptDeps';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ChevronRight, CheckCircle, AlertCircle, X as XIcon, Sparkles } from 'lucide-react';
import { getRunningReportId, clearRunningReportId, pollReportLogs, pollReportStatus, apiExtractArchive } from '@/services/api';

export default function ReportCreatePage() {
  const { scripts, fetchScripts } = useScriptStore();
  const { docTemplates, fetchDocTemplates } = useDocTemplateStore();
  const { generationState, setGenerationState, resetGenerationState, generateReport } = useReportStore();
  const { user } = useAuthStore();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  // 使用日志持久化 hook
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    // 从 URL 或 localStorage 恢复会话ID（仅挂载时读取一次）
    return searchParams.get('sessionId') || localStorage.getItem('current_report_session') || '';
  });

  const {
    logs: execLogs,
    isRestored,
    addLog,
    addLogRef,
    clearLogs,
    updateStatus,
    setSessionId,
    setLogLines,
  } = useLogPersistence(currentSessionId);

  const lastReportIdRef = useRef<string>('');
  const lastReportRef = useRef<Report | null>(null);
  const execLogsRef = useRef<string[]>([]); // 保持最新日志引用，避免闭包过时
  const [manualTemplate, setManualTemplate] = useState(false);
  // AI 智能分析为默认模式；仅 ?mode=script 显式回退到脚本模式（仅挂载时读取一次）
  const [useAI, setUseAI] = useState(() => searchParams.get('mode') !== 'script');

  // 侧边栏「AI智能分析」与「脚本生成报告」共用本页面：
  // 页面不卸载时（同路由切换）也要响应 URL 的 mode 参数变化
  useEffect(() => {
    setUseAI(searchParams.get('mode') !== 'script');
  }, [searchParams]);

  // 压缩包解压状态
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordTargetFile, setPasswordTargetFile] = useState<{ name: string; file: File } | null>(null);
  const [passwordError, setPasswordError] = useState('');

  // 依赖未就绪警告弹窗
  const [showDepsWarning, setShowDepsWarning] = useState(false);

  // 保存当前会话ID到 localStorage
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('current_report_session', currentSessionId);
    }
  }, [currentSessionId]);

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

  // Auto-scroll logs + 同步 ref
  useEffect(() => {
    execLogsRef.current = execLogs;
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

          // 获取最新日志（只在首次恢复时替换，后续追加新日志避免覆盖实时推送）
          const freshLogs = await pollReportLogs(reportId);
          if (freshLogs.length > 0) {
            if (firstFetch) {
              setLogLines(freshLogs);
            } else {
              // 后续轮询：只追加服务端比本地多的新日志
              const localCount = execLogsRef.current.length;
              if (freshLogs.length > localCount) {
                const newOnes = freshLogs.slice(localCount);
                for (const msg of newOnes) {
                  addLogRef.current(msg);
                }
              }
            }
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

  /** 步骤1 → 下一步：脚本关联了模板但未手动选择时，自动选第一个可用的关联模板 */
  const goNextFromStep1 = () => {
    if (selectedScript?.templateIds?.length && !generationState.selectedTemplateId) {
      const validId = selectedScript.templateIds.find((tid) => docTemplates.some((t) => t.id === tid));
      if (validId) setGenerationState({ selectedTemplateId: validId, step: nextStep() });
      else setGenerationState({ step: nextStep() });
    } else {
      setGenerationState({ step: nextStep() });
    }
  };

  /** 步骤1 下一步入口：先检查脚本依赖是否就绪 */
  const handleStep1Next = () => {
    if (selectedScript && !isDepsReady(selectedScript)) {
      setShowDepsWarning(true);
      return;
    }
    goNextFromStep1();
  };

  /** 步骤2 下一步：未选模板但脚本有关联模板时，自动选第一个可用的关联模板 */
  const handleStep2Next = () => {
    if (!generationState.selectedTemplateId && selectedScript?.templateIds.length) {
      const validId = selectedScript.templateIds.find((tid) => docTemplates.some((t) => t.id === tid));
      if (validId) setGenerationState({ selectedTemplateId: validId });
    }
    setGenerationState({ step: nextStep() });
  };

  /** 步骤3 下一步：有压缩包时先逐个上传解压，全部成功后进入下一步 */
  const handleStep3Next = async () => {
    // 检查是否有压缩包需要解压
    const archives = generationState.inputFiles.filter(
      (f) => f.isArchive && /\.(zip|tar|tar\.gz|tgz)$/i.test(f.name)
    );
    if (archives.length === 0) {
      // 没有压缩包，直接下一步
      fillStep4Defaults();
      setGenerationState({ step: nextStep() });
      return;
    }

    // 有压缩包，逐个上传解压
    setExtracting(true);
    setExtractProgress(`正在处理第 1/${archives.length} 个压缩包...`);
    let allOk = true;

    for (let i = 0; i < archives.length; i++) {
      const arch = archives[i];
      setExtractProgress(`正在处理第 ${i + 1}/${archives.length} 个压缩包: ${arch.name}...`);

      try {
        const result = await apiExtractArchive(arch.file);

        if (result.needPassword) {
          // 需要密码，打开密码对话框
          setPasswordTargetFile({ name: arch.name, file: arch.file });
          setPasswordError('');
          setPasswordDialogOpen(true);
          // 等待密码输入（会被 async handler 继续）
          allOk = false;
          break;
        }

        if (!result.success) {
          toast.error(`${arch.name} 解压失败: ${result.error || '未知错误'}`);
          allOk = false;
          break;
        }

        // 解压成功
        const fileCount = result.files?.length || 0;
        toast.success(`${arch.name} 解压完成，共 ${fileCount} 个文件`);
      } catch (err: any) {
        toast.error(`${arch.name} 处理失败: ${err.message}`);
        allOk = false;
        break;
      }
    }

    setExtracting(false);
    if (allOk) {
      fillStep4Defaults();
      setGenerationState({ step: nextStep() });
    }
  };

  const handlePasswordConfirm = async (password: string) => {
    if (!passwordTargetFile) return;
    setExtracting(true);
    setPasswordError('');
    try {
      const result = await apiExtractArchive(passwordTargetFile.file, password);
      if (!result.success) {
        if (result.errorCode === 'WRONG_PASSWORD') {
          setPasswordError('密码错误，请重试');
          setExtracting(false);
          return; // 保持对话框打开
        }
        toast.error(`解压失败: ${result.error || '未知错误'}`);
        setPasswordDialogOpen(false);
      } else {
        const fileCount = result.files?.length || 0;
        toast.success(`解压完成，共 ${fileCount} 个文件`);
        setPasswordDialogOpen(false);
        setExtracting(false);
        fillStep4Defaults();
        setGenerationState({ step: nextStep() });
      }
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handlePasswordCancel = () => {
    setPasswordDialogOpen(false);
    setPasswordTargetFile(null);
    setExtracting(false);
    // 用户取消密码，直接继续（跳过压缩包解压）
    fillStep4Defaults();
    setGenerationState({ step: nextStep() });
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
        dedupIndices: doneInputFiles.map((f, i) => (f.dedup ? i : -1)).filter((i) => i >= 0),
        outputFormat: format,
        requirements: script?.requirements || [],
        reportInfo: {
          name: info.name,
          date: info.date,
          author: info.author,
          category: generationState.logCategory,
        },
      }, (msg) => {
        addLogRef.current(msg);
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

  /** 页面标题映射表：AI 模式固定标题；脚本模式按步骤映射，未覆盖步骤回退到脚本名 */
  const PAGE_TITLE_MAP = {
    ai: 'AI 智能分析',
    scriptDefault: '生成报告',
  } as const;
  const SCRIPT_STEP_TITLE_MAP: Partial<Record<1 | 2 | 3 | 4 | 5, string>> = {
    1: '选择脚本生成报告文件',
  };
  const pageTitle = useAI
    ? PAGE_TITLE_MAP.ai
    : SCRIPT_STEP_TITLE_MAP[generationState.step] ?? selectedScript?.name ?? PAGE_TITLE_MAP.scriptDefault;

  /** 步骤5展示用的模板名（手动所选，或脚本自动关联的第一个可用模板） */
  const resolvedTemplateName = selectedDocTemplate?.name ||
    (selectedScript?.templateIds?.length ? docTemplates.find(t => selectedScript.templateIds.includes(t.id))?.name : undefined);

  // ── Step 1–5 UI ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold tracking-tight">{pageTitle}</h2>
        {/* AI 模式切换 - 突出显示为主要功能 */}
        {useAI || generationState.step <= 1 ? (
          <button
            type="button"
            onClick={() => { setUseAI(!useAI); if (!useAI) resetGenerationState(); }}
            className={`flex items-center gap-3 rounded-lg border-2 px-4 py-2 transition-all ${
              useAI
                ? 'border-primary bg-primary/10 shadow-sm'
                : 'border-dashed border-primary/40 hover:border-primary hover:bg-primary/5'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-md ${useAI ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="text-left">
              <div className={`text-sm font-semibold ${useAI ? 'text-primary' : 'text-foreground'}`}>
                {useAI ? 'AI 智能分析模式' : '使用 AI 生成'}
              </div>
              <div className="text-xs text-muted-foreground">
                {useAI ? '点击切换回脚本模式' : 'AI 自动分析巡检日志'}
              </div>
            </div>
            <Switch checked={useAI} onCheckedChange={(v) => { setUseAI(v); if (v) resetGenerationState(); }} />
          </button>
        ) : null}
      </div>

      {useAI ? (
        // AI 分析模式
        <AIAnalysisPanel />
      ) : (
        <>
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
            <StepScript
              scripts={filteredScripts}
              selectedScriptId={generationState.selectedScriptId}
              manualTemplate={manualTemplate}
              onManualTemplateChange={setManualTemplate}
              onSelectScript={(id) => setGenerationState({ selectedScriptId: id })}
              canGoNext={canGoNext()}
              onNext={handleStep1Next}
            />
          )}

          {/* Step 2: Select template (conditional) */}
          {generationState.step === 2 && (
            <StepTemplate
              selectedScript={selectedScript}
              selectedTemplateId={generationState.selectedTemplateId}
              selectedDocTemplate={selectedDocTemplate}
              docTemplates={docTemplates}
              onSelectTemplate={(id) => setGenerationState({ selectedTemplateId: id })}
              onPrev={() => setGenerationState({ step: prevStep() })}
              onNext={handleStep2Next}
            />
          )}

          {/* Step 3: Upload data */}
          {generationState.step === 3 && (
            <StepUpload
              stepNumber={manualTemplate ? '3' : '2'}
              files={generationState.inputFiles}
              onFilesChange={(files) => setGenerationState({ inputFiles: files })}
              inputFormats={selectedScript?.inputFormats}
              extracting={extracting}
              extractProgress={extractProgress}
              canGoNext={canGoNext()}
              onPrev={() => setGenerationState({ step: prevStep() })}
              onNext={handleStep3Next}
              passwordDialogOpen={passwordDialogOpen}
              passwordFileName={passwordTargetFile?.name || ''}
              passwordError={passwordError}
              onPasswordConfirm={handlePasswordConfirm}
              onPasswordCancel={handlePasswordCancel}
            />
          )}

          {/* Step 4: Report info */}
          {generationState.step === 4 && (
            <StepInfo
              reportInfo={generationState.reportInfo}
              outputFormat={generationState.outputFormat}
              logCategory={generationState.logCategory}
              onUpdate={setGenerationState}
              canGoNext={canGoNext()}
              onPrev={() => setGenerationState({ step: prevStep() })}
              onNext={() => setGenerationState({ step: nextStep() })}
            />
          )}

          {/* Step 5: Confirm & generate */}
          {generationState.step === 5 && generationState.status !== 'generating' && generationState.status !== 'success' && generationState.status !== 'failed' && (
            <StepConfirm
              reportInfo={generationState.reportInfo}
              logCategory={generationState.logCategory}
              doneFilesCount={doneInputFiles.length}
              scriptName={selectedScript?.name}
              templateName={resolvedTemplateName}
              outputFormat={generationState.outputFormat}
              onPrev={() => setGenerationState({ step: prevStep() })}
              onGenerate={handleGenerate}
            />
          )}

          {/* Generating / Result */}
          {(generationState.status === 'generating' || generationState.status === 'success' || generationState.status === 'failed') && (
            <GeneratingResultCard
              status={generationState.status}
              logs={execLogs}
              isRestored={isRestored}
              logsEndRef={logsEndRef}
              onClearLogs={clearLogs}
              report={lastReportRef.current}
              reportId={lastReportIdRef.current}
              onReset={() => {
                resetGenerationState();
                clearLogs();
                setCurrentSessionId('');
                localStorage.removeItem('current_report_session');
              }}
              onBackToEdit={() => {
                setGenerationState({ step: 5, status: 'idle' });
                clearLogs();
              }}
              onRetry={handleGenerate}
            />
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
                  goNextFromStep1();
                }}>
                  <AlertCircle className="h-4 w-4 mr-1" />我已了解，继续
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
        )}
    </div>
  );
}
