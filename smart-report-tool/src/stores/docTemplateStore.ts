import { create } from 'zustand';
import { DocTemplate } from '@/types';
import { apiGet, apiDelete } from '@/services/api';
import { getAllDocTemplatesService, addDocTemplate as addDocTemplateService, deleteDocTemplateService } from '@/services/templateService';

interface DocTemplateState {
  docTemplates: DocTemplate[];
  loading: boolean;
  fetchDocTemplates: () => Promise<void>;
  addDocTemplate: (template: DocTemplate) => Promise<void>;
  removeDocTemplate: (id: string) => Promise<void>;
}

export const useDocTemplateStore = create<DocTemplateState>((set, get) => ({
  docTemplates: [],
  loading: false,

  fetchDocTemplates: async () => {
    set({ loading: true });
    const local = await getAllDocTemplatesService().catch(() => []);
    const localMap = new Map<string, DocTemplate>(local.map((t: DocTemplate) => [t.id, t]));
    try {
      const data = await apiGet('/templates');
      const remote: DocTemplate[] = (data.templates || []);
      const merged = remote.map((r) => localMap.get(r.id) ?? r);
      for (const t of local) {
        if (!merged.find((m) => m.id === t.id)) merged.push(t);
      }
      set({ docTemplates: merged, loading: false });
    } catch {
      set({ docTemplates: local, loading: false });
    }
  },

  addDocTemplate: async (template: DocTemplate) => {
    await addDocTemplateService(template);
    await get().fetchDocTemplates();
  },

  removeDocTemplate: async (id: string) => {
    try { await apiDelete(`/templates/${id}`); } catch {}
    await deleteDocTemplateService(id);
    await get().fetchDocTemplates();
  },
}));
