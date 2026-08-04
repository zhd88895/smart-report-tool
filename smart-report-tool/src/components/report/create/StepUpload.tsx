import { InputFileEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BatchFileUploader } from '@/components/report/BatchFileUploader';
import { ArchivePasswordDialog } from '@/components/report/ArchivePasswordDialog';
import { ChevronRight, Loader2 } from 'lucide-react';

interface StepUploadProps {
  /** 卡片标题中的步骤编号（手动选模板时为 3，否则为 2） */
  stepNumber: string;
  files: InputFileEntry[];
  onFilesChange: (files: InputFileEntry[]) => void;
  /** 脚本巡检数据格式（如 "docx xlsx txt"），用于限制上传文件类型 */
  inputFormats?: string;
  /** 是否正在解压压缩包 */
  extracting: boolean;
  extractProgress: string;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  // 压缩包密码对话框
  passwordDialogOpen: boolean;
  passwordFileName: string;
  passwordError: string;
  onPasswordConfirm: (password: string) => void;
  onPasswordCancel: () => void;
}

/** 步骤3：上传巡检数据文件 */
export function StepUpload({
  stepNumber,
  files,
  onFilesChange,
  inputFormats,
  extracting,
  extractProgress,
  canGoNext,
  onPrev,
  onNext,
  passwordDialogOpen,
  passwordFileName,
  passwordError,
  onPasswordConfirm,
  onPasswordCancel,
}: StepUploadProps) {
  return (
    <Card>
      <CardHeader><CardTitle>步骤{stepNumber}：上传巡检数据文件</CardTitle></CardHeader>
      <CardContent>
        <BatchFileUploader
          files={files}
          onFilesChange={onFilesChange}
          inputFormats={inputFormats}
          navButtons={
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={onPrev} disabled={extracting}>上一步</Button>
              <div className="flex items-center gap-2">
                {extracting && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {extractProgress || '正在处理压缩包...'}
                  </span>
                )}
                <Button disabled={!canGoNext || extracting} onClick={onNext}>
                  下一步 <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          }
        />

        {/* 压缩包密码对话框 */}
        <ArchivePasswordDialog
          open={passwordDialogOpen}
          fileName={passwordFileName}
          errorMessage={passwordError}
          loading={extracting}
          onConfirm={onPasswordConfirm}
          onCancel={onPasswordCancel}
        />
      </CardContent>
    </Card>
  );
}
