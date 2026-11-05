/* ==========================================================
   PONTE ENTRE O PAINEL E O APLICATIVO
   Expõe só o necessário para a página: o controle de zoom.
   No navegador comum este arquivo não existe e window.rdcApp
   fica indefinido.
   ========================================================== */
'use strict';

const { contextBridge, webFrame } = require('electron');

contextBridge.exposeInMainWorld('rdcApp', {
  setZoom(factor) {
    const value = Number(factor);
    if (Number.isFinite(value) && value >= 0.5 && value <= 3) webFrame.setZoomFactor(value);
  },
});
