import { useScriptStore } from '@/stores/scriptStore';

export function useScripts() {
  const scripts = useScriptStore((state) => state.scripts);
  const isLoading = useScriptStore((state) => state.loading);
  const fetchScripts = useScriptStore((state) => state.fetchScripts);
  const updateScript = useScriptStore((state) => state.updateScript);
  const removeScript = useScriptStore((state) => state.removeScript);

  return { scripts, isLoading, fetchScripts, updateScript, removeScript, refreshScripts: fetchScripts };
}
