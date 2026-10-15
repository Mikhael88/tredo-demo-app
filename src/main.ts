import './style.css';
import { SceneManager } from './sceneManager';
import { UIManager } from './ui';
import { DragDropHandler } from './dragDrop';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const dropOverlay = document.getElementById('dropOverlay') as HTMLElement;

  if (!canvas || !dropOverlay) {
    console.error('Critical elements missing from DOM');
    return;
  }

  // 1. Initialize 3D Scene
  const sceneManager = new SceneManager(canvas);

  // 2. Initialize UI Manager
  const uiManager = new UIManager(sceneManager);

  // 3. Initialize Drag and Drop
  new DragDropHandler(sceneManager, dropOverlay, {
    onTextureDrop: (target) => {
      uiManager.openTextureAssignModal(target);
    },
    onModelLoaded: () => {
      uiManager.populateMaterialDropdown();
      uiManager.updateStatsDisplay();
    },
    onToast: (msg, type) => {
      uiManager.showToast(msg, type);
    }
  });

  console.log('✨ Babylon Sandbox Hot-Swap Studio ready!');
});
