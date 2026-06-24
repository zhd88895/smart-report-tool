import { create } from 'zustand';
import { Script } from '@/types';
import { apiGet, apiPut, apiPutFormData, apiDelete } from '@/services/api';

interface ScriptState {
  scripts: Script[];
  loading: boolean;
  fetchScripts: () => Promise<void>;
  updateScript: (id: string, updates: Partial<Script>) => Promise<void>;
  updateScriptWithAuxFiles: (id: string, formData: FormData) => Promise<void>;
  removeScript: (id: string) => Promise<void>;
}

export const useScriptStore = create<ScriptState>((set, get) => ({
  scripts: [],
  loading: false,

  fetchScripts: async () => {
    set({ loading: true });
    const data = await apiGet('/scripts');
    set({ scripts: data.data?.scripts || [], loading: false });
  },

  updateScript: async (id: string, updates: Partial<Script>) => {
    const body: Record<string, unknown> = {};
    const allowed = ['name','description','scriptType','region','inputFormats','inputFormatManual','version','category','templateRequired','templateIds','requirements','auxiliaryFiles','depsStatus'];
    for (const key of allowed) {
      if (updates[key as keyof Script] !== undefined) {
        body[key] = updates[key as keyof Script];
      }
    }
    await apiPut(`/scripts/${id}`, body);
    await get().fetchScripts();
  },

  updateScriptWithAuxFiles: async (id: string, formData: FormData) => {
    await apiPutFormData(`/scripts/${id}`, formData);
    await get().fetchScripts();
  },

  removeScript: async (id: string) => {
    await apiDelete(`/scripts/${id}`);
    await get().fetchScripts();
  },
}));
