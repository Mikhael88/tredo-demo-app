import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  Color3,
  Color4,
  CubeTexture,
  HDRCubeTexture,
  SceneLoader,
  AbstractMesh,
  TransformNode,
  ImageProcessingConfiguration,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  Tools
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import '@babylonjs/inspector';
import { appState } from './state';
import { MaterialManager } from './materialManager';

export class SceneManager {
  canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  materialManager: MaterialManager;
  modelRoot: TransformNode | null = null;
  environmentHelper: any = null;

  // Stored camera position for hot swap
  private cachedCameraState: { alpha: number; beta: number; radius: number; target: Vector3 } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true
    });

    this.scene = new Scene(this.engine);
    this.materialManager = new MaterialManager(this.scene);

    this.initCamera();
    this.initEnvironment();
    this.initImageProcessing();
    this.initDefaultDemoModel();

    // Start render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    // Window resize handling
    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  private initCamera() {
    this.camera = new ArcRotateCamera(
      'MainCamera',
      Tools.ToRadians(45),
      Tools.ToRadians(65),
      3.0,
      new Vector3(0, 0.5, 0),
      this.scene
    );

    this.camera.attachControl(this.canvas, true);
    this.camera.wheelPrecision = 40;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 200;
    this.camera.lowerRadiusLimit = 0.2;
    this.camera.upperRadiusLimit = 50;
    this.camera.useAutoRotationBehavior = appState.sceneSettings.autoRotate;

    if (this.camera.autoRotationBehavior) {
      this.camera.autoRotationBehavior.idleRotationSpeed = 0.05;
      this.camera.autoRotationBehavior.idleRotationWaitTime = 1000;
    }
  }

  private initEnvironment() {
    // Default studio environment with soft shadows and neutral ground
    this.environmentHelper = this.scene.createDefaultEnvironment({
      createSkybox: true,
      skyboxSize: 80,
      skyboxColor: Color3.FromHexString(appState.sceneSettings.bgColor),
      createGround: appState.sceneSettings.groundEnabled,
      groundSize: 30,
      groundColor: Color3.FromHexString('#14171d'),
      enableGroundShadow: appState.sceneSettings.groundShadows,
      groundShadowLevel: 0.5
    });
    if (this.environmentHelper) {
      this.environmentHelper.skyboxBlur = appState.sceneSettings.bgBlur;
    }

    this.scene.clearColor = Color4.FromHexString(appState.sceneSettings.bgColor + 'ff');
    this.updateEnvironmentPreset(appState.sceneSettings.environmentPreset);
  }

  initImageProcessing() {
    const ipc = this.scene.imageProcessingConfiguration;
    ipc.isEnabled = true;

    // Apply stored tone mapping
    this.applyToneMapping(appState.sceneSettings.toneMappingType);

    ipc.exposure = appState.sceneSettings.exposure;
    ipc.contrast = appState.sceneSettings.contrast;

    if (appState.sceneSettings.vignetteEnabled) {
      ipc.vignetteEnabled = true;
      ipc.vignetteWeight = appState.sceneSettings.vignetteWeight;
      ipc.vignetteStretch = 0.5;
    } else {
      ipc.vignetteEnabled = false;
    }
  }

  applyToneMapping(type: number) {
    const ipc = this.scene.imageProcessingConfiguration;
    if (type === -1) {
      ipc.toneMappingEnabled = false;
    } else {
      ipc.toneMappingEnabled = true;
      ipc.toneMappingType = type;
    }
    appState.sceneSettings.toneMappingType = type;
    appState.saveToStorage();
  }

  setExposure(val: number) {
    this.scene.imageProcessingConfiguration.exposure = val;
    appState.sceneSettings.exposure = val;
    appState.saveToStorage();
  }

  setContrast(val: number) {
    this.scene.imageProcessingConfiguration.contrast = val;
    appState.sceneSettings.contrast = val;
    appState.saveToStorage();
  }

  setVignette(enabled: boolean, weight = 1.5) {
    const ipc = this.scene.imageProcessingConfiguration;
    ipc.vignetteEnabled = enabled;
    ipc.vignetteWeight = weight;
    appState.sceneSettings.vignetteEnabled = enabled;
    appState.sceneSettings.vignetteWeight = weight;
    appState.saveToStorage();
  }

  setEnvironmentIntensity(intensity: number) {
    this.scene.environmentIntensity = intensity;
    appState.sceneSettings.environmentIntensity = intensity;
    appState.saveToStorage();
  }

  setEnvironmentRotation(rotationDeg: number) {
    if (this.scene.environmentTexture) {
      (this.scene.environmentTexture as any).rotationY = Tools.ToRadians(rotationDeg);
    }
    appState.sceneSettings.environmentRotation = rotationDeg;
    appState.saveToStorage();
  }

  setBackgroundColor(hex: string) {
    this.scene.clearColor = Color4.FromHexString(hex + 'ff');
    if (this.environmentHelper && this.environmentHelper.skyboxMaterial) {
      this.environmentHelper.skyboxMaterial.diffuseColor = Color3.FromHexString(hex);
    }
    appState.sceneSettings.bgColor = hex;
    appState.saveToStorage();
  }

  setGroundEnabled(enabled: boolean) {
    if (this.environmentHelper && this.environmentHelper.ground) {
      this.environmentHelper.ground.setEnabled(enabled);
    }
    appState.sceneSettings.groundEnabled = enabled;
    appState.saveToStorage();
  }

  setAutoRotate(enabled: boolean) {
    this.camera.useAutoRotationBehavior = enabled;
    appState.sceneSettings.autoRotate = enabled;
    appState.saveToStorage();
  }

  updateEnvironmentPreset(presetName: string) {
    appState.sceneSettings.environmentPreset = presetName;

    // Default Babylon sample environment
    let envUrl = 'https://assets.babylonjs.com/environments/environmentSpecular.env';

    if (presetName === 'studio') {
      envUrl = 'https://assets.babylonjs.com/environments/studio.env';
    } else if (presetName === 'warm') {
      envUrl = 'https://assets.babylonjs.com/environments/country.env';
    } else if (presetName === 'neutral') {
      envUrl = 'https://assets.babylonjs.com/environments/environmentSpecular.env';
    }

    try {
      const newEnv = CubeTexture.CreateFromPrefilteredData(envUrl, this.scene);
      newEnv.rotationY = Tools.ToRadians(appState.sceneSettings.environmentRotation);
      this.scene.environmentTexture = newEnv;
    } catch (e) {
      console.warn('Failed to load environment preset, using default specular:', e);
    }
    appState.saveToStorage();
  }

  /**
   * Load custom HDR or .ENV environment map directly from File
   */
  async loadCustomEnvironment(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const blobUrl = URL.createObjectURL(file);

    try {
      let customTex: any;
      if (ext === 'hdr') {
        customTex = new HDRCubeTexture(blobUrl, this.scene, 512, false, true, false, true);
      } else {
        customTex = CubeTexture.CreateFromPrefilteredData(blobUrl, this.scene, false, false);
      }
      customTex.rotationY = Tools.ToRadians(appState.sceneSettings.environmentRotation);
      this.scene.environmentTexture = customTex;
      appState.sceneSettings.environmentPreset = 'custom (' + file.name + ')';
      appState.saveToStorage();
    } catch (err) {
      console.error('Error loading custom environment texture:', err);
      throw err;
    }
  }

  /**
   * Main GLB Model Loading / Hot-Swapping method
   */
  async loadModelFile(file: File): Promise<{
    meshCount: number;
    vertexCount: number;
    materialsRestoredCount: number;
    materialNames: string[];
  }> {
    const fileName = file.name;

    // 1. If keepCameraOnReload is enabled, remember current view angle
    if (appState.sceneSettings.keepCameraOnReload && this.camera) {
      this.cachedCameraState = {
        alpha: this.camera.alpha,
        beta: this.camera.beta,
        radius: this.camera.radius,
        target: this.camera.target.clone()
      };
    }

    // 2. Remove previously loaded model
    if (this.modelRoot) {
      this.modelRoot.dispose(false, true);
      this.modelRoot = null;
    }

    // 3. Load the new GLB/GLTF
    const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene);
    this.modelRoot = new TransformNode('ImportedModelRoot', this.scene);

    const loadedMeshes = result.meshes;
    for (const mesh of loadedMeshes) {
      if (!mesh.parent) {
        mesh.parent = this.modelRoot;
      }
      mesh.receiveShadows = true;
    }

    // 4. Register materials and hot-swap overrides
    this.materialManager.registerModelMaterials(loadedMeshes);

    let materialsRestoredCount = 0;
    const activeMats = this.materialManager.getActiveMaterials();
    const materialNames: string[] = [];

    activeMats.forEach((_, name) => {
      materialNames.push(name);
      if (appState.sceneSettings.keepMaterialsOnReload && appState.getMaterialOverride(name)) {
        materialsRestoredCount++;
      }
    });

    // 5. Update polycount and mesh stats
    let totalVerts = 0;
    let totalMeshes = 0;
    for (const mesh of loadedMeshes) {
      if (mesh.getTotalVertices) {
        totalVerts += mesh.getTotalVertices();
      }
      if (mesh.geometry) totalMeshes++;
    }

    appState.loadedModelName = fileName;
    appState.meshCount = totalMeshes;
    appState.vertexCount = totalVerts;

    // 6. Camera handling
    if (appState.sceneSettings.keepCameraOnReload && this.cachedCameraState) {
      // Restore camera framing
      this.camera.alpha = this.cachedCameraState.alpha;
      this.camera.beta = this.cachedCameraState.beta;
      this.camera.radius = this.cachedCameraState.radius;
      this.camera.setTarget(this.cachedCameraState.target);
    } else {
      // Frame the newly loaded object
      this.frameModel();
    }

    return {
      meshCount: totalMeshes,
      vertexCount: totalVerts,
      materialsRestoredCount,
      materialNames
    };
  }

  /**
   * Re-centers and frames camera around the current model
   */
  frameModel() {
    if (!this.modelRoot) return;

    const meshes = this.modelRoot.getChildMeshes();
    if (meshes.length === 0) return;

    let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    for (const m of meshes) {
      if (!m.isVisible || !m.isEnabled()) continue;
      const boundingInfo = m.getBoundingInfo();
      min = Vector3.Minimize(min, boundingInfo.boundingBox.minimumWorld);
      max = Vector3.Maximize(max, boundingInfo.boundingBox.maximumWorld);
    }

    const center = Vector3.Center(min, max);
    const distance = Vector3.Distance(min, max);

    this.camera.setTarget(center);
    this.camera.radius = Math.max(distance * 1.4, 0.5);
  }

  setCameraView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'isometric') {
    switch (view) {
      case 'front':
        this.camera.alpha = Tools.ToRadians(270);
        this.camera.beta = Tools.ToRadians(90);
        break;
      case 'back':
        this.camera.alpha = Tools.ToRadians(90);
        this.camera.beta = Tools.ToRadians(90);
        break;
      case 'left':
        this.camera.alpha = Tools.ToRadians(180);
        this.camera.beta = Tools.ToRadians(90);
        break;
      case 'right':
        this.camera.alpha = Tools.ToRadians(0);
        this.camera.beta = Tools.ToRadians(90);
        break;
      case 'top':
        this.camera.alpha = Tools.ToRadians(270);
        this.camera.beta = Tools.ToRadians(0.01); // Avoid exact 0 singularity
        break;
      case 'isometric':
        this.camera.alpha = Tools.ToRadians(45);
        this.camera.beta = Tools.ToRadians(60);
        break;
    }
  }

  toggleInspector() {
    if (this.scene.debugLayer.isVisible()) {
      this.scene.debugLayer.hide();
    } else {
      this.scene.debugLayer.show({
        embedMode: true,
        overlay: true
      });
    }
  }

  /**
   * Creates a sample product (sleek modern thermos / coffee flask with 3 distinct materials)
   * so the scene is not blank before the first GLB is dropped!
   */
  private initDefaultDemoModel() {
    this.modelRoot = new TransformNode('DemoProductRoot', this.scene);

    // Body (Mat: Paint_Glossy)
    const body = MeshBuilder.CreateCylinder('Flask_Body', { height: 1.6, diameter: 0.7, tessellation: 64 }, this.scene);
    body.position.y = 0.8;
    body.parent = this.modelRoot;

    const bodyMat = new PBRMaterial('Paint_Glossy', this.scene);
    bodyMat.albedoColor = Color3.FromHexString('#d93829'); // Vibrant terracotta / red
    bodyMat.roughness = 0.25;
    bodyMat.metallic = 0.05;
    bodyMat.clearCoat.isEnabled = true;
    bodyMat.clearCoat.intensity = 0.8;
    bodyMat.clearCoat.roughness = 0.05;
    body.material = bodyMat;

    // Cap / Ring (Mat: Metal_Brushed)
    const ring = MeshBuilder.CreateTorus('Metal_Band', { diameter: 0.72, thickness: 0.06, tessellation: 64 }, this.scene);
    ring.position.y = 1.45;
    ring.parent = this.modelRoot;

    const metalMat = new PBRMaterial('Metal_Brushed', this.scene);
    metalMat.albedoColor = Color3.FromHexString('#cccccc');
    metalMat.roughness = 0.35;
    metalMat.metallic = 0.95;
    ring.material = metalMat;

    // Lid (Mat: Rubber_Matte)
    const lid = MeshBuilder.CreateCylinder('Rubber_Lid', { height: 0.3, diameter: 0.65, tessellation: 64 }, this.scene);
    lid.position.y = 1.7;
    lid.parent = this.modelRoot;

    const rubberMat = new PBRMaterial('Rubber_Matte', this.scene);
    rubberMat.albedoColor = Color3.FromHexString('#20242a');
    rubberMat.roughness = 0.85;
    rubberMat.metallic = 0.0;
    lid.material = rubberMat;

    // Register demo materials
    this.materialManager.registerModelMaterials(this.modelRoot.getChildMeshes());

    appState.loadedModelName = 'Demo_Product.glb (Trascina il tuo GLB qui)';
    appState.meshCount = 3;
    appState.vertexCount = body.getTotalVertices() + ring.getTotalVertices() + lid.getTotalVertices();

    this.frameModel();
  }
}
