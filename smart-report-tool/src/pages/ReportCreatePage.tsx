import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { useReportStore } from '@/stores/reportStore';
import { canAccess } from '@/utils/permissions';
import { Script, DocTemplate, InputFileEntry, OutputFormat, LogCategory, ScriptType } from '@/types';
import { formatFileSize } from '@/utils/formatters';
import { BatchFileUploader } from '@/components/report/BatchFileUploader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ChevronRight, CheckCircle, Download, ArrowLeft, Terminal } from 'lucide-react';

type CATEGORY_LABELS = Record<LogCategory, string>;
const CATEGORY_LABELS: CATEGORY_LABELS = { host: '主机', storage: '存储', database: '数据库', virtualization: '虚拟化', network: '网络' };
const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = { html: 'HTML', md: 'Markdown', docx: 'Word (DOCX)', xlsx: 'Excel', pdf: 'PDF' };

export default function ReportCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { scripts, fetchScripts } = useScriptStore();
  const { docTemplates, fetchDocTemplates } = useDocTemplateStore();
  const { generationState, setGenerationState, resetGenerationState, generateReport } = useReportStore();
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [execLogs, setExecLogs] = useState<string[]>([]);
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const lastReportIdRef = useRef<string>('');

  // Download helpers
  const triggerDownload = useCallback((content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => { fetchScripts(); fetchDocTemplates(); }, [fetchScripts, fetchDocTemplates]);

  // Deduplicate scripts by ID, then by fileName within filtered list
  const allScripts = useMemo(() => {
    const seen = new Map<string, Script>();
    for (const s of scripts) seen.set(s.id, s);
    return Array.from(seen.values());
  }, [scripts]);

  const filteredScripts = useMemo(() => {
    const matching = allScripts.filter((s) =>
      s.category === generationState.logCategory && s.templateRequired
    );
    // Further deduplicate by fileName (same file may have different IDs if uploaded twice)
    const seen = new Map<string, Script>();
    for (const s of matching) {
      const key = s.fileName + '_' + s.name;
      if (!seen.has(key)) seen.set(key, s);
    }
    return Array.from(seen.values());
  }, [allScripts, generationState.logCategory]);

  const selectedScript = allScripts.find((s) => s.id === generationState.selectedScriptId);
  const selectedDocTemplate = docTemplates.find((t) => t.id === generationState.selectedTemplateId);

  const doneInputFiles = generationState.inputFiles.filter((f) => f.status === 'done');

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [execLogs]);

  const canGoNext = (): boolean => {
    switch (generationState.step) {
      case 1: return doneInputFiles.length > 0;
      case 2: return !!generationState.selectedScriptId;
      case 3: return (!!generationState.selectedTemplateId
        && docTemplates.some((t) => t.id === generationState.selectedTemplateId))
        || (!!selectedScript && selectedScript.templateIds.length > 0
        && selectedScript.templateIds.some((tid) => docTemplates.some((t) => t.id === tid)));
      case 4: return !!generationState.reportInfo.name.trim();
      default: return true;
    }
  };

  const addLog = useCallback((msg: string) => {
    setExecLogs((prev) => [...prev, `[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`]);
  }, []);

  const handleGenerate = async () => {
    setExecLogs([]);
    setGeneratedContent('');
    setGenerationState({ status: 'generating', progress: 0 });

    const info = generationState.reportInfo;
    const script = selectedScript;
    const template = selectedDocTemplate;
    const format = generationState.outputFormat;

    if (!script) {
      toast.error('未选择脚本');
      setGenerationState({ status: 'idle' });
      return;
    }

    addLog('========================================');
    addLog('开始生成报告...');
    addLog(`报告名称: ${info.name}`);
    addLog(`处理脚本: ${script.name}`);
    addLog(`输出格式: ${OUTPUT_FORMAT_LABELS[format]}`);
    addLog('========================================');

    try {
      const backendReport = await generateReport({
        scriptId: script.id,
        templateId: template?.id || '',
        inputFiles: doneInputFiles.map((f) => f.file),
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
      if (backendReport && backendReport.status === 'error') {
        setGenerationState({ progress: 100, status: 'failed' });
        addLog('');
        addLog('========================================');
        addLog('报告生成失败，请查看上方日志排查原因');
        addLog('========================================');
        toast.error('报告生成失败，请查看执行日志');
      } else {
        setGenerationState({ progress: 100, status: 'success' });
        addLog('');
        addLog('========================================');
        addLog('报告生成完成！');
        addLog('========================================');
        toast.success('报告生成成功！');
      }
    } catch (err: any) {
      addLog('');
      addLog(`生成失败: ${err.message || String(err)}`);
      addLog('请确认后端服务是否正常运行，然后重试');
      setGenerationState({ progress: 0, status: 'failed' });
      toast.error(`生成失败: ${err.message || '后端服务不可用'}`);
    }
  };

  // ── Step 1–5 UI (kept for brevity, only cleanup below) ──
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} title="返回"><ArrowLeft className="h-4 w-4" /></Button>
        <h2 className="text-2xl font-bold tracking-tight">创建巡检报告</h2>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[1, 2, 3, 4, 5].map((step) => (
          <div key={step} className="flex items-center gap-1">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
              generationState.step === step ? 'bg-primary text-primary-foreground'
              : generationState.step > step ? 'bg-primary/20 text-primary'
              : 'bg-muted text-muted-foreground'
            }`}>
              {generationState.step > step ? <CheckCircle className="h-4 w-4" /> : step}
            </div>
            <span className={`text-xs ${generationState.step >= step ? 'text-foreground' : 'text-muted-foreground'}`}>
              {step === 1 ? '巡检数据' : step === 2 ? '选择脚本' : step === 3 ? '选择模板' : step === 4 ? '报告信息' : '确认生成'}
            </span>
            {step < 5 && <ChevronRight className="h-3 w-3 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload files */}
      {generationState.step === 1 && (
        <Card>
          <CardHeader><CardTitle>步骤1：上传巡检数据文件</CardTitle></CardHeader>
          <CardContent>
            <BatchFileUploader
              files={generationState.inputFiles}
              onFilesChange={(files) => setGenerationState({ inputFiles: files })}
            />
            <div className="mt-4 flex justify-end">
              <Button disabled={!canGoNext()} onClick={() => setGenerationState({ step: 2 })}>
                下一步 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select script */}
      {generationState.step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>步骤2：选择处理脚本</CardTitle>
            <p className="text-sm text-muted-foreground">仅显示需要关联模板的脚本</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              {filteredScripts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">暂无符合条件的脚本，请先上传需要关联模板的脚本</p>
              )}
              {filteredScripts.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setGenerationState({ selectedScriptId: s.id })}
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${generationState.selectedScriptId === s.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{s.name}</p>
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
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGenerationState({ step: 1 })}>上一步</Button>
              <Button disabled={!canGoNext()} onClick={() => {
                // 进入步骤3：验证关联模板是否还存在
                const validIds = (selectedScript?.templateIds || []).filter((tid) =>
                  docTemplates.some((t) => t.id === tid)
                );
                if (validIds.length > 0) {
                  setGenerationState({ step: 3, selectedTemplateId: validIds[0] });
                } else {
                  setGenerationState({ step: 3, selectedTemplateId: '' });
                }
              }}>
                下一步 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Select template */}
      {generationState.step === 3 && (
        <Card>
          <CardHeader><CardTitle>步骤3：选择报告模板</CardTitle></CardHeader>
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
              {/* 去重：已关联的模板不重复显示 */}
              {(() => {
                const available = selectedScript?.templateIds?.length > 0
                  ? docTemplates.filter((t) => !selectedScript.templateIds.includes(t.id))
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
                      <p className="text-xs text-muted-foreground">{t.description || t.fileName} · {formatFileSize(t.fileSize)}</p>
                    </div>
                    <Badge variant="outline">{t.fileType.toUpperCase()}</Badge>
                  </div>
                </div>
              ));
              })()}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGenerationState({ step: 2 })}>上一步</Button>
              <Button disabled={!canGoNext()} onClick={() => setGenerationState({ step: 4 })}>
                下一步 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
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
                <Label>报告名称</Label>
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
              <Button variant="outline" onClick={() => setGenerationState({ step: 3 })}>上一步</Button>
              <Button disabled={!canGoNext()} onClick={() => setGenerationState({ step: 5 })}>
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
              <div className="flex justify-between"><span className="text-muted-foreground">报告模板：</span><span>{selectedDocTemplate?.name || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">输出格式：</span><span>{OUTPUT_FORMAT_LABELS[generationState.outputFormat]}</span></div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGenerationState({ step: 4 })}>上一步</Button>
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
            {/* Log panel */}
            <div className="rounded-lg bg-gray-950 p-4 max-h-80 overflow-y-auto font-mono text-xs">
              {execLogs.length === 0 ? (
                <p className="text-gray-500">等待执行...</p>
              ) : (
                execLogs.map((line, i) => (
                  <div key={i} className={`leading-relaxed ${line.includes('[ERR]') ? 'text-red-400' : line.includes('[OUT]') ? 'text-green-400' : 'text-gray-300'}`}>
                    {line}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Download button (on success) */}
            {generationState.status === 'success' && (
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" onClick={() => {
                  resetGenerationState();
                  setExecLogs([]);
                  setGeneratedContent('');
                }}>
                  生成新报告
                </Button>
                <Button onClick={() => {
                  const name = generationState.reportInfo.name;
                  const ext = generationState.outputFormat;
                  const reportId = lastReportIdRef.current;
                  if (reportId) {
                    fetch(`http://localhost:3001/api/reports/${reportId}/download`)
                      .then(async (res) => {
                        if (res.ok) {
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${name}.${ext}`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }
                      }).catch(() => {});
                  }
                }}>
                  <Download className="mr-2 h-4 w-4" />下载报告
                </Button>
              </div>
            )}

            {generationState.status === 'failed' && (
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" onClick={() => {
                  setGenerationState({ step: 5, status: 'idle' });
                  setExecLogs([]);
                }}>
                  返回修改
                </Button>
                <Button onClick={() => {
                  setGenerationState({ status: 'generating', progress: 0 });
                  setExecLogs([]);
                  handleGenerate();
                }}>
                  重新生成
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
