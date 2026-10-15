import { SceneManager } from './sceneManager';
import { MaterialManager } from './materialManager';
import { appState, MaterialOverride } from './state';
import { exportSceneToGlb } from './exportGlb';
import { DropTextureTarget } from './dragDrop';
import { Color3 } from '@babylonjs/core';

export class UIManager {
  private sceneManager: SceneManager;
  private materialManager: MaterialManager;

  // DOM Elements
  private toastContainer: HTMLElement;
  private textureAssignModal: HTMLDialogElement;
  private currentPendingTextureDrop: DropTextureTarget | null = null;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.materialManager = sceneManager.materialManager;

    this.toastContainer = document.getElementById('toastContainer') as HTMLElement;
    this.textureAssignModal = document.getElementById('textureAssignModal') as HTMLDialogElement;

    this.initTopBar();
    this.initScenePanel();
    this.initMaterialPanel();
    this.initTextureAssignModal();
    this.initKeyboardShortcuts();
    this.updateStatsDisplay();
  }

  showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconMap = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    toast.innerHTML = `
      <span class="toast-icon">${iconMap[type]}</span>
      <span class="toast-msg">${message}</span>
    `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  updateStatsDisplay() {
    const modelBadge = document.getElementById('modelBadge');
    const polyBadge = document.getElementById('polyBadge');

    if (modelBadge) {
      modelBadge.textContent = appState.loadedModelName;
    }
    if (polyBadge) {
      polyBadge.textContent = `${appState.meshCount} mesh • ${appState.vertexCount.toLocaleString()} vertici`;
    }
  }

  private initTopBar() {
    // Camera views
    document.getElementById('btnViewIso')?.addEventListener('click', () => {
      this.sceneManager.setCameraView('isometric');
    });
    document.getElementById('btnViewFront')?.addEventListener('click', () => {
      this.sceneManager.setCameraView('front');
    });
    document.getElementById('btnViewTop')?.addEventListener('click', () => {
      this.sceneManager.setCameraView('top');
    });
    document.getElementById('btnResetFrame')?.addEventListener('click', () => {
      this.sceneManager.frameModel();
    });

    // Auto rotate
    const btnAutoRotate = document.getElementById('btnAutoRotate') as HTMLButtonElement;
    btnAutoRotate?.addEventListener('click', () => {
      const active = !appState.sceneSettings.autoRotate;
      this.sceneManager.setAutoRotate(active);
      btnAutoRotate.classList.toggle('active', active);
    });

    // Babylon Inspector Toggle
    document.getElementById('btnInspector')?.addEventListener('click', () => {
      this.sceneManager.toggleInspector();
      this.showToast('Babylon Sandbox Inspector aperto/chiuso (Tasto I)', 'info');
    });

    // Export GLB
    document.getElementById('btnExportGlb')?.addEventListener('click', async () => {
      try {
        this.showToast('Esportazione GLB in corso...', 'info');
        const cleanName = appState.loadedModelName.replace(/\.[^/.]+$/, '') + '_custom';
        await exportSceneToGlb(this.sceneManager.scene, cleanName);
        this.showToast('✅ File GLB scaricato con successo!', 'success');
      } catch (e: any) {
        this.showToast(`Errore esportazione: ${e.message}`, 'error');
      }
    });

    // Save / Load Presets
    document.getElementById('btnSavePreset')?.addEventListener('click', () => {
      const json = appState.exportPresetJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `preset_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Preset salvato come file JSON!', 'success');
    });

    const fileInputPreset = document.getElementById('fileInputPreset') as HTMLInputElement;
    document.getElementById('btnLoadPreset')?.addEventListener('click', () => {
      fileInputPreset?.click();
    });

    fileInputPreset?.addEventListener('change', async () => {
      if (fileInputPreset.files && fileInputPreset.files[0]) {
        const text = await fileInputPreset.files[0].text();
        if (appState.importPresetJson(text)) {
          this.sceneManager.initImageProcessing();
          this.materialManager.restoreAllOverrides();
          this.refreshScenePanelValues();
          this.populateMaterialDropdown();
          this.showToast('Preset applicato con successo!', 'success');
        }
      }
    });

    // Panel collapse toggles
    document.getElementById('toggleScenePanel')?.addEventListener('click', () => {
      document.getElementById('scenePanel')?.classList.toggle('collapsed');
    });
    document.getElementById('toggleMaterialPanel')?.addEventListener('click', () => {
      document.getElementById('materialPanel')?.classList.toggle('collapsed');
    });
  }

  private initScenePanel() {
    // Tone mapping selector
    const selToneMapping = document.getElementById('selToneMapping') as HTMLSelectElement;
    selToneMapping?.addEventListener('change', () => {
      const val = parseInt(selToneMapping.value, 10);
      this.sceneManager.applyToneMapping(val);
      this.showToast(`Tone Mapping: ${selToneMapping.options[selToneMapping.selectedIndex].text}`, 'info');
    });

    // Exposure
    const sliderExposure = document.getElementById('sliderExposure') as HTMLInputElement;
    const valExposure = document.getElementById('valExposure') as HTMLElement;
    sliderExposure?.addEventListener('input', () => {
      const v = parseFloat(sliderExposure.value);
      valExposure.textContent = v.toFixed(2);
      this.sceneManager.setExposure(v);
    });

    // Contrast
    const sliderContrast = document.getElementById('sliderContrast') as HTMLInputElement;
    const valContrast = document.getElementById('valContrast') as HTMLElement;
    sliderContrast?.addEventListener('input', () => {
      const v = parseFloat(sliderContrast.value);
      valContrast.textContent = v.toFixed(2);
      this.sceneManager.setContrast(v);
    });

    // Vignette
    const chkVignette = document.getElementById('chkVignette') as HTMLInputElement;
    chkVignette?.addEventListener('change', () => {
      this.sceneManager.setVignette(chkVignette.checked);
    });

    // Environment Preset
    const selEnvPreset = document.getElementById('selEnvPreset') as HTMLSelectElement;
    selEnvPreset?.addEventListener('change', () => {
      this.sceneManager.updateEnvironmentPreset(selEnvPreset.value);
    });

    // Custom HDR file input
    const fileInputHdr = document.getElementById('fileInputHdr') as HTMLInputElement;
    document.getElementById('btnLoadCustomHdr')?.addEventListener('click', () => {
      fileInputHdr?.click();
    });
    fileInputHdr?.addEventListener('change', async () => {
      if (fileInputHdr.files && fileInputHdr.files[0]) {
        await this.sceneManager.loadCustomEnvironment(fileInputHdr.files[0]);
        this.showToast('HDRI personalizzato caricato', 'success');
      }
    });

    // Environment Intensity
    const sliderEnvIntensity = document.getElementById('sliderEnvIntensity') as HTMLInputElement;
    const valEnvIntensity = document.getElementById('valEnvIntensity') as HTMLElement;
    sliderEnvIntensity?.addEventListener('input', () => {
      const v = parseFloat(sliderEnvIntensity.value);
      valEnvIntensity.textContent = v.toFixed(2);
      this.sceneManager.setEnvironmentIntensity(v);
    });

    // Environment Rotation
    const sliderEnvRotation = document.getElementById('sliderEnvRotation') as HTMLInputElement;
    const valEnvRotation = document.getElementById('valEnvRotation') as HTMLElement;
    sliderEnvRotation?.addEventListener('input', () => {
      const v = parseInt(sliderEnvRotation.value, 10);
      valEnvRotation.textContent = `${v}°`;
      this.sceneManager.setEnvironmentRotation(v);
    });

    // Background Color
    const inputBgColor = document.getElementById('inputBgColor') as HTMLInputElement;
    inputBgColor?.addEventListener('input', () => {
      this.sceneManager.setBackgroundColor(inputBgColor.value);
    });

    // Ground & Shadows
    const chkGround = document.getElementById('chkGround') as HTMLInputElement;
    chkGround?.addEventListener('change', () => {
      this.sceneManager.setGroundEnabled(chkGround.checked);
    });

    // Hot-Swap toggles
    const chkKeepMaterials = document.getElementById('chkKeepMaterials') as HTMLInputElement;
    chkKeepMaterials?.addEventListener('change', () => {
      appState.sceneSettings.keepMaterialsOnReload = chkKeepMaterials.checked;
      appState.saveToStorage();
    });

    const chkKeepCamera = document.getElementById('chkKeepCamera') as HTMLInputElement;
    chkKeepCamera?.addEventListener('change', () => {
      appState.sceneSettings.keepCameraOnReload = chkKeepCamera.checked;
      appState.saveToStorage();
    });

    // Reset all to Blender
    document.getElementById('btnResetAllBlender')?.addEventListener('click', () => {
      if (confirm('Vuoi davvero ripristinare tutti i materiali ai valori originari di Blender?')) {
        this.materialManager.resetAllMaterialsToBlender();
        this.syncMaterialControlsToActive();
        this.showToast('Materiali ripristinati ai valori originali del GLB', 'warning');
      }
    });

    this.refreshScenePanelValues();
  }

  private refreshScenePanelValues() {
    const s = appState.sceneSettings;
    const selToneMapping = document.getElementById('selToneMapping') as HTMLSelectElement;
    if (selToneMapping) selToneMapping.value = s.toneMappingType.toString();

    const sliderExposure = document.getElementById('sliderExposure') as HTMLInputElement;
    const valExposure = document.getElementById('valExposure') as HTMLElement;
    if (sliderExposure) sliderExposure.value = s.exposure.toString();
    if (valExposure) valExposure.textContent = s.exposure.toFixed(2);

    const sliderContrast = document.getElementById('sliderContrast') as HTMLInputElement;
    const valContrast = document.getElementById('valContrast') as HTMLElement;
    if (sliderContrast) sliderContrast.value = s.contrast.toString();
    if (valContrast) valContrast.textContent = s.contrast.toFixed(2);

    const chkVignette = document.getElementById('chkVignette') as HTMLInputElement;
    if (chkVignette) chkVignette.checked = s.vignetteEnabled;

    const sliderEnvIntensity = document.getElementById('sliderEnvIntensity') as HTMLInputElement;
    const valEnvIntensity = document.getElementById('valEnvIntensity') as HTMLElement;
    if (sliderEnvIntensity) sliderEnvIntensity.value = s.environmentIntensity.toString();
    if (valEnvIntensity) valEnvIntensity.textContent = s.environmentIntensity.toFixed(2);

    const sliderEnvRotation = document.getElementById('sliderEnvRotation') as HTMLInputElement;
    const valEnvRotation = document.getElementById('valEnvRotation') as HTMLElement;
    if (sliderEnvRotation) sliderEnvRotation.value = s.environmentRotation.toString();
    if (valEnvRotation) valEnvRotation.textContent = `${s.environmentRotation}°`;

    const inputBgColor = document.getElementById('inputBgColor') as HTMLInputElement;
    if (inputBgColor) inputBgColor.value = s.bgColor;

    const chkGround = document.getElementById('chkGround') as HTMLInputElement;
    if (chkGround) chkGround.checked = s.groundEnabled;

    const chkKeepMaterials = document.getElementById('chkKeepMaterials') as HTMLInputElement;
    if (chkKeepMaterials) chkKeepMaterials.checked = s.keepMaterialsOnReload;

    const chkKeepCamera = document.getElementById('chkKeepCamera') as HTMLInputElement;
    if (chkKeepCamera) chkKeepCamera.checked = s.keepCameraOnReload;
  }

  populateMaterialDropdown() {
    const selMaterial = document.getElementById('selMaterial') as HTMLSelectElement;
    if (!selMaterial) return;

    selMaterial.innerHTML = '';
    const activeMats = this.materialManager.getActiveMaterials();

    if (activeMats.size === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nessun materiale trovato';
      selMaterial.appendChild(opt);
      appState.activeMaterialName = null;
      return;
    }

    let first = true;
    activeMats.forEach((_, name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      selMaterial.appendChild(opt);

      if (first) {
        appState.activeMaterialName = name;
        first = false;
      }
    });

    this.syncMaterialControlsToActive();
  }

  private initMaterialPanel() {
    const selMaterial = document.getElementById('selMaterial') as HTMLSelectElement;
    selMaterial?.addEventListener('change', () => {
      appState.activeMaterialName = selMaterial.value;
      this.syncMaterialControlsToActive();
    });

    // Albedo Color
    const inputAlbedoColor = document.getElementById('inputAlbedoColor') as HTMLInputElement;
    inputAlbedoColor?.addEventListener('input', () => {
      const mat = this.getActivePBR();
      if (!mat) return;
      mat.albedoColor = Color3.FromHexString(inputAlbedoColor.value);
      appState.setMaterialOverride(mat.name, { albedoColor: inputAlbedoColor.value });
    });

    // Roughness
    const sliderRoughness = document.getElementById('sliderRoughness') as HTMLInputElement;
    const valRoughness = document.getElementById('valRoughness') as HTMLElement;
    sliderRoughness?.addEventListener('input', () => {
      const mat = this.getActivePBR();
      if (!mat) return;
      const v = parseFloat(sliderRoughness.value);
      valRoughness.textContent = v.toFixed(2);
      mat.roughness = v;
      appState.setMaterialOverride(mat.name, { roughness: v });
    });

    // Metallic
    const sliderMetallic = document.getElementById('sliderMetallic') as HTMLInputElement;
    const valMetallic = document.getElementById('valMetallic') as HTMLElement;
    sliderMetallic?.addEventListener('input', () => {
      const mat = this.getActivePBR();
      if (!mat) return;
      const v = parseFloat(sliderMetallic.value);
      valMetallic.textContent = v.toFixed(2);
      mat.metallic = v;
      appState.setMaterialOverride(mat.name, { metallic: v });
    });

    // Emissive Color & Intensity
    const inputEmissiveColor = document.getElementById('inputEmissiveColor') as HTMLInputElement;
    const sliderEmissive = document.getElementById('sliderEmissive') as HTMLInputElement;
    const valEmissive = document.getElementById('valEmissive') as HTMLElement;

    const updateEmissive = () => {
      const mat = this.getActivePBR();
      if (!mat) return;
      const intensity = parseFloat(sliderEmissive.value);
      valEmissive.textContent = intensity.toFixed(2);
      mat.emissiveColor = Color3.FromHexString(inputEmissiveColor.value).scale(intensity);
      appState.setMaterialOverride(mat.name, {
        emissiveColor: inputEmissiveColor.value,
        emissiveIntensity: intensity
      });
    };
    inputEmissiveColor?.addEventListener('input', updateEmissive);
    sliderEmissive?.addEventListener('input', updateEmissive);

    // Clearcoat
    const chkClearcoat = document.getElementById('chkClearcoat') as HTMLInputElement;
    const sliderClearcoatInt = document.getElementById('sliderClearcoatInt') as HTMLInputElement;
    const sliderClearcoatRough = document.getElementById('sliderClearcoatRough') as HTMLInputElement;

    const updateClearcoat = () => {
      const mat = this.getActivePBR();
      if (!mat) return;
      mat.clearCoat.isEnabled = chkClearcoat.checked;
      mat.clearCoat.intensity = parseFloat(sliderClearcoatInt.value);
      mat.clearCoat.roughness = parseFloat(sliderClearcoatRough.value);
      appState.setMaterialOverride(mat.name, {
        clearCoatEnabled: chkClearcoat.checked,
        clearCoatIntensity: mat.clearCoat.intensity,
        clearCoatRoughness: mat.clearCoat.roughness
      });
    };
    chkClearcoat?.addEventListener('change', updateClearcoat);
    sliderClearcoatInt?.addEventListener('input', updateClearcoat);
    sliderClearcoatRough?.addEventListener('input', updateClearcoat);

    // Alpha / Opacity
    const sliderAlpha = document.getElementById('sliderAlpha') as HTMLInputElement;
    const valAlpha = document.getElementById('valAlpha') as HTMLElement;
    sliderAlpha?.addEventListener('input', () => {
      const mat = this.getActivePBR();
      if (!mat) return;
      const v = parseFloat(sliderAlpha.value);
      valAlpha.textContent = v.toFixed(2);
      mat.alpha = v;
      appState.setMaterialOverride(mat.name, { alpha: v });
    });

    // Texture slots file inputs
    this.bindTextureSlotUI('albedo', 'btnAlbedoTex', 'inputAlbedoTex', 'btnClearAlbedoTex');
    this.bindTextureSlotUI('bump', 'btnBumpTex', 'inputBumpTex', 'btnClearBumpTex');
    this.bindTextureSlotUI('metallicRoughness', 'btnMetallicTex', 'inputMetallicTex', 'btnClearMetallicTex');
    this.bindTextureSlotUI('emissive', 'btnEmissiveTex', 'inputEmissiveTex', 'btnClearEmissiveTex');

    // Reset this material to Blender
    document.getElementById('btnResetMatToBlender')?.addEventListener('click', () => {
      if (!appState.activeMaterialName) return;
      this.materialManager.resetMaterialToBlender(appState.activeMaterialName);
      this.syncMaterialControlsToActive();
      this.showToast(`Materiale '${appState.activeMaterialName}' ripristinato ai valori Blender`, 'info');
    });

    this.populateMaterialDropdown();
  }

  private bindTextureSlotUI(
    slot: 'albedo' | 'bump' | 'metallicRoughness' | 'emissive' | 'ambient',
    btnId: string,
    inputId: string,
    clearBtnId: string
  ) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId) as HTMLInputElement;
    const clearBtn = document.getElementById(clearBtnId);

    btn?.addEventListener('click', () => input?.click());

    input?.addEventListener('change', async () => {
      if (input.files && input.files[0] && appState.activeMaterialName) {
        await this.materialManager.setTextureFromFile(appState.activeMaterialName, slot, input.files[0]);
        this.updateTextureSlotThumbnail(slot);
        this.showToast(`Texture '${input.files[0].name}' assegnata a ${slot}`, 'success');
      }
    });

    clearBtn?.addEventListener('click', () => {
      if (appState.activeMaterialName) {
        this.materialManager.clearTextureSlot(appState.activeMaterialName, slot);
        this.updateTextureSlotThumbnail(slot);
        this.showToast(`Texture rimossa dallo slot ${slot}`, 'info');
      }
    });
  }

  private getActivePBR() {
    if (!appState.activeMaterialName) return null;
    return this.materialManager.getMaterial(appState.activeMaterialName);
  }

  syncMaterialControlsToActive() {
    const mat = this.getActivePBR();
    if (!mat) return;

    // Albedo
    const inputAlbedoColor = document.getElementById('inputAlbedoColor') as HTMLInputElement;
    if (inputAlbedoColor && mat.albedoColor) {
      inputAlbedoColor.value = mat.albedoColor.toHexString();
    }

    // Roughness
    const sliderRoughness = document.getElementById('sliderRoughness') as HTMLInputElement;
    const valRoughness = document.getElementById('valRoughness') as HTMLElement;
    if (sliderRoughness) {
      sliderRoughness.value = (mat.roughness ?? 0.5).toString();
      if (valRoughness) valRoughness.textContent = (mat.roughness ?? 0.5).toFixed(2);
    }

    // Metallic
    const sliderMetallic = document.getElementById('sliderMetallic') as HTMLInputElement;
    const valMetallic = document.getElementById('valMetallic') as HTMLElement;
    if (sliderMetallic) {
      sliderMetallic.value = (mat.metallic ?? 0.0).toString();
      if (valMetallic) valMetallic.textContent = (mat.metallic ?? 0.0).toFixed(2);
    }

    // Emissive
    const inputEmissiveColor = document.getElementById('inputEmissiveColor') as HTMLInputElement;
    const sliderEmissive = document.getElementById('sliderEmissive') as HTMLInputElement;
    const valEmissive = document.getElementById('valEmissive') as HTMLElement;
    if (inputEmissiveColor && mat.emissiveColor) {
      inputEmissiveColor.value = mat.emissiveColor.toHexString();
    }
    if (sliderEmissive) {
      sliderEmissive.value = '1.0';
      if (valEmissive) valEmissive.textContent = '1.00';
    }

    // Clearcoat
    const chkClearcoat = document.getElementById('chkClearcoat') as HTMLInputElement;
    const sliderClearcoatInt = document.getElementById('sliderClearcoatInt') as HTMLInputElement;
    const sliderClearcoatRough = document.getElementById('sliderClearcoatRough') as HTMLInputElement;
    if (chkClearcoat) chkClearcoat.checked = !!mat.clearCoat.isEnabled;
    if (sliderClearcoatInt) sliderClearcoatInt.value = (mat.clearCoat.intensity ?? 0.5).toString();
    if (sliderClearcoatRough) sliderClearcoatRough.value = (mat.clearCoat.roughness ?? 0.1).toString();

    // Alpha
    const sliderAlpha = document.getElementById('sliderAlpha') as HTMLInputElement;
    const valAlpha = document.getElementById('valAlpha') as HTMLElement;
    if (sliderAlpha) {
      sliderAlpha.value = (mat.alpha ?? 1.0).toString();
      if (valAlpha) valAlpha.textContent = (mat.alpha ?? 1.0).toFixed(2);
    }

    // Update texture thumbnails
    this.updateTextureSlotThumbnail('albedo');
    this.updateTextureSlotThumbnail('bump');
    this.updateTextureSlotThumbnail('metallicRoughness');
    this.updateTextureSlotThumbnail('emissive');
  }

  private updateTextureSlotThumbnail(slot: string) {
    const thumb = document.getElementById(`thumb_${slot}`) as HTMLElement;
    if (!thumb) return;

    const mat = this.getActivePBR();
    if (!mat) {
      thumb.style.backgroundImage = 'none';
      return;
    }

    let tex: any = null;
    if (slot === 'albedo') tex = mat.albedoTexture;
    if (slot === 'bump') tex = mat.bumpTexture;
    if (slot === 'metallicRoughness') tex = mat.metallicTexture;
    if (slot === 'emissive') tex = mat.emissiveTexture;

    if (tex && tex.url) {
      thumb.style.backgroundImage = `url("${tex.url}")`;
      thumb.classList.add('has-texture');
    } else {
      thumb.style.backgroundImage = 'none';
      thumb.classList.remove('has-texture');
    }
  }

  openTextureAssignModal(target: DropTextureTarget) {
    this.currentPendingTextureDrop = target;

    const modalTitle = document.getElementById('modalTextureTitle') as HTMLElement;
    const modalSubtitle = document.getElementById('modalTextureSubtitle') as HTMLElement;

    if (modalTitle) {
      modalTitle.textContent = `Assegna "${target.file.name}"`;
    }
    if (modalSubtitle) {
      modalSubtitle.textContent = `Oggetto: ${target.meshName} • Materiale: ${target.materialName}`;
    }

    this.textureAssignModal.showModal();
  }

  private initTextureAssignModal() {
    const slots = [
      { id: 'btnAssignAlbedo', slot: 'albedo' as const },
      { id: 'btnAssignBump', slot: 'bump' as const },
      { id: 'btnAssignMetallicRough', slot: 'metallicRoughness' as const },
      { id: 'btnAssignEmissive', slot: 'emissive' as const },
      { id: 'btnAssignAmbient', slot: 'ambient' as const }
    ];

    for (const item of slots) {
      document.getElementById(item.id)?.addEventListener('click', async () => {
        if (!this.currentPendingTextureDrop) return;
        const target = this.currentPendingTextureDrop;
        this.textureAssignModal.close();

        await this.materialManager.setTextureFromFile(target.materialName, item.slot, target.file);

        // Select this material in dropdown if not active
        const selMaterial = document.getElementById('selMaterial') as HTMLSelectElement;
        if (selMaterial) {
          selMaterial.value = target.materialName;
          appState.activeMaterialName = target.materialName;
          this.syncMaterialControlsToActive();
        }

        this.showToast(`Texture "${target.file.name}" assegnata a [${item.slot}] di "${target.materialName}"`, 'success');
        this.currentPendingTextureDrop = null;
      });
    }

    document.getElementById('btnAssignCancel')?.addEventListener('click', () => {
      this.textureAssignModal.close();
      this.currentPendingTextureDrop = null;
    });
  }

  private initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      if (e.key === 'i' || e.key === 'I') {
        this.sceneManager.toggleInspector();
      } else if (e.key === 'f' || e.key === 'F') {
        this.sceneManager.frameModel();
      } else if (e.key === 'r' || e.key === 'R') {
        const btn = document.getElementById('btnAutoRotate');
        btn?.click();
      }
    });
  }
}
