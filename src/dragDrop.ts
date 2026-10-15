import { SceneManager } from './sceneManager';
import { appState } from './state';

export interface DropTextureTarget {
  file: File;
  materialName: string;
  meshName: string;
  screenX: number;
  screenY: number;
}

export class DragDropHandler {
  private sceneManager: SceneManager;
  private overlayEl: HTMLElement;
  private onTextureDropCallback?: (target: DropTextureTarget) => void;
  private onModelLoadedCallback?: (stats: any) => void;
  private onToastCallback?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

  constructor(
    sceneManager: SceneManager,
    overlayEl: HTMLElement,
    callbacks?: {
      onTextureDrop?: (target: DropTextureTarget) => void;
      onModelLoaded?: (stats: any) => void;
      onToast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    }
  ) {
    this.sceneManager = sceneManager;
    this.overlayEl = overlayEl;
    this.onTextureDropCallback = callbacks?.onTextureDrop;
    this.onModelLoadedCallback = callbacks?.onModelLoaded;
    this.onToastCallback = callbacks?.onToast;

    this.initEvents();
  }

  private initEvents() {
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      this.overlayEl.classList.add('active');
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this.overlayEl.classList.remove('active');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.overlayEl.classList.remove('active');

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const ext = file.name.split('.').pop()?.toLowerCase();

      // 1. GLB / GLTF Model Hot Swap
      if (ext === 'glb' || ext === 'gltf') {
        try {
          this.onToastCallback?.(`Caricamento ${file.name}...`, 'info');
          const stats = await this.sceneManager.loadModelFile(file);
          this.onModelLoadedCallback?.(stats);

          if (appState.sceneSettings.keepMaterialsOnReload && stats.materialsRestoredCount > 0) {
            this.onToastCallback?.(
              `✨ Modello aggiornato! ${stats.materialsRestoredCount} materiali mantenuti con le modifiche.`,
              'success'
            );
          } else {
            this.onToastCallback?.(
              `✨ Modello ${file.name} caricato con successo (${stats.meshCount} mesh).`,
              'success'
            );
          }
        } catch (err: any) {
          console.error(err);
          this.onToastCallback?.(`Errore caricamento modello: ${err.message || err}`, 'error');
        }
        return;
      }

      // 2. HDR / ENV Environment Map
      if (ext === 'hdr' || ext === 'env' || ext === 'dds') {
        try {
          this.onToastCallback?.(`Impostazione ambiente HDRI da ${file.name}...`, 'info');
          await this.sceneManager.loadCustomEnvironment(file);
          this.onToastCallback?.(`🌅 Ambiente HDRI aggiornato con successo!`, 'success');
        } catch (err: any) {
          this.onToastCallback?.(`Errore caricamento ambiente: ${err.message || err}`, 'error');
        }
        return;
      }

      // 3. Preset JSON
      if (ext === 'json') {
        try {
          const text = await file.text();
          const ok = appState.importPresetJson(text);
          if (ok) {
            this.sceneManager.initImageProcessing();
            this.sceneManager.setEnvironmentIntensity(appState.sceneSettings.environmentIntensity);
            this.sceneManager.materialManager.restoreAllOverrides();
            this.onToastCallback?.(`📁 Preset caricato con successo!`, 'success');
          } else {
            this.onToastCallback?.(`Formato JSON preset non valido`, 'error');
          }
        } catch (err: any) {
          this.onToastCallback?.(`Errore lettura preset: ${err.message}`, 'error');
        }
        return;
      }

      // 4. Image Texture Drop (PNG, JPG, WEBP, etc.)
      if (file.type.startsWith('image/')) {
        // Raycast pick against the 3D scene
        const pick = this.sceneManager.scene.pick(e.clientX, e.clientY);
        if (pick && pick.hit && pick.pickedMesh && pick.pickedMesh.material) {
          const matName = pick.pickedMesh.material.name;
          const meshName = pick.pickedMesh.name;

          if (this.onTextureDropCallback) {
            this.onTextureDropCallback({
              file,
              materialName: matName,
              meshName,
              screenX: e.clientX,
              screenY: e.clientY
            });
          }
        } else {
          // If dropped in empty space, assign to currently selected active material in sidebar if any
          if (appState.activeMaterialName && this.onTextureDropCallback) {
            this.onTextureDropCallback({
              file,
              materialName: appState.activeMaterialName,
              meshName: 'Materiale selezionato',
              screenX: e.clientX,
              screenY: e.clientY
            });
          } else {
            this.onToastCallback?.(`Trascina l'immagine direttamente su un elemento 3D o seleziona un materiale`, 'warning');
          }
        }
      }
    });
  }
}
