import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, FileText, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/utils/formatters';

interface FileUploaderProps {
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  onFilesSelected?: (files: File[]) => void;
  accept?: string;
  acceptedTypes?: string;
  multiple?: boolean;
  maxSize?: number;
  maxSizeMB?: number;
  /** 'immediate': fire onFilesSelected on every change (default). 'manual': only fire onFilesChange, caller decides when to submit. */
  triggerMode?: 'immediate' | 'manual';
  /** When true, preserve directory structure via webkitRelativePath (folder picker + directory drag) */
  preserveDir?: boolean;
}

/** Helper: get display path for a file — uses webkitRelativePath if available, else name */
export function getFilePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/** Recursively traverse a directory entry, collecting all files with their relative paths */
async function traverseFileTree(
  entry: FileSystemEntry,
  basePath: string,
  result: File[]
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve) => fileEntry.file(resolve));
    // Attach relative path by overriding the name-like approach — store via Object.defineProperty
    const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    Object.defineProperty(file, 'webkitRelativePath', { value: fullPath, writable: false });
    result.push(file);
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const reader = dirEntry.createReader();
    // readEntries may need multiple calls for large directories
    const readAll = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve) => {
        const all: FileSystemEntry[] = [];
        const readBatch = () => {
          reader.readEntries((entries) => {
            if (entries.length === 0) { resolve(all); return; }
            all.push(...entries);
            readBatch();
          });
        };
        readBatch();
      });
    const entries = await readAll();
    for (const child of entries) {
      await traverseFileTree(child, dirPath, result);
    }
  }
}

export function FileUploader({
  files,
  onFilesChange,
  onFilesSelected,
  accept = '.log,.txt,.csv',
  acceptedTypes,
  multiple = true,
  maxSize = 10 * 1024 * 1024,
  maxSizeMB,
  triggerMode = 'immediate',
  preserveDir = false,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localFiles, setLocalFiles] = useState<File[]>(files || []);

  const effectiveAccept = acceptedTypes || accept;
  // When preserveDir, allow zip and python files too
  const acceptAttr = preserveDir && !acceptedTypes ? '.log,.txt,.csv,.py,.json,.xml,.yaml,.yml,.md,.cfg,.conf,.ini' : effectiveAccept;
  const effectiveMaxSize = maxSizeMB ? maxSizeMB * 1024 * 1024 : maxSize;

  // Use refs for callbacks to avoid useEffect re-triggering on every render
  const onFilesChangeRef = useRef(onFilesChange);
  const onFilesSelectedRef = useRef(onFilesSelected);
  onFilesChangeRef.current = onFilesChange;
  onFilesSelectedRef.current = onFilesSelected;

  // Sync local files when external files prop resets
  useEffect(() => {
    if (files !== undefined && files.length === 0) {
      setLocalFiles([]);
    }
  }, [files]);

  // 标记是否首次挂载，避免初始空数组触发 onFilesChange 导致父组件立即卸载
  const isInitialMount = useRef(true);

  // Sync local files to parent
  useEffect(() => {
    // 首次挂载时不触发 onFilesChange，避免 triggerMode="manual" 时因空数组导致父组件卸载
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    onFilesChangeRef.current?.(localFiles);
    if (triggerMode === 'immediate') {
      onFilesSelectedRef.current?.(localFiles);
    }
  }, [localFiles, triggerMode]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (preserveDir && e.dataTransfer.items) {
        // Directory-aware drop — traverse entries recursively
        const droppedFiles: File[] = [];
        const items = Array.from(e.dataTransfer.items);
        for (const item of items) {
          const entry = item.webkitGetAsEntry?.();
          if (entry) {
            await traverseFileTree(entry, '', droppedFiles);
          }
        }
        const validFiles = droppedFiles.filter((f) => f.size <= effectiveMaxSize);
        const updated = multiple ? [...localFiles, ...validFiles] : validFiles.slice(0, 1);
        setLocalFiles(updated);
      } else {
        const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => f.size <= effectiveMaxSize);
        const updated = multiple ? [...localFiles, ...droppedFiles] : droppedFiles.slice(0, 1);
        setLocalFiles(updated);
      }
    },
    [localFiles, multiple, effectiveMaxSize, preserveDir]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []).filter((f) => f.size <= effectiveMaxSize);
      // webkitRelativePath is already set on files from webkitdirectory input
      const updated = multiple ? [...localFiles, ...selectedFiles] : selectedFiles.slice(0, 1);
      setLocalFiles(updated);
    },
    [localFiles, multiple, effectiveMaxSize]
  );

  const removeFile = useCallback(
    (index: number) => {
      setLocalFiles((prev) => prev.filter((_, i) => i !== index));
    },
    []
  );

  const displayFiles = files || localFiles;

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        )}
      >
        <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer text-primary hover:underline text-sm">
              <input
                type="file"
                className="hidden"
                accept={acceptAttr}
                multiple={multiple}
                onChange={handleInputChange}
              />
              点击上传文件
            </label>
            {preserveDir && (
              <>
                <span className="text-muted-foreground text-sm">|</span>
                <label className="cursor-pointer text-primary hover:underline text-sm flex items-center gap-1">
                  <FolderOpen className="h-3.5 w-3.5" />
                  <input
                    type="file"
                    className="hidden"
                    /* @ts-expect-error webkitdirectory is non-standard but widely supported */
                    webkitdirectory=""
                    multiple
                    onChange={handleInputChange}
                  />
                  选择文件夹
                </label>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            支持拖拽上传，单个文件不超过 {formatFileSize(effectiveMaxSize)}
          </p>
        </div>
      </div>

      {displayFiles.length > 0 && (
        <div className="space-y-2">
          {displayFiles.map((file, index) => {
            const filePath = getFilePath(file);
            return (
              <div
                key={`${filePath}-${index}`}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm truncate">{filePath}</span>
                  <span className="text-xs text-muted-foreground shrink-0">({formatFileSize(file.size)})</span>
                </div>
                <button onClick={() => removeFile(index)} className="rounded-md p-1 hover:bg-accent shrink-0">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
