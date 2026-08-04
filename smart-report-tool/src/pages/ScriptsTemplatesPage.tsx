import { useState, useEffect, useMemo } from 'react';
import { useScriptStore } from '@/stores/scriptStore';
import { useDocTemplateStore } from '@/stores/docTemplateStore';
import { Script, DocTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { ScriptListPanel } from '@/components/script/ScriptListPanel';
import { ScriptFormDialog } from '@/components/script/ScriptFormDialog';
import { TemplateListPanel } from '@/components/template/TemplateListPanel';
import { TemplateFormDialog } from '@/components/template/TemplateFormDialog';

export default function ScriptsTemplatesPage() {
  const { scripts, fetchScripts } = useScriptStore();
  const { docTemplates, fetchDocTemplates } = useDocTemplateStore();

  // 脚本表单对话框（上传 / 编辑共用，editTarget 为 null 即上传模式）
  const [showScriptForm, setShowScriptForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Script | null>(null);
  // 模板表单对话框（上传 / 编辑共用）
  const [showTplForm, setShowTplForm] = useState(false);
  const [editTplTarget, setEditTplTarget] = useState<DocTemplate | null>(null);

  useEffect(() => { fetchScripts(); fetchDocTemplates(); }, [fetchScripts, fetchDocTemplates]);

  // 脚本分组数量（分组键为脚本名称，与 ScriptListPanel 的分组逻辑一致）
  const scriptGroupCount = useMemo(() => new Set(scripts.map((s) => s.name)).size, [scripts]);

  const openScriptUpload = () => { setEditTarget(null); setShowScriptForm(true); };
  const openScriptEdit = (script: Script) => { setEditTarget(script); setShowScriptForm(true); };
  const openTplUpload = () => { setEditTplTarget(null); setShowTplForm(true); };
  const openTplEdit = (tpl: DocTemplate) => { setEditTplTarget(tpl); setShowTplForm(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">脚本及模板管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openTplUpload}>
            <Plus className="mr-2 h-4 w-4" />上传模板
          </Button>
          <Button onClick={openScriptUpload}>
            <Plus className="mr-2 h-4 w-4" />上传脚本
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scripts">
        <TabsList>
          <TabsTrigger value="scripts">脚本列表（{scriptGroupCount}）</TabsTrigger>
          <TabsTrigger value="templates">模板列表（{docTemplates.length}）</TabsTrigger>
        </TabsList>

        <TabsContent value="scripts" className="space-y-4 mt-4">
          <ScriptListPanel onEditScript={openScriptEdit} />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4 mt-4">
          <TemplateListPanel onEditTemplate={openTplEdit} />
        </TabsContent>
      </Tabs>

      {/* ═════ 脚本上传 / 编辑对话框（含依赖管理、模板选择、版本确认、脚本编辑器等） ═════ */}
      <ScriptFormDialog
        open={showScriptForm}
        onOpenChange={setShowScriptForm}
        editTarget={editTarget}
        onEditTargetChange={setEditTarget}
        onOpenTemplateUpload={openTplUpload}
      />

      {/* ═════ 模板上传 / 编辑对话框（含覆盖确认） ═════ */}
      <TemplateFormDialog
        open={showTplForm}
        onOpenChange={setShowTplForm}
        editTarget={editTplTarget}
      />
    </div>
  );
}
