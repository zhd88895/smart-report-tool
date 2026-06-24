import { create } from 'zustand';
import { DocTemplate } from '@/types';
import { apiGet, apiPut, apiPutFormData, apiDelete } from '@/services/api';

interface DocTemplateState {
  docTemplates: DocTemplate[];
  loading: boolean;
  fetchDocTemplates: () => Promise<void>;
  updateDocTemplate: (id: string, updates: Partial<DocTemplate>) => Promise<void>;
  updateDocTemplateWithFile: (id: string, formData: FormData) => Promise<void>;
  removeDocTemplate: (id: string) => Promise<void>;
}

export const useDocTemplateStore = create<DocTemplateState>((set, get) => ({
  docTemplates: [],
  loading: false,

  fetchDocTemplates: async () => {
    set({ loading: true });
    const data = await apiGet('/templates');
    set({ docTemplates: data.data?.templates || [], loading: false });
  },

  updateDocTemplate: async (id: string, updates: Partial<DocTemplate>) => {
    const body: Record<string, unknown> = {};
    const allowed = ['name','description'];
    for (const key of allowed) {
      if (updates[key as keyof DocTemplate] !== undefined) {
        body[key] = updates[key as keyof DocTemplate];
      }
    }
    await apiPut(`/templates/${id}`, body);
    await get().fetchDocTemplates();
  },

  updateDocTemplateWithFile: async (id: string, formData: FormData) => {
    await apiPutFormData(`/templates/${id}`, formData);
    await get().fetchDocTemplates();
  },

  removeDocTemplate: async (id: string) => {
    await apiDelete(`/templates/${id}`);
    await get().fetchDocTemplates();
  },
}));
