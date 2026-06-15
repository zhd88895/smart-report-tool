import { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, X, FileText } from 'lucide-react';
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
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localFiles, setLocalFiles] = useState<File[]>(files || []);

  const effectiveAccept = acceptedTypes || accept;
  const effectiveMaxSize = maxSizeMB ? maxSizeMB * 1024 * 1024 : maxSize;

  // Use refs for callbacks to avoid useEffect re-triggering on every render
  const onFilesChangeRef = useRef(onFilesChange);
  const onFilesSelectedRef = useRef(onFilesSelected);
  onFilesChangeRef.current = onFilesChange;
  onFilesSelectedRef.current = onFilesSelected;

  // Sync local files when external files prop resets (e.g., after successful upload)
  useEffect(() => {
    if (files !== undefined && files.length === 0) {
      setLocalFiles([]);
    }
  }, [files]);

  // Sync local files to parent — only depends on localFiles + triggerMode, not callbacks
  useEffect(() => {
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
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => f.size <= effectiveMaxSize);
      const updated = multiple ? [...localFiles, ...droppedFiles] : droppedFiles.slice(0, 1);
      setLocalFiles(updated);
    },
    [localFiles, multiple, effectiveMaxSize]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []).filter((f) => f.size <= effectiveMaxSize);
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
        <p className="text-sm text-muted-foreground">
          拖拽文件到此处，或
          <label className="cursor-pointer text-primary hover:underline">
            <input
              type="file"
              className="hidden"
              accept={effectiveAccept}
              multiple={multiple}
              onChange={handleInputChange}
            />
            点击上传
          </label>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          支持 {effectiveAccept}，单个文件不超过 {formatFileSize(effectiveMaxSize)}
        </p>
      </div>

      {displayFiles.length > 0 && (
        <div className="space-y-2">
          {displayFiles.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
              </div>
              <button onClick={() => removeFile(index)} className="rounded-md p-1 hover:bg-accent">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
