import {
  PBRMaterial,
  Color3,
  Texture,
  Scene,
  AbstractMesh
} from '@babylonjs/core';
import { appState, MaterialOverride, TextureData } from './state';

export interface BlenderOriginalMaterial {
  albedoColor: Color3;
  roughness: number;
  metallic: number;
  emissiveColor: Color3;
  alpha: number;
  hasAlbedoTexture: boolean;
  hasBumpTexture: boolean;
  hasMetallicTexture: boolean;
  hasEmissiveTexture: boolean;
}

export class MaterialManager {
  private scene: Scene;
  // Cache of original blender settings per material name
  private originalBlenderSettings: Map<string, BlenderOriginalMaterial> = new Map();
  // Map of active PBR materials in the loaded model
  private activeMaterials: Map<string, PBRMaterial> = new Map();
  // In-memory active blob textures to avoid re-reading
  private textureBlobUrls: Map<string, string> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  setScene(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Scans meshes and indexes all PBR materials
   */
  registerModelMaterials(meshes: AbstractMesh[]) {
    this.activeMaterials.clear();

    for (const mesh of meshes) {
      if (!mesh.material) continue;

      if (mesh.material instanceof PBRMaterial) {
        this.registerPBRMaterial(mesh.material);
      } else if ('subMaterials' in mesh.material && Array.isArray((mesh.material as any).subMaterials)) {
        for (const subMat of (mesh.material as any).subMaterials) {
          if (subMat instanceof PBRMaterial) {
            this.registerPBRMaterial(subMat);
          }
        }
      }
    }

    console.log(`[MaterialManager] Registered ${this.activeMaterials.size} PBR materials.`);
  }

  private registerPBRMaterial(pbr: PBRMaterial) {
    const name = pbr.name;
    this.activeMaterials.set(name, pbr);

    // Save original settings if we haven't seen this material yet
    if (!this.originalBlenderSettings.has(name)) {
      this.originalBlenderSettings.set(name, {
        albedoColor: pbr.albedoColor ? pbr.albedoColor.clone() : new Color3(1, 1, 1),
        roughness: pbr.roughness !== undefined && pbr.roughness !== null ? pbr.roughness : 0.5,
        metallic: pbr.metallic !== undefined && pbr.metallic !== null ? pbr.metallic : 0.0,
        emissiveColor: pbr.emissiveColor ? pbr.emissiveColor.clone() : new Color3(0, 0, 0),
        alpha: pbr.alpha !== undefined ? pbr.alpha : 1.0,
        hasAlbedoTexture: !!pbr.albedoTexture,
        hasBumpTexture: !!pbr.bumpTexture,
        hasMetallicTexture: !!pbr.metallicTexture,
        hasEmissiveTexture: !!pbr.emissiveTexture
      });
    }

    // If keepMaterialsOnReload is enabled, restore any previous customizations!
    if (appState.sceneSettings.keepMaterialsOnReload) {
      const override = appState.getMaterialOverride(name);
      if (override) {
        this.applyOverrideToMaterial(pbr, override);
      }
    }
  }

  /**
   * Re-applies all stored material overrides to current scene
   */
  restoreAllOverrides() {
    this.activeMaterials.forEach((pbr, name) => {
      const override = appState.getMaterialOverride(name);
      if (override) {
        this.applyOverrideToMaterial(pbr, override);
      }
    });
  }

  /**
   * Applies an override definition to a Babylon PBRMaterial
   */
  applyOverrideToMaterial(pbr: PBRMaterial, override: MaterialOverride) {
    if (override.albedoColor) {
      pbr.albedoColor = Color3.FromHexString(override.albedoColor);
    }
    if (override.roughness !== undefined) {
      pbr.roughness = override.roughness;
    }
    if (override.metallic !== undefined) {
      pbr.metallic = override.metallic;
    }
    if (override.emissiveColor) {
      pbr.emissiveColor = Color3.FromHexString(override.emissiveColor);
    }
    if (override.emissiveIntensity !== undefined) {
      // Babylon uses emissiveColor multiplier or emissive intensity if available
      pbr.emissiveColor = pbr.emissiveColor.scale(override.emissiveIntensity);
    }
    if (override.alpha !== undefined) {
      pbr.alpha = override.alpha;
    }

    // Clearcoat
    if (override.clearCoatEnabled !== undefined) {
      pbr.clearCoat.isEnabled = override.clearCoatEnabled;
      if (override.clearCoatIntensity !== undefined) {
        pbr.clearCoat.intensity = override.clearCoatIntensity;
      }
      if (override.clearCoatRoughness !== undefined) {
        pbr.clearCoat.roughness = override.clearCoatRoughness;
      }
    }

    // Normal map inverted coordinates
    if (override.invertNormalMapX !== undefined) {
      pbr.invertNormalMapX = override.invertNormalMapX;
    }
    if (override.invertNormalMapY !== undefined) {
      pbr.invertNormalMapY = override.invertNormalMapY;
    }

    // Apply textures
    if (override.textures.albedo) {
      this.assignTextureToSlot(pbr, 'albedo', override.textures.albedo.dataUrl, override.textures.albedo.uScale, override.textures.albedo.vScale);
    }
    if (override.textures.bump) {
      this.assignTextureToSlot(pbr, 'bump', override.textures.bump.dataUrl, override.textures.bump.uScale, override.textures.bump.vScale);
    }
    if (override.textures.metallicRoughness) {
      this.assignTextureToSlot(pbr, 'metallicRoughness', override.textures.metallicRoughness.dataUrl, override.textures.metallicRoughness.uScale, override.textures.metallicRoughness.vScale);
    }
    if (override.textures.emissive) {
      this.assignTextureToSlot(pbr, 'emissive', override.textures.emissive.dataUrl, override.textures.emissive.uScale, override.textures.emissive.vScale);
    }
    if (override.textures.ambient) {
      this.assignTextureToSlot(pbr, 'ambient', override.textures.ambient.dataUrl, override.textures.ambient.uScale, override.textures.ambient.vScale);
    }
  }

  /**
   * Assigns a texture data URL / blob to a material slot
   */
  assignTextureToSlot(
    pbr: PBRMaterial,
    slot: 'albedo' | 'bump' | 'metallicRoughness' | 'emissive' | 'ambient',
    textureUrl: string,
    uScale = 1,
    vScale = 1
  ): Texture {
    const tex = new Texture(textureUrl, this.scene, false, false);
    tex.uScale = uScale;
    tex.vScale = vScale;

    switch (slot) {
      case 'albedo':
        if (pbr.albedoTexture) pbr.albedoTexture.dispose();
        pbr.albedoTexture = tex;
        break;
      case 'bump':
        if (pbr.bumpTexture) pbr.bumpTexture.dispose();
        pbr.bumpTexture = tex;
        break;
      case 'metallicRoughness':
        if (pbr.metallicTexture) pbr.metallicTexture.dispose();
        pbr.metallicTexture = tex;
        pbr.useRoughnessFromMetallicTextureAlpha = false;
        pbr.useRoughnessFromMetallicTextureGreen = true;
        pbr.useMetallnessFromMetallicTextureBlue = true;
        break;
      case 'emissive':
        if (pbr.emissiveTexture) pbr.emissiveTexture.dispose();
        pbr.emissiveTexture = tex;
        break;
      case 'ambient':
        if (pbr.ambientTexture) pbr.ambientTexture.dispose();
        pbr.ambientTexture = tex;
        break;
    }

    return tex;
  }

  /**
   * Resets a material to its Blender exported settings
   */
  resetMaterialToBlender(name: string) {
    const pbr = this.activeMaterials.get(name);
    const orig = this.originalBlenderSettings.get(name);
    if (!pbr || !orig) return;

    pbr.albedoColor = orig.albedoColor.clone();
    pbr.roughness = orig.roughness;
    pbr.metallic = orig.metallic;
    pbr.emissiveColor = orig.emissiveColor.clone();
    pbr.alpha = orig.alpha;
    pbr.clearCoat.isEnabled = false;

    appState.clearMaterialOverride(name);
  }

  /**
   * Resets all materials to their original Blender export state
   */
  resetAllMaterialsToBlender() {
    this.activeMaterials.forEach((_, name) => {
      this.resetMaterialToBlender(name);
    });
    appState.clearAllMaterialOverrides();
  }

  getActiveMaterials(): Map<string, PBRMaterial> {
    return this.activeMaterials;
  }

  getMaterial(name: string): PBRMaterial | undefined {
    return this.activeMaterials.get(name);
  }

  /**
   * Helper to convert File to object URL and register texture
   */
  async setTextureFromFile(
    materialName: string,
    slot: 'albedo' | 'bump' | 'metallicRoughness' | 'emissive' | 'ambient',
    file: File
  ): Promise<void> {
    const pbr = this.activeMaterials.get(materialName);
    if (!pbr) return;

    const dataUrl = await this.fileToDataUrl(file);
    this.assignTextureToSlot(pbr, slot, dataUrl);

    // Save in appState
    const currentOverride = appState.getMaterialOverride(materialName) || {
      materialName,
      textures: {}
    };

    const textureData: TextureData = {
      name: file.name,
      dataUrl
    };

    const textures = { ...currentOverride.textures, [slot]: textureData };
    appState.setMaterialOverride(materialName, { textures });
  }

  /**
   * Removes texture from slot
   */
  clearTextureSlot(materialName: string, slot: 'albedo' | 'bump' | 'metallicRoughness' | 'emissive' | 'ambient') {
    const pbr = this.activeMaterials.get(materialName);
    if (!pbr) return;

    switch (slot) {
      case 'albedo':
        if (pbr.albedoTexture) pbr.albedoTexture.dispose();
        pbr.albedoTexture = null;
        break;
      case 'bump':
        if (pbr.bumpTexture) pbr.bumpTexture.dispose();
        pbr.bumpTexture = null;
        break;
      case 'metallicRoughness':
        if (pbr.metallicTexture) pbr.metallicTexture.dispose();
        pbr.metallicTexture = null;
        break;
      case 'emissive':
        if (pbr.emissiveTexture) pbr.emissiveTexture.dispose();
        pbr.emissiveTexture = null;
        break;
      case 'ambient':
        if (pbr.ambientTexture) pbr.ambientTexture.dispose();
        pbr.ambientTexture = null;
        break;
    }

    const currentOverride = appState.getMaterialOverride(materialName);
    if (currentOverride && currentOverride.textures) {
      delete (currentOverride.textures as any)[slot];
      appState.setMaterialOverride(materialName, currentOverride);
    }
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
