export interface TextureData {
  name: string;
  dataUrl: string; // Base64 or Blob URL
  uScale?: number;
  vScale?: number;
}

export interface MaterialOverride {
  materialName: string;
  albedoColor?: string; // Hex e.g. "#ffffff"
  roughness?: number;
  metallic?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
  alpha?: number;
  transparencyMode?: number;
  clearCoatEnabled?: boolean;
  clearCoatIntensity?: number;
  clearCoatRoughness?: number;
  bumpIntensity?: number;
  invertNormalMapX?: boolean;
  invertNormalMapY?: boolean;
  textures: {
    albedo?: TextureData;
    bump?: TextureData;
    metallicRoughness?: TextureData;
    emissive?: TextureData;
    ambient?: TextureData;
  };
}

export interface SceneSettings {
  toneMappingType: number; // 0: Standard, 1: ACES, 2: Khronos PBR Neutral, -1: None
  exposure: number;
  contrast: number;
  vignetteEnabled: boolean;
  vignetteWeight: number;
  environmentIntensity: number;
  environmentRotation: number;
  environmentPreset: string;
  customEnvDataUrl?: string;
  bgColor: string;
  bgBlur: number;
  groundEnabled: boolean;
  groundShadows: boolean;
  autoRotate: boolean;
  keepCameraOnReload: boolean;
  keepMaterialsOnReload: boolean;
  ssaoEnabled?: boolean;
  ssaoStrength?: number;
  ssaoRadius?: number;
  ssaoSamples?: number;
}

const STORAGE_KEY_MATERIALS = 'babylon_sandbox_materials_v1';
const STORAGE_KEY_SCENE = 'babylon_sandbox_scene_v1';

export class AppState {
  // Map of material name -> MaterialOverride
  materials: Map<string, MaterialOverride> = new Map();

  sceneSettings: SceneSettings = {
    toneMappingType: 2, // Khronos PBR Neutral by default for accurate Blender / e-commerce rendering!
    exposure: 1.0,
    contrast: 1.0,
    vignetteEnabled: false,
    vignetteWeight: 1.5,
    environmentIntensity: 1.0,
    environmentRotation: 0,
    environmentPreset: 'studio',
    bgColor: '#1a1d24',
    bgBlur: 0.2,
    groundEnabled: true,
    groundShadows: true,
    autoRotate: false,
    keepCameraOnReload: true,
    keepMaterialsOnReload: true
  };

  activeMaterialName: string | null = null;
  loadedModelName: string = 'Nessun modello caricato';
  meshCount: number = 0;
  vertexCount: number = 0;

  constructor() {
    this.loadFromStorage();
  }

  getMaterialOverride(name: string): MaterialOverride | undefined {
    return this.materials.get(name);
  }

  setMaterialOverride(name: string, override: Partial<MaterialOverride>) {
    const existing = this.materials.get(name) || {
      materialName: name,
      textures: {}
    };

    const updated: MaterialOverride = {
      ...existing,
      ...override,
      textures: {
        ...existing.textures,
        ...(override.textures || {})
      }
    };

    this.materials.set(name, updated);
    this.saveToStorage();
  }

  clearMaterialOverride(name: string) {
    this.materials.delete(name);
    this.saveToStorage();
  }

  clearAllMaterialOverrides() {
    this.materials.clear();
    this.saveToStorage();
  }

  saveToStorage() {
    try {
      const matObj: Record<string, MaterialOverride> = {};
      this.materials.forEach((val, key) => {
        // Strip huge textures if they exceed storage limits or store references
        matObj[key] = val;
      });
      localStorage.setItem(STORAGE_KEY_MATERIALS, JSON.stringify(matObj));
      localStorage.setItem(STORAGE_KEY_SCENE, JSON.stringify(this.sceneSettings));
    } catch (e) {
      console.warn('LocalStorage save quota exceeded or failed:', e);
    }
  }

  loadFromStorage() {
    try {
      const savedScene = localStorage.getItem(STORAGE_KEY_SCENE);
      if (savedScene) {
        this.sceneSettings = { ...this.sceneSettings, ...JSON.parse(savedScene) };
      }

      const savedMats = localStorage.getItem(STORAGE_KEY_MATERIALS);
      if (savedMats) {
        const parsed = JSON.parse(savedMats);
        this.materials.clear();
        for (const [key, val] of Object.entries(parsed)) {
          this.materials.set(key, val as MaterialOverride);
        }
      }
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
    }
  }

  exportPresetJson(): string {
    const data = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      sceneSettings: this.sceneSettings,
      materials: Object.fromEntries(this.materials)
    };
    return JSON.stringify(data, null, 2);
  }

  importPresetJson(jsonStr: string): boolean {
    try {
      const data = JSON.parse(jsonStr);
      if (data.sceneSettings) {
        this.sceneSettings = { ...this.sceneSettings, ...data.sceneSettings };
      }
      if (data.materials) {
        this.materials.clear();
        for (const [key, val] of Object.entries(data.materials)) {
          this.materials.set(key, val as MaterialOverride);
        }
      }
      this.saveToStorage();
      return true;
    } catch (e) {
      console.error('Failed to parse preset JSON:', e);
      return false;
    }
  }
}

export const appState = new AppState();
