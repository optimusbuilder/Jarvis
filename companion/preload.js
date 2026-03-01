import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("auraCompanion", {
  getState: () => ipcRenderer.invoke("aura:get-state"),
  toggleOverlay: () => ipcRenderer.invoke("aura:toggle-overlay"),
  startListening: () => ipcRenderer.invoke("aura:start-listening"),
  stopRun: () => ipcRenderer.invoke("aura:stop-run"),
  runInstruction: (instruction) => ipcRenderer.invoke("aura:run-instruction", { instruction }),
  toggleKill: (reason) => ipcRenderer.invoke("aura:toggle-kill", { reason }),
  setDryRun: (dryRun) => ipcRenderer.invoke("aura:set-dry-run", { dryRun }),
  updateSetting: (key, value) => ipcRenderer.invoke("aura:update-setting", { key, value }),
  startStack: (reason) => ipcRenderer.invoke("aura:start-stack", { reason }),
  stopStack: (reason) => ipcRenderer.invoke("aura:stop-stack", { reason }),
  toggleWakeWord: () => ipcRenderer.invoke("aura:toggle-wake-word"),
  refreshStatus: () => ipcRenderer.invoke("aura:refresh-status"),
  openControlCenter: () => ipcRenderer.invoke("aura:open-control-center"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("aura:state", handler);
    return () => ipcRenderer.removeListener("aura:state", handler);
  }
});
