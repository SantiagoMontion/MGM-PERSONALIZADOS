export const flags = {
  useNewExportWorker: import.meta.env.VITE_FLAG_NEW_EXPORT_WORKER === 'true',
  useNewMockupScale: import.meta.env.VITE_FLAG_NEW_MOCKUP_SCALE === 'true',
  showAdvancedTools: import.meta.env.VITE_FLAG_SHOW_ADVANCED_TOOLS === 'true'
};
