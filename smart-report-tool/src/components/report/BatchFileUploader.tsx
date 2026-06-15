import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, X, FileText, Archive, Eye, FolderTree, ChevronDown, ChevronUp, Package, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/formatters';
import { InputFileEntry } from '@/types';
import { detectArchiveType, extractArchive, ArchiveEntry } from '@/utils/archive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface BatchFileUploaderProps {
  files: InputFileEntry[];
  onFilesChange: (files: InputFileEntry[]) => void;
  acceptedTypes?: string;
  maxSizeMB?: number;
}

const DEFAULT_ACCEPT = '.log,.txt,.csv,.json,.xlsx,.html,.md,.xml,.cfg,.conf,.ini,.yaml,.yml,.zip,.gz,.tar,.tgz';

function generateId() {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateGroupId() {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function BatchFileUploader({
  files,
  onFilesChange,
  acceptedTypes = DEFAULT_ACCEPT,
  maxSizeMB = 50,
}: BatchFileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<{ entry: ArchiveEntry; parentName: string } | null>(null);
  const [expandedArchives, setExpandedArchives] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Use local state as the single source of truth to avoid stale closure issues
  const [localFiles, setLocalFiles] = useState<InputFileEntry[]>(files);

  // Sync from parent when parent clears files (reset)
  const prevFilesLenRef = useRef(files.length);
  useEffect(() => {
    if (files.length === 0 && prevFilesLenRef.current > 0) {
      setLocalFiles([]);
    }
    prevFilesLenRef.current = files.length;
  }, [files.length]);

  const maxSize = maxSizeMB * 1024 * 1024;

  // Helper: update local state and sync to parent in one go
  const updateFiles = useCallback((updater: (prev: InputFileEntry[]) => InputFileEntry[]) => {
    setLocalFiles((prev) => {
      const next = updater(prev);
      // Sync to parent on next tick to avoid render-phase side effects
      requestAnimationFrame(() => {
        onFilesChange(next);
      });
      return next;
    });
  }, [onFilesChange]);

  const processFile = useCallback(async (file: File) => {
    const id = generateId();
    const isArchive = !!detectArchiveType(file.name);

    // Step 1: Add entry with 'uploading' status
    updateFiles((prev) => [
      ...prev,
      {
        id,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        file,
        isArchive,
        groupId: generateGroupId(),
        progress: 0,
        status: 'uploading',
      },
    ]);

    // Step 2: Simulate upload progress
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 20 + 8;
      if (progress >= 100) {
        progress = 100;
        clearInterval(progressInterval);
      }
      updateFiles((prev) =>
        prev.map((f) =>
          f.id === id && f.status === 'uploading'
            ? { ...f, progress: Math.min(100, Math.round(progress)) }
            : f
        )
      );
    }, 120);

    // Wait for simulated upload
    await new Promise((r) => setTimeout(r, 700));
    clearInterval(progressInterval);

    if (isArchive) {
      // Step 3a: Update to extracting
      updateFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'extracting' as const, progress: 100 } : f
        )
      );

      try {
        const result = await extractArchive(file);
        updateFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  status: 'done' as const,
                  extractedFiles: result.entries.map((e) => ({
                    name: e.name,
                    size: e.size,
                    content: e.content,
                  })),
                  error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
                }
              : f
          )
        );
        if (result.entries.length > 0) {
          toast.success(`「${file.name}」解压完成，包含 ${result.entries.length} 个文件`);
        }
        if (result.errors.length > 0) {
          toast.warning(`「${file.name}」解压出现问题: ${result.errors.join('; ')}`);
        }
      } catch (e) {
        updateFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? { ...f, status: 'error' as const, error: e instanceof Error ? e.message : '解压失败' }
              : f
          )
        );
        toast.error(`「${file.name}」解压失败`);
      }
    } else {
      // Step 3b: Regular file - mark done
      updateFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'done' as const, progress: 100 } : f
        )
      );
    }
  }, [updateFiles]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const selected = Array.from(fileList);
    const valid = selected.filter((f) => {
      if (f.size > maxSize) {
        toast.error(`「${f.name}」超过大小限制 (${formatFileSize(maxSize)})`);
        return false;
      }
      return true;
    });

    for (const file of valid) {
      await processFile(file);
    }
  }, [maxSize, processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  }, [handleFiles]);

  const removeFile = useCallback((id: string) => {
    updateFiles((prev) => prev.filter((f) => f.id !== id));
  }, [updateFiles]);

  const updateGroupId = useCallback((id: string, groupId: string) => {
    updateFiles((prev) => prev.map((f) => (f.id === id ? { ...f, groupId } : f)));
  }, [updateFiles]);

  const toggleArchiveExpand = useCallback((id: string) => {
    setExpandedArchives((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const doneFiles = localFiles.filter((f) => f.status === 'done');
  const hasErrors = localFiles.some((f) => f.status === 'error');

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        )}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          拖拽文件到此处，或 <span className="text-primary hover:underline">点击上传</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          支持批量上传，支持 ZIP / GZ / TAR 压缩包自动解压
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          单个文件不超过 {formatFileSize(maxSize)}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={acceptedTypes}
          multiple
          onChange={handleInputChange}
        />
      </div>

      {/* Stats */}
      {localFiles.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="secondary">共 {localFiles.length} 个文件</Badge>
          <Badge variant="outline">已完成 {doneFiles.length} 个</Badge>
          {hasErrors && <Badge variant="destructive">有错误</Badge>}
        </div>
      )}

      {/* File List */}
      {localFiles.length > 0 && (
        <div className="space-y-3">
          {localFiles.map((file) => (
            <div
              key={file.id}
              className={cn(
                'rounded-lg border bg-card overflow-hidden',
                file.status === 'error' && 'border-destructive/50',
                file.status === 'done' && 'border-green-200'
              )}
            >
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {file.isArchive ? (
                      <Package className="h-5 w-5 text-amber-500 shrink-0" />
                    ) : (
                      <FileText className="h-5 w-5 text-primary shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                        {file.isArchive && file.extractedFiles && (
                          <span className="ml-2 text-amber-600">
                            含 {file.extractedFiles.length} 个文件
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {file.status === 'done' && (
                      <Badge variant="outline" className="text-green-600 border-green-200">
                        完成
                      </Badge>
                    )}
                    {file.status === 'error' && (
                      <Badge variant="destructive">错误</Badge>
                    )}
                    {file.status === 'extracting' && (
                      <Badge variant="secondary">解压中...</Badge>
                    )}
                    {file.status === 'uploading' && (
                      <Badge variant="secondary">上传中...</Badge>
                    )}
                    <button
                      onClick={() => removeFile(file.id)}
                      className="rounded-md p-1 hover:bg-accent"
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                {(file.status === 'uploading' || file.status === 'extracting') && (
                  <div className="mt-2">
                    <Progress value={file.progress} className="h-1.5" />
                  </div>
                )}

                {/* Error message */}
                {file.error && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {file.error}
                  </div>
                )}

                {/* Group assignment + actions */}
                {file.status === 'done' && (
                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
                      <Label className="text-xs text-muted-foreground">关联组:</Label>
                      <Input
                        value={file.groupId}
                        onChange={(e) => updateGroupId(file.id, e.target.value)}
                        className="h-7 w-32 text-xs"
                        placeholder="组ID"
                      />
                    </div>
                    {file.isArchive && file.extractedFiles && file.extractedFiles.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => toggleArchiveExpand(file.id)}
                      >
                        {expandedArchives.has(file.id) ? (
                          <><ChevronUp className="mr-1 h-3 w-3" />收起</>
                        ) : (
                          <><ChevronDown className="mr-1 h-3 w-3" />查看内部文件</>
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Expanded archive contents */}
              {expandedArchives.has(file.id) && file.extractedFiles && (
                <div className="border-t bg-muted/30 px-4 py-2">
                  <p className="text-xs text-muted-foreground mb-2">压缩包内文件列表:</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {file.extractedFiles.map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate text-xs">{entry.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatFileSize(entry.size)}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() =>
                            setPreviewEntry({
                              entry: { name: entry.name, size: entry.size, content: entry.content, isText: true },
                              parentName: file.name,
                            })
                          }
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Group summary */}
      {doneFiles.length > 1 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">文件关联分组概览</p>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(doneFiles.map((f) => f.groupId))).map((groupId) => {
              const groupFiles = doneFiles.filter((f) => f.groupId === groupId);
              return (
                <Badge key={groupId} variant="secondary" className="text-xs">
                  {groupId}: {groupFiles.length} 个文件
                </Badge>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            相同关联组的文件会被视为同一批次，由脚本按关联关系解析。
          </p>
        </div>
      )}

      {/* Preview Dialog */}
      {previewEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewEntry(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] rounded-lg bg-card border shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <p className="text-sm font-medium">{previewEntry.entry.name}</p>
                <p className="text-xs text-muted-foreground">
                  来自: {previewEntry.parentName} · {formatFileSize(previewEntry.entry.size)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreviewEntry(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 overflow-auto max-h-[60vh]">
              <pre className="text-xs bg-muted p-3 rounded-md whitespace-pre-wrap break-all">
                {typeof previewEntry.entry.content === 'string'
                  ? previewEntry.entry.content.slice(0, 5000)
                  : '[二进制文件]'}
                {typeof previewEntry.entry.content === 'string' && previewEntry.entry.content.length > 5000
                  ? '\n\n... (内容已截断，共 ' + previewEntry.entry.content.length + ' 字符)'
                  : ''}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
