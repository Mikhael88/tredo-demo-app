import { convertExrToHdrBlob } from './exrConverter';
import {
  decodeHdr,
  convertHdrToCubemapCross,
  isCubemapCross,
  convertCubemapCrossToEquirectangularBlob,
  downloadBlob,
  type CubemapCrossResult
} from './hdriToCubeMap';

// Declare BABYLON global from CDN scripts
declare const BABYLON: any;

interface MaterialCustomization {
  albedoColor?: any;
  roughness?: number;
  metallic?: number;
  emissiveColor?: any;
  emissiveIntensity?: number;
  alpha?: number;
  transparencyMode?: number;
  backFaceCulling?: boolean;
  clearCoatEnabled?: boolean;
  clearCoatIntensity?: number;
  clearCoatRoughness?: number;
  albedoTexture?: any;
  bumpTexture?: any;
  metallicTexture?: any;
  emissiveTexture?: any;
  ambientTexture?: any;
}

class BabylonHotSwapSandbox {
  private canvas: HTMLCanvasElement;
  private engine: any;
  private scene: any;
  private camera: any;
  private environmentHelper: any;
  private currentCustomEnvTexture: any = null;
  private modelRoot: any = null;
  private highlightLayer: any = null;

  // HDRI-to-CubeMap state
  private lastCubemapResult: CubemapCrossResult | null = null;
  private isConvertingCubemap = false;
  private cubemapStatusInfo: HTMLElement | null = null;
  private cubemapStatusText: HTMLElement | null = null;
  private btnDownloadCubemapHdr: HTMLElement | null = null;

  // Selected mesh and material
  private selectedMesh: any = null;
  private selectedMaterial: any = null;

  // Original Blender properties cache (for reset)
  private blenderOriginals: Map<string, any> = new Map();

  // Original bump map levels cache for softening
  private originalBumpLevels: Map<string, number> = new Map();

  // Persistence Registry: Material Name -> Customization
  private materialOverrides: Map<string, MaterialCustomization> = new Map();

  // Cached camera state for hot swap
  private cachedCamera: { alpha: number; beta: number; radius: number; target: any } | null = null;
  private defaultCameraState: { alpha: number; beta: number; radius: number; target: any } | null = null;

  // Anti-Aliasing & Rendering Pipeline
  private defaultPipeline: any = null;
  private fxaaPostProcess: any = null;
  private aaSettings = {
    ssaaLevel: 0.67, // 1.5x SSAA default for super crisp edges
    fxaaEnabled: false,
    msaaSamples: 4,
    specularAa: true,
    anisotropicLevel: 16,
    samplingMode: 'trilinear',
    normalSoftening: 0.0
  };

  // Environment settings
  private envSettings = {
    rotationDeg: 0,
    intensity: 1.0,
    showSkybox: true,
    skyboxBlur: 0.3
  };

  // Studio Lighting (RectAreaLight & Directional)
  private rectLightNode: any = null;
  private rectLight: any = null;
  private rectLightMesh: any = null;
  private dirLight: any = null;
  private shadowGenerator: any = null;
  private areaLightTextureProcessor: any = null;

  private studioLightSettings = {
    rectEnabled: true,
    rectWidth: 1.5,
    rectHeight: 1.5,
    rectIntensity: 3.0,
    rectColor: '#ffffff',
    rectPreset: 'key_right',
    rectDistance: 3.2,
    rectHeightPos: 2.2,
    rectAngleDeg: 45,
    showLightGizmo: true,
    dirEnabled: false,
    dirIntensity: 1.5,
    dirColor: '#ffffff',
    castShadows: false
  };

  // Lookdev Calibration Spheres
  private lookdevRoot: any = null;
  private lookdevSpheres: { matte?: any; gray?: any; chrome?: any } = {};

  // Screen Space Reflections (SSR) Pipeline
  private ssrPipeline: any = null;

  // Ambient Occlusion (SSAO) Pipeline
  private ssaoPipeline: any = null;
  private isSsaoAttached: boolean = false;
  private ssaoSettings = {
    enabled: true,
    totalStrength: 1.4,
    radius: 0.8,
    samples: 16,
    base: 0.0,
    maxZ: 100,
    expensiveBlur: true,
    bilateralSoften: 0.0,
    ratio: 0.75
  };

  // DOM Elements
  private appLayout: HTMLElement;
  private centerDropzone: HTMLElement;
  private modelTitle: HTMLElement;
  private statMeshes: HTMLElement;
  private statVerts: HTMLElement;
  private footerFileName: HTMLElement;
  private dropOverlay: HTMLElement;
  private toastContainer: HTMLElement;
  private textureAssignModal: HTMLDialogElement;

  private pendingTextureDrop: { file: File; materialName: string; meshName: string } | null = null;
  private isDropBusy: boolean = false;
  private isLoadingModel: boolean = false;

  constructor() {
    this.appLayout = document.getElementById('appLayout') as HTMLElement;
    this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    this.centerDropzone = document.getElementById('centerDropzone') as HTMLElement;
    this.modelTitle = document.getElementById('modelTitle') as HTMLElement;
    this.statMeshes = document.getElementById('statMeshes') as HTMLElement;
    this.statVerts = document.getElementById('statVerts') as HTMLElement;
    this.footerFileName = document.getElementById('footerFileName') as HTMLElement;
    this.dropOverlay = document.getElementById('dropOverlay') as HTMLElement;
    this.toastContainer = document.getElementById('toastContainer') as HTMLElement;
    this.textureAssignModal = document.getElementById('textureAssignModal') as HTMLDialogElement;

    this.initBabylon();
    this.initAntiAliasing();
    this.initSSR();
    this.initSSAO();
    this.initStudioLighting();
    this.initLookdevSpheres();
    this.initUI();
    this.initPointerSelection();
    this.initDragAndDrop();
    this.loadCachedOverrides();
  }

  private initBabylon() {
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance'
    });

    // Default Super-Sampling (1.5x) for crisp edges
    this.engine.setHardwareScalingLevel(this.aaSettings.ssaaLevel);

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.97, 0.98, 0.99, 1.0); // Light SaaS background

    // ArcRotate Camera with damped inertia and stable panning
    this.camera = new BABYLON.ArcRotateCamera(
      'SandboxCamera',
      BABYLON.Tools.ToRadians(70.53),
      BABYLON.Tools.ToRadians(65.0),
      2.5,
      new BABYLON.Vector3(0, 0.5, 0),
      this.scene
    );
    this.camera.attachControl(this.canvas, true);

    // Fluid, responsive ArcRotate Camera configuration
    this.camera.inertia = 0.75;
    this.camera.panningSensibility = 600;
    this.camera.wheelDeltaPercentage = 0.05; // Proportional smooth zoom
    this.camera.angularSensibilityX = 1400; // Agile, fluid orbiting
    this.camera.angularSensibilityY = 1400;
    this.camera.lowerRadiusLimit = 0.04;
    this.camera.minZ = 0.01;
    this.camera.maxZ = 1000;

    // Eliminate target displacement bug on wheel zoom
    if (this.camera.inputs && this.camera.inputs.attached && this.camera.inputs.attached.mousewheel) {
      this.camera.inputs.attached.mousewheel.zoomToMouseLocation = false;
    }

    // Dynamic distance-aware panning
    this.scene.onBeforeRenderObservable.add(() => {
      const r = Math.max(0.02, this.camera.radius);
      this.camera.panningSensibility = Math.max(180, 800 / r);
    });

    // Highlight Layer for mesh selection (Sky Blue #38bdf8 outline)
    this.highlightLayer = new BABYLON.HighlightLayer('selectionHighlight', this.scene);
    this.highlightLayer.innerGlow = false;
    this.highlightLayer.outerGlow = true;
    this.highlightLayer.blurHorizontalSize = 0.6;
    this.highlightLayer.blurVerticalSize = 0.6;

    // Default Environment
    this.environmentHelper = this.scene.createDefaultEnvironment({
      createSkybox: true,
      skyboxSize: 80,
      skyboxColor: new BABYLON.Color3(0.94, 0.95, 0.97),
      createGround: true,
      groundSize: 30,
      groundColor: new BABYLON.Color3(0.92, 0.93, 0.96),
      enableGroundShadow: true,
      groundShadowLevel: 0.3
    });

    if (this.environmentHelper && this.environmentHelper.skyboxMaterial) {
      this.environmentHelper.skyboxBlur = this.envSettings.skyboxBlur;
      this.environmentHelper.skyboxMaterial.microSurface = 1.0 - this.envSettings.skyboxBlur;
    }

    // Default Studio HDRI
    try {
      this.scene.environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(
        'https://assets.babylonjs.com/environments/studio.env',
        this.scene
      );
    } catch (e) {
      console.warn('Failed to load studio.env:', e);
    }

    // Default Tone Mapping: Khronos PBR Neutral (Blender / glTF Standard)
    const ipc = this.scene.imageProcessingConfiguration;
    ipc.isEnabled = true;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = 2; // Khronos PBR Neutral
    ipc.exposure = 1.0;
    ipc.contrast = 1.0;

    // Engine Render Loop & Resize
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });

    // Initial default camera state
    this.defaultCameraState = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone()
    };
  }

  /**
   * Initializes Anti-Aliasing pipeline:
   * Edge AA (Hardware Super-Sampling SSAA, FXAA post-process, MSAA samples)
   * Texture AA (Toksvig Specular Anti-Aliasing, 16x Anisotropic filtering, Trilinear sampling)
   */
  private initAntiAliasing() {
    try {
      this.defaultPipeline = new BABYLON.DefaultRenderingPipeline(
        'defaultPipeline',
        true, // HDR
        this.scene,
        [this.camera]
      );
      this.defaultPipeline.samples = this.aaSettings.msaaSamples;
      this.defaultPipeline.fxaaEnabled = this.aaSettings.fxaaEnabled;
      
      // Image Processing & Tone Mapping in pipeline
      this.defaultPipeline.imageProcessingEnabled = true;
      this.defaultPipeline.imageProcessingConfiguration = this.scene.imageProcessingConfiguration;
      if (this.defaultPipeline.imageProcessing) {
        this.defaultPipeline.imageProcessing.toneMappingEnabled = true;
        this.defaultPipeline.imageProcessing.toneMappingType = 2; // Khronos PBR Neutral
        this.defaultPipeline.imageProcessing.exposure = 1.0;
        this.defaultPipeline.imageProcessing.contrast = 1.0;
      }
    } catch (e) {
      console.warn('DefaultRenderingPipeline error:', e);
    }
  }

  /**
   * Screen Space Reflections (SSR) Pipeline
   */
  private initSSR() {
    try {
      if (!this.engine.webGLVersion || this.engine.webGLVersion < 2) {
        console.warn('SSR requires WebGL 2.0');
        return;
      }
      this.ssrPipeline = new BABYLON.SSRRenderingPipeline(
        'ssr',
        this.scene,
        [this.camera],
        false,
        BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE
      );
      this.ssrPipeline.environmentTexture = this.scene.environmentTexture;
      this.ssrPipeline.strength = 1.0;
      this.ssrPipeline.blurDispersionStrength = 0.12; // Generous soft reflection blur
      this.ssrPipeline.roughnessFactor = 0.35; // Substantial roughness cone
      this.ssrPipeline.reflectionSpecularFalloffExponent = 2.0; // Soft specular falloff
      this.ssrPipeline.useFresnel = true; // Fresnel attenuation prevents "tutto lucido"
      this.ssrPipeline.reflectivityThreshold = 0.02;
      this.ssrPipeline.step = 1;
      this.ssrPipeline.thickness = 0.5;
      this.ssrPipeline.maxDistance = 1000;
      this.ssrPipeline.enableSmoothReflections = true;
      this.ssrPipeline.debug = false;
      this.ssrPipeline.isEnabled = false;
    } catch (e) {
      console.warn('SSRRenderingPipeline initialization warning:', e);
    }
  }

  /**
   * Ambient Occlusion (SSAO2) Pipeline:
   * Generates real-time contact shadows and self-shadowing between model components,
   * crevices, folds, and overlaps with high-fidelity bilateral filtering.
   */
  private initSSAO() {
    try {
      if (!this.engine.webGLVersion || this.engine.webGLVersion < 2) {
        console.warn('SSAO2 requires WebGL 2.0');
        return;
      }

      this.ssaoPipeline = new BABYLON.SSAO2RenderingPipeline(
        'ssao',
        this.scene,
        {
          ssaoRatio: this.ssaoSettings.ratio,
          blurRatio: this.ssaoSettings.ratio
        },
        [this.camera]
      );

      this.isSsaoAttached = true;
      this.applySsaoParameters();

      if (!this.ssaoSettings.enabled) {
        this.setSsaoEnabled(false);
      }
    } catch (e) {
      console.warn('SSAO2RenderingPipeline initialization warning:', e);
    }
  }

  private applySsaoParameters() {
    if (!this.ssaoPipeline) return;
    this.ssaoPipeline.totalStrength = this.ssaoSettings.totalStrength;
    this.ssaoPipeline.radius = this.ssaoSettings.radius;
    this.ssaoPipeline.samples = this.ssaoSettings.samples;
    this.ssaoPipeline.base = this.ssaoSettings.base;
    this.ssaoPipeline.maxZ = this.ssaoSettings.maxZ;
    this.ssaoPipeline.expensiveBlur = this.ssaoSettings.expensiveBlur;
    this.ssaoPipeline.bilateralSoften = this.ssaoSettings.bilateralSoften;
  }

  public setSsaoEnabled(enabled: boolean) {
    this.ssaoSettings.enabled = enabled;
    if (!this.ssaoPipeline) {
      if (enabled) {
        this.initSSAO();
      }
      return;
    }

    try {
      if (enabled && !this.isSsaoAttached) {
        this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', this.camera);
        this.isSsaoAttached = true;
      } else if (!enabled && this.isSsaoAttached) {
        this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('ssao', this.camera);
        this.isSsaoAttached = false;
      }
    } catch (e) {
      console.warn('Error toggling SSAO camera attachment:', e);
    }

    const eyeBtn = document.getElementById('btnToggleSsaoEye');
    if (eyeBtn) {
      eyeBtn.classList.toggle('off', !enabled);
      eyeBtn.textContent = enabled ? '👁️' : '🙈';
    }

    const chk = document.getElementById('chkEnableSsao') as HTMLInputElement;
    if (chk && chk.checked !== enabled) {
      chk.checked = enabled;
    }
  }

  private rebuildSsaoPipeline() {
    try {
      if (this.ssaoPipeline) {
        if (this.isSsaoAttached) {
          this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('ssao', this.camera);
          this.isSsaoAttached = false;
        }
        this.ssaoPipeline.dispose();
        this.ssaoPipeline = null;
      }
      this.initSSAO();
    } catch (e) {
      console.warn('Error rebuilding SSAO pipeline:', e);
    }
  }

  /**
   * Studio Lighting System:
   * RectAreaLight (Softbox HDR) & Directional Light
   */
  private initStudioLighting() {
    this.rectLightNode = new BABYLON.TransformNode('StudioLightPivot', this.scene);

    try {
      this.rectLight = new BABYLON.RectAreaLight(
        'StudioRectLight',
        new BABYLON.Vector3(0, 0, 0),
        this.studioLightSettings.rectWidth,
        this.studioLightSettings.rectHeight,
        this.scene
      );
      this.rectLight.parent = this.rectLightNode;
      this.rectLight.rotation = new BABYLON.Vector3(0, Math.PI, 0);
      this.rectLight.intensity = this.studioLightSettings.rectIntensity;
      this.rectLight.diffuse = BABYLON.Color3.FromHexString(this.studioLightSettings.rectColor);
      this.rectLight.setEnabled(this.studioLightSettings.rectEnabled);
    } catch (e) {
      console.warn('RectAreaLight error:', e);
    }

    try {
      this.rectLightMesh = BABYLON.MeshBuilder.CreatePlane('softboxVisualMesh', {
        width: this.studioLightSettings.rectWidth,
        height: this.studioLightSettings.rectHeight,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
      }, this.scene);
      this.rectLightMesh.parent = this.rectLightNode;
      this.rectLightMesh.position = new BABYLON.Vector3(0, 0, 0);
      const softboxMat = new BABYLON.PBRMaterial('softboxMat', this.scene);
      softboxMat.albedoColor = new BABYLON.Color3(0.05, 0.05, 0.05);
      softboxMat.emissiveColor = BABYLON.Color3.FromHexString(this.studioLightSettings.rectColor);
      softboxMat.emissiveIntensity = 2.0;
      softboxMat.roughness = 0.9;
      softboxMat.backFaceCulling = false;
      this.rectLightMesh.material = softboxMat;
      this.rectLightMesh.isPickable = false;
      this.rectLightMesh.setEnabled(this.studioLightSettings.showLightGizmo && this.studioLightSettings.rectEnabled);
    } catch (e) {
      console.warn('Softbox mesh error:', e);
    }

    try {
      this.dirLight = new BABYLON.DirectionalLight(
        'StudioDirLight',
        new BABYLON.Vector3(-0.6, -1.2, -0.6).normalize(),
        this.scene
      );
      this.dirLight.intensity = this.studioLightSettings.dirIntensity;
      this.dirLight.diffuse = BABYLON.Color3.FromHexString(this.studioLightSettings.dirColor);
      this.dirLight.setEnabled(this.studioLightSettings.dirEnabled);
    } catch (e) {
      console.warn('DirectionalLight error:', e);
    }

    this.updateRectLightTransform();
  }

  /**
   * Lookdev Calibration Spheres:
   * 1. Matte Black (albedo 0.04, roughness 0.85)
   * 2. Neutral Gray 18% (albedo 0.75, roughness 0.70)
   * 3. Chrome Mirror (albedo 1.0, metallic 1.0, roughness 0.0)
   */
  private initLookdevSpheres() {
    this.lookdevRoot = new BABYLON.TransformNode('LookdevRoot', this.scene);
    this.lookdevRoot.position.set(0, 0.05, 0);

    const radius = 0.12;

    // 1. Matte Black
    const matteSphere = BABYLON.MeshBuilder.CreateSphere('sphere_matte_black', { diameter: radius * 2, segments: 32 }, this.scene);
    matteSphere.position.set(-0.35, radius, 0);
    matteSphere.parent = this.lookdevRoot;
    const matBlack = new BABYLON.PBRMaterial('mat_lookdev_black', this.scene);
    matBlack.albedoColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    matBlack.roughness = 0.85;
    matBlack.metallic = 0.0;
    matteSphere.material = matBlack;
    this.lookdevSpheres.matte = matteSphere;

    // 2. Neutral Gray 18%
    const graySphere = BABYLON.MeshBuilder.CreateSphere('sphere_gray_18', { diameter: radius * 2, segments: 32 }, this.scene);
    graySphere.position.set(0, radius, 0);
    graySphere.parent = this.lookdevRoot;
    const matGray = new BABYLON.PBRMaterial('mat_lookdev_gray', this.scene);
    matGray.albedoColor = new BABYLON.Color3(0.75, 0.75, 0.75); // Perceived 18% reflectance in sRGB
    matGray.roughness = 0.70;
    matGray.metallic = 0.0;
    graySphere.material = matGray;
    this.lookdevSpheres.gray = graySphere;

    // 3. Chrome Mirror
    const chromeSphere = BABYLON.MeshBuilder.CreateSphere('sphere_chrome', { diameter: radius * 2, segments: 32 }, this.scene);
    chromeSphere.position.set(0.35, radius, 0);
    chromeSphere.parent = this.lookdevRoot;
    const matChrome = new BABYLON.PBRMaterial('mat_lookdev_chrome', this.scene);
    matChrome.albedoColor = new BABYLON.Color3(1.0, 1.0, 1.0);
    matChrome.metallic = 1.0;
    matChrome.roughness = 0.0;
    chromeSphere.material = matChrome;
    this.lookdevSpheres.chrome = chromeSphere;

    // Initially hidden
    this.lookdevRoot.setEnabled(false);
  }

  private initUI() {
    this.initTredoTabs();
    this.initAccordions();
    this.initInspectorAutoHide();
    this.initAntiAliasingControls();
    this.initCameraPositionControls();
    this.initEnvironmentPanelControls();
    this.initHdriToCubemapConverter();
    this.initToneMappingControls();
    this.initSsrControls();
    this.initSsaoControls();
    this.initStudioLightingControls();
    this.initMaterialPanelControls();
    this.initLookdevControls();
    this.initBackgroundControls();
    this.initThemeToggle();
    this.initQuickToolbar();
    this.initTextureAssignModal();
    this.initFileLoaderButtons();

    // Set Default Readout for Camera
    this.updateCameraReadout();
  }

  /**
   * Auto-hide custom UI when Babylon's Official Inspector opens,
   * and auto-restore custom UI when it closes!
   */
  private initInspectorAutoHide() {
    const toggleInspector = () => {
      if (this.scene.debugLayer.isVisible()) {
        this.scene.debugLayer.hide();
      } else {
        this.scene.debugLayer.show({
          overlay: true,
          showExplorer: false, // Hides the left Scene Explorer column (list of objects)
          showInspector: true, // Shows only the Property Inspector (parameters) on the right
          embedMode: false,
          enablePopup: false,
          enableClose: true,
          handleResize: true
        });

        // Automatically select the active material in the official inspector if selected
        if (this.selectedMaterial) {
          setTimeout(() => {
            try {
              this.scene.debugLayer.select(this.selectedMaterial, 'MATERIALS');
            } catch (e) {
              console.warn('Could not select material in inspector:', e);
            }
          }, 200);
        }
      }
    };

    document.getElementById('btnHeaderInspector')?.addEventListener('click', toggleInspector);
    document.getElementById('btnOpenInFullInspector')?.addEventListener('click', () => {
      toggleInspector();
    });

    // Floating Return button to exit official inspector and return to TREDO Studio
    document.getElementById('btnReturnFromInspector')?.addEventListener('click', () => {
      if (this.scene.debugLayer && this.scene.debugLayer.isVisible()) {
        this.scene.debugLayer.hide();
      }
    });

    // Keyboard ESC key shortcut to return to TREDO Studio custom UI
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.scene.debugLayer && this.scene.debugLayer.isVisible()) {
        this.scene.debugLayer.hide();
      }
    });

    // Reactive monitor for debugLayer visibility state
    let wasInspectorVisible = false;
    this.scene.onBeforeRenderObservable.add(() => {
      const isVisible = !!(this.scene.debugLayer && this.scene.debugLayer.isVisible());
      if (isVisible !== wasInspectorVisible) {
        wasInspectorVisible = isVisible;
        this.appLayout.classList.toggle('inspector-active', isVisible);
        if (isVisible) {
          this.showToast('Inspector Parametri aperto (Premi ESC o "Torna a Studio" per uscire)', 'info');
        } else {
          this.showToast('Tornato a TREDO Studio (Interfaccia ripristinata)', 'info');
        }
      }
    });
  }

  /**
   * TREDO Tab Navigation (SCENA, LUCI, MODELLI, LOOKDEV)
   */
  private initTredoTabs() {
    const tabBtns = document.querySelectorAll<HTMLButtonElement>('.inspector-tabs .tab-btn');
    const tabContents = document.querySelectorAll<HTMLElement>('.tab-content');

    const switchTab = (tabId: string) => {
      tabBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabId);
      });
      tabContents.forEach(c => {
        c.classList.toggle('active', c.id === tabId);
      });
    };

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        if (targetTab) switchTab(targetTab);
      });
    });
  }

  public activateTab(tabId: 'tabScena' | 'tabLuci' | 'tabModelli' | 'tabLookdev') {
    const tabBtns = document.querySelectorAll<HTMLButtonElement>('.inspector-tabs .tab-btn');
    const tabContents = document.querySelectorAll<HTMLElement>('.tab-content');
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    tabContents.forEach(c => c.classList.toggle('active', c.id === tabId));
  }

  /**
   * Collapsible Accordion Sections
   */
  private initAccordions() {
    const headers = document.querySelectorAll('.accordion-header');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const sec = header.closest('.accordion-sec');
        if (sec) {
          sec.classList.toggle('expanded');
        }
      });
    });
  }

  /**
   * Anti-Aliasing & Visual Quality Controls:
   * SSAA, FXAA, MSAA, Specular Anti-Aliasing, Anisotropic Filtering, Sampling mode, Normal Softening
   */
  private initAntiAliasingControls() {
    // 1. Edge AA: Resolution / SSAA (Hardware Scaling)
    const selectSsaa = document.getElementById('selectSsaaResolution') as HTMLSelectElement;
    selectSsaa?.addEventListener('change', () => {
      const scale = parseFloat(selectSsaa.value);
      this.aaSettings.ssaaLevel = scale;
      this.engine.setHardwareScalingLevel(scale);
      this.engine.resize();
      this.showToast(`Risoluzione SSAA: ${selectSsaa.options[selectSsaa.selectedIndex].text}`, 'info');
    });

    // 2. Edge AA: FXAA Filter
    const chkFxaa = document.getElementById('chkEnableFxaa') as HTMLInputElement;
    chkFxaa?.addEventListener('change', () => {
      this.aaSettings.fxaaEnabled = chkFxaa.checked;
      if (this.defaultPipeline) {
        this.defaultPipeline.fxaaEnabled = chkFxaa.checked;
      }
      this.showToast(chkFxaa.checked ? 'Filtro FXAA attivato (bordi levigati)' : 'Filtro FXAA disattivato', 'info');
    });

    // 3. Edge AA: MSAA Samples
    const selectMsaa = document.getElementById('selectMsaaSamples') as HTMLSelectElement;
    selectMsaa?.addEventListener('change', () => {
      const samples = parseInt(selectMsaa.value, 10);
      this.aaSettings.msaaSamples = samples;
      if (this.defaultPipeline) {
        this.defaultPipeline.samples = samples;
      }
      this.showToast(`Campioni MSAA: ${samples}x`, 'info');
    });

    // 4. Texture AA: Specular Anti-Aliasing (Toksvig / normal variance filtering)
    const chkSpecularAa = document.getElementById('chkSpecularAa') as HTMLInputElement;
    chkSpecularAa?.addEventListener('change', () => {
      this.aaSettings.specularAa = chkSpecularAa.checked;
      this.applySpecularAaToAll(chkSpecularAa.checked);
      this.showToast(
        chkSpecularAa.checked
          ? '✨ Specular Anti-Aliasing ATTIVO (texture metalliche e riflessi levigati)'
          : 'Specular Anti-Aliasing DISATTIVATO',
        'info'
      );
    });

    // 5. Texture AA: Anisotropic Filtering
    const selectAniso = document.getElementById('selectAnisotropic') as HTMLSelectElement;
    selectAniso?.addEventListener('change', () => {
      const level = parseInt(selectAniso.value, 10);
      this.aaSettings.anisotropicLevel = level;
      this.applyAnisotropicFilteringToAll(level);
      this.showToast(`Filtro Anisotropico impostato a ${level}x`, 'info');
    });

    // 6. Texture AA: Sampling Mode
    const selectSampling = document.getElementById('selectTextureSampling') as HTMLSelectElement;
    selectSampling?.addEventListener('change', () => {
      this.aaSettings.samplingMode = selectSampling.value;
      const isTrilinear = selectSampling.value === 'trilinear';
      const mode = isTrilinear ? BABYLON.Texture.TRILINEAR_SAMPLINGMODE : BABYLON.Texture.BILINEAR_SAMPLINGMODE;
      this.applySamplingModeToAll(mode);
      this.showToast(`Campionamento texture: ${isTrilinear ? 'Trilineare (Smooth Mipmaps)' : 'Bilineare'}`, 'info');
    });

    // 7. Normal Map Softening Slider
    const sliderNormal = document.getElementById('sliderNormalSoftening') as HTMLInputElement;
    const valNormal = document.getElementById('valNormalSoftening');
    sliderNormal?.addEventListener('input', () => {
      const v = parseFloat(sliderNormal.value);
      this.aaSettings.normalSoftening = v;
      if (valNormal) valNormal.textContent = `${Math.round(v * 100)}%`;
      this.applyNormalSofteningToAll(v);
    });
  }

  private applySpecularAaToAll(enable: boolean) {
    for (const mat of this.scene.materials) {
      if (mat instanceof BABYLON.PBRMaterial) {
        mat.enableSpecularAntiAliasing = enable;
      }
    }
  }

  private applyAnisotropicFilteringToAll(level: number) {
    for (const tex of this.scene.textures) {
      if (tex && 'anisotropicFilteringLevel' in tex) {
        tex.anisotropicFilteringLevel = level;
      }
    }
  }

  private applySamplingModeToAll(mode: number) {
    for (const tex of this.scene.textures) {
      if (tex && typeof tex.updateSamplingMode === 'function') {
        tex.updateSamplingMode(mode);
      }
    }
  }

  private applyNormalSofteningToAll(softeningFactor: number) {
    // Factor 0 = original level; Factor 1 = completely flat/smooth
    const multiplier = 1.0 - softeningFactor;
    for (const mat of this.scene.materials) {
      if (mat instanceof BABYLON.PBRMaterial && mat.bumpTexture) {
        if (!this.originalBumpLevels.has(mat.name)) {
          this.originalBumpLevels.set(mat.name, mat.bumpTexture.level || 1.0);
        }
        const orig = this.originalBumpLevels.get(mat.name) || 1.0;
        mat.bumpTexture.level = orig * multiplier;
      }
    }
  }

  /**
   * Camera Position Controls & Realtime Monitor
   */
  private initCameraPositionControls() {
    const valH = document.getElementById('valCamH');
    const valV = document.getElementById('valCamV');
    const valDist = document.getElementById('valCamDist');

    // Live updater in render loop
    this.scene.onBeforeRenderObservable.add(() => {
      this.updateCameraReadout();
    });

    // Set Default Camera Position Button
    document.getElementById('btnSetDefaultCamPos')?.addEventListener('click', () => {
      this.defaultCameraState = {
        alpha: this.camera.alpha,
        beta: this.camera.beta,
        radius: this.camera.radius,
        target: this.camera.target.clone()
      };

      const degH = (((this.camera.alpha * 180 / Math.PI) % 360) + 360) % 360;
      const degV = (this.camera.beta * 180 / Math.PI);
      const dist = this.camera.radius;

      const defH = document.getElementById('defCamH');
      const defV = document.getElementById('defCamV');
      const defDist = document.getElementById('defCamDist');
      if (defH) defH.textContent = `${degH.toFixed(2)}°`;
      if (defV) defV.textContent = `${degV.toFixed(2)}°`;
      if (defDist) defDist.textContent = `${dist.toFixed(2)} m`;

      this.showToast('✅ Posizione camera impostata come default!', 'success');
    });

    // Reset Camera Button in Nodes tree
    document.getElementById('btnResetCameraView')?.addEventListener('click', () => {
      if (this.defaultCameraState) {
        this.camera.alpha = this.defaultCameraState.alpha;
        this.camera.beta = this.defaultCameraState.beta;
        this.camera.radius = this.defaultCameraState.radius;
        this.camera.setTarget(this.defaultCameraState.target.clone());
        this.showToast('Visuale camera ripristinata', 'info');
      } else {
        this.frameSelectionOrModel();
      }
    });

    // Limit Camera Movement Switch
    const chkLimitCam = document.getElementById('chkLimitCam') as HTMLInputElement;
    chkLimitCam?.addEventListener('change', () => {
      if (chkLimitCam.checked) {
        this.camera.upperBetaLimit = Math.PI / 2 - 0.05; // Prevent going below floor
        this.camera.lowerRadiusLimit = 0.2;
        this.camera.upperRadiusLimit = 15.0;
        this.showToast('Limiti di movimento camera ATTIVI', 'info');
      } else {
        this.camera.upperBetaLimit = null;
        this.camera.lowerRadiusLimit = 0.04;
        this.camera.upperRadiusLimit = null;
        this.showToast('Limiti di movimento camera disattivati', 'info');
      }
    });

    // Auto Rotate Switch
    const chkAutoRotate = document.getElementById('chkAutoRotate') as HTMLInputElement;
    chkAutoRotate?.addEventListener('change', () => {
      this.camera.useAutoRotationBehavior = chkAutoRotate.checked;
      if (chkAutoRotate.checked && this.camera.autoRotationBehavior) {
        this.camera.autoRotationBehavior.idleRotationSpeed = 0.05;
      }
      const footBtn = document.getElementById('btnFootRotate');
      footBtn?.classList.toggle('active', chkAutoRotate.checked);
    });
  }

  private updateCameraReadout() {
    const valH = document.getElementById('valCamH');
    const valV = document.getElementById('valCamV');
    const valDist = document.getElementById('valCamDist');

    if (valH && this.camera) {
      const degH = (((this.camera.alpha * 180 / Math.PI) % 360) + 360) % 360;
      valH.textContent = `${degH.toFixed(2)}°`;
    }
    if (valV && this.camera) {
      const degV = (this.camera.beta * 180 / Math.PI);
      valV.textContent = `${degV.toFixed(2)}°`;
    }
    if (valDist && this.camera) {
      valDist.textContent = `${this.camera.radius.toFixed(2)} m`;
    }
  }

  /**
   * Lookdev Controls (Sfere di calibrazione)
   */
  private initLookdevControls() {
    const chkLookdev = document.getElementById('chkLookdevSpheres') as HTMLInputElement;
    const btnQuickLookdev = document.getElementById('btnQuickLookdev');
    const btnEye = document.getElementById('btnToggleLookdevEye');

    const updateLookdevState = (active: boolean) => {
      if (this.lookdevRoot) {
        this.lookdevRoot.setEnabled(active);
      }
      if (chkLookdev) chkLookdev.checked = active;
      btnQuickLookdev?.classList.toggle('active', active);
      btnEye?.classList.toggle('inactive', !active);
      this.showToast(active ? '🔮 Sfere di calibrazione Lookdev inserite in scena' : 'Sfere Lookdev nascoste', 'info');
    };

    chkLookdev?.addEventListener('change', () => updateLookdevState(chkLookdev.checked));
    btnQuickLookdev?.addEventListener('click', () => updateLookdevState(!this.lookdevRoot.isEnabled()));
    btnEye?.addEventListener('click', () => updateLookdevState(!this.lookdevRoot.isEnabled()));

    const sliderScale = document.getElementById('sliderLookdevScale') as HTMLInputElement;
    const valScale = document.getElementById('valLookdevScale');
    sliderScale?.addEventListener('input', () => {
      const s = parseFloat(sliderScale.value);
      if (valScale) valScale.textContent = `${s.toFixed(1)}x`;
      if (this.lookdevRoot) this.lookdevRoot.scaling.set(s, s, s);
    });

    const sliderHeight = document.getElementById('sliderLookdevHeight') as HTMLInputElement;
    const valHeight = document.getElementById('valLookdevHeight');
    sliderHeight?.addEventListener('input', () => {
      const h = parseFloat(sliderHeight.value);
      if (valHeight) valHeight.textContent = `${h.toFixed(2)}m`;
      if (this.lookdevRoot) this.lookdevRoot.position.y = h;
    });
  }

  /**
   * Background Color Picker & Theme Toggle
   */
  private initBackgroundControls() {
    const inputBgColor = document.getElementById('inputBgColor') as HTMLInputElement;
    const hexBgColor = document.getElementById('hexBgColor');
    const btnResetBgColor = document.getElementById('btnResetBgColor');

    inputBgColor?.addEventListener('input', () => {
      const hex = inputBgColor.value;
      if (hexBgColor) hexBgColor.textContent = hex.toUpperCase();
      this.scene.clearColor = BABYLON.Color4.FromHexString(hex + 'ff');
      if (this.environmentHelper && this.environmentHelper.groundMaterial) {
        this.environmentHelper.groundMaterial.diffuseColor = BABYLON.Color3.FromHexString(hex);
      }
    });

    btnResetBgColor?.addEventListener('click', () => {
      const defHex = document.body.classList.contains('theme-dark') ? '#0f1117' : '#f8fafc';
      if (inputBgColor) inputBgColor.value = defHex;
      if (hexBgColor) hexBgColor.textContent = defHex.toUpperCase();
      this.scene.clearColor = BABYLON.Color4.FromHexString(defHex + 'ff');
    });
  }

  private initThemeToggle() {
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    const iconTheme = document.getElementById('iconTheme');

    btnThemeToggle?.addEventListener('click', () => {
      const isDark = document.body.classList.contains('theme-dark');
      if (isDark) {
        document.body.classList.remove('theme-dark');
        document.body.classList.add('theme-light');
        if (iconTheme) iconTheme.textContent = '🌙';
        this.scene.clearColor = new BABYLON.Color4(0.97, 0.98, 0.99, 1.0);
      } else {
        document.body.classList.remove('theme-light');
        document.body.classList.add('theme-dark');
        if (iconTheme) iconTheme.textContent = '☀️';
        this.scene.clearColor = new BABYLON.Color4(0.06, 0.07, 0.09, 1.0);
      }
    });
  }

  /**
   * Top Header Actions & Floating Toolbar
   */
  private initQuickToolbar() {
    // Return to Dashboard button
    document.getElementById('btnHeaderBack')?.addEventListener('click', () => {
      this.showToast('Hai cliccato Torna alla Dashboard', 'info');
    });

    // Preview Mode button (Hide sidebars for presentation)
    document.getElementById('btnHeaderPreview')?.addEventListener('click', () => {
      const isPreview = this.appLayout.classList.toggle('preview-mode');
      this.showToast(isPreview ? 'Modalità Anteprima attiva (Premi ANTEPRIMA per uscire)' : 'Uscito da modalità anteprima', 'info');
    });

    // Export GLB button
    document.getElementById('btnHeaderExport')?.addEventListener('click', async () => {
      await this.exportGlb();
    });

    // Quick Toolbar Centering (F)
    document.getElementById('btnFootFrame')?.addEventListener('click', () => {
      this.frameSelectionOrModel();
    });

    // Quick Toolbar Auto Rotate (R)
    const btnFootRotate = document.getElementById('btnFootRotate');
    btnFootRotate?.addEventListener('click', () => {
      const chkAuto = document.getElementById('chkAutoRotate') as HTMLInputElement;
      const next = !this.camera.useAutoRotationBehavior;
      this.camera.useAutoRotationBehavior = next;
      if (next && this.camera.autoRotationBehavior) {
        this.camera.autoRotationBehavior.idleRotationSpeed = 0.05;
      }
      if (chkAuto) chkAuto.checked = next;
      btnFootRotate.classList.toggle('active', next);
    });

    // Quick Toolbar Fullscreen
    document.getElementById('btnFootFullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === 'i' || e.key === 'I') {
        document.getElementById('btnHeaderInspector')?.click();
      } else if (e.key === 'f' || e.key === 'F') {
        this.frameSelectionOrModel();
      } else if (e.key === 'r' || e.key === 'R') {
        document.getElementById('btnFootRotate')?.click();
      } else if (e.key === 'Escape') {
        if (this.appLayout.classList.contains('preview-mode')) {
          this.appLayout.classList.remove('preview-mode');
        }
      }
    });
  }

  /**
   * Builds the Nodes Tree dynamically when a model is loaded
   */
  private buildNodesTree(meshes: any[]) {
    const container = document.getElementById('meshTreeList');
    if (!container) return;
    container.innerHTML = '';

    const validMeshes = meshes.filter(m => m.name !== '__root__' && m.geometry);

    if (validMeshes.length === 0) {
      container.innerHTML = '<div class="tree-subnode-empty">Nessuna geometria trovata</div>';
      return;
    }

    for (const mesh of validMeshes) {
      const item = document.createElement('div');
      item.className = 'tree-subnode-item';
      item.id = `treeNode_${mesh.uniqueId}`;

      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = '◽';

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = mesh.name;
      label.title = mesh.name;

      const eye = document.createElement('button');
      eye.className = 'tree-action-icon tree-eye';
      eye.textContent = '👁️';
      eye.title = 'Mostra/Nascondi mesh';

      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = !mesh.isEnabled();
        mesh.setEnabled(next);
        mesh.isVisible = next;
        if (typeof mesh.getChildMeshes === 'function') {
          for (const child of mesh.getChildMeshes()) {
            child.setEnabled(next);
            child.isVisible = next;
          }
        }
        eye.classList.toggle('inactive', !next);
        this.showToast(next ? `Mesh '${mesh.name}' visibile` : `Mesh '${mesh.name}' nascosta (esclusa dall'export)`, 'info');
      });

      item.appendChild(icon);
      item.appendChild(label);
      item.appendChild(eye);

      item.addEventListener('click', () => {
        if (mesh.material) {
          this.selectMeshAndMaterial(mesh, mesh.material, true);
          this.activateTab('tabModelli');
        }
      });

      container.appendChild(item);
    }

    // Studio Lights Node Eye Toggles
    const btnStudioLightsEye = document.getElementById('btnToggleStudioLightsEye');
    btnStudioLightsEye?.addEventListener('click', (e) => {
      e.stopPropagation();
      const anyActive = this.studioLightSettings.rectEnabled || this.studioLightSettings.dirEnabled;
      const next = !anyActive;
      this.studioLightSettings.rectEnabled = next;
      this.studioLightSettings.dirEnabled = next;
      if (this.rectLight) this.rectLight.setEnabled(next);
      if (this.rectLightMesh) this.rectLightMesh.setEnabled(next);
      if (this.dirLight) this.dirLight.setEnabled(next);
      btnStudioLightsEye.classList.toggle('inactive', !next);
      this.showToast(next ? 'Luci studio attivate' : 'Luci studio disattivate', 'info');
    });

    const btnRectEye = document.getElementById('btnToggleRectEye');
    btnRectEye?.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !this.studioLightSettings.rectEnabled;
      this.studioLightSettings.rectEnabled = next;
      if (this.rectLight) this.rectLight.setEnabled(next);
      if (this.rectLightMesh) this.rectLightMesh.setEnabled(next && this.studioLightSettings.showLightGizmo);
      btnRectEye.classList.toggle('inactive', !next);
    });

    const btnDirEye = document.getElementById('btnToggleDirEye');
    btnDirEye?.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !this.studioLightSettings.dirEnabled;
      this.studioLightSettings.dirEnabled = next;
      if (this.dirLight) this.dirLight.setEnabled(next);
      btnDirEye.classList.toggle('inactive', !next);
    });
  }

  /**
   * "Select to Material" Feature:
   * Clicking an object in the scene selects it, highlights it, makes it the camera pivot,
   * highlights it in the Nodes tree, and opens the MODELLI tab!
   */
  private initPointerSelection() {
    let pointerStartX = 0;
    let pointerStartY = 0;

    let isAltDragging = false;
    let altStartX = 0;
    let initialRotationDeg = 0;

    this.scene.onPointerObservable.add((pointerInfo: any) => {
      const evt = pointerInfo.event;

      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        pointerStartX = evt.clientX;
        pointerStartY = evt.clientY;

        if (evt.altKey) {
          isAltDragging = true;
          altStartX = evt.clientX;
          initialRotationDeg = this.envSettings.rotationDeg;
          this.camera.detachControl();
        }
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        if (isAltDragging) {
          const deltaX = evt.clientX - altStartX;
          const newDeg = (initialRotationDeg + deltaX * 0.5) % 360;
          this.setEnvironmentRotation(newDeg < 0 ? newDeg + 360 : newDeg);
        }
      } else if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
        if (isAltDragging) {
          isAltDragging = false;
          this.camera.attachControl(this.canvas, true);
          return;
        }

        const dist = Math.hypot(evt.clientX - pointerStartX, evt.clientY - pointerStartY);
        if (dist < 6) {
          this.handleMeshClick(evt.clientX, evt.clientY);
        }
      }
    });
  }

  private handleMeshClick(screenX: number, screenY: number) {
    const pick = this.scene.pick(screenX, screenY);
    if (pick && pick.hit && pick.pickedMesh) {
      const mesh = pick.pickedMesh;
      if (!mesh.material) return;

      this.selectMeshAndMaterial(mesh, mesh.material, true, pick.pickedPoint);
      this.activateTab('tabModelli');
    }
  }

  pivotCameraToMesh(mesh: any, hitPoint?: any) {
    if (!mesh || !this.camera) return;
    try {
      let targetPoint: any;
      if (hitPoint && hitPoint instanceof BABYLON.Vector3) {
        targetPoint = hitPoint.clone();
      } else {
        if (mesh.computeWorldMatrix) mesh.computeWorldMatrix(true);
        if (mesh.refreshBoundingInfo) mesh.refreshBoundingInfo();
        const bInfo = mesh.getBoundingInfo();
        targetPoint = bInfo.boundingBox.centerWorld.clone();
      }

      const currentPos = this.camera.position.clone();
      const currentDist = BABYLON.Vector3.Distance(currentPos, targetPoint);
      const newRadius = Math.max(currentDist, this.camera.lowerRadiusLimit || 0.03);

      BABYLON.Animation.CreateAndStartAnimation(
        'cameraPivotAnim',
        this.camera,
        'target',
        60,
        14,
        this.camera.target.clone(),
        targetPoint,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
        new BABYLON.CubicEase()
      );

      BABYLON.Animation.CreateAndStartAnimation(
        'cameraRadiusPivotAnim',
        this.camera,
        'radius',
        60,
        14,
        this.camera.radius,
        newRadius,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
        new BABYLON.CubicEase()
      );
    } catch (e) {
      console.warn('Could not pivot camera to mesh:', e);
    }
  }

  frameSelectionOrModel() {
    if (this.selectedMesh) {
      this.pivotCameraToMesh(this.selectedMesh);
      try {
        const bInfo = this.selectedMesh.getBoundingInfo();
        const size = BABYLON.Vector3.Distance(bInfo.boundingBox.minimumWorld, bInfo.boundingBox.maximumWorld);
        const targetRadius = Math.max(size * 1.8, 0.4);

        BABYLON.Animation.CreateAndStartAnimation(
          'cameraRadiusAnim',
          this.camera,
          'radius',
          60,
          18,
          this.camera.radius,
          targetRadius,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          new BABYLON.CubicEase()
        );
      } catch (e) {
        this.frameModel();
      }
    } else {
      this.frameModel();
    }
  }

  selectMeshAndMaterial(mesh: any, material: any, recenterCamera: boolean = true, hitPoint?: any) {
    this.selectedMesh = mesh;
    this.selectedMaterial = material;

    // 1. Highlight Mesh with Azzurro / Sky Blue Outline (#38bdf8)
    this.highlightLayer?.removeAllMeshes();
    try {
      this.highlightLayer?.addMesh(mesh, BABYLON.Color3.FromHexString('#38bdf8'));
    } catch (e) {}

    // 2. Set camera pivot to surface contact point or mesh center
    if (recenterCamera) {
      this.pivotCameraToMesh(mesh, hitPoint);
    }

    // 3. Highlight in Nodes Tree
    document.querySelectorAll('.tree-subnode-item').forEach(el => el.classList.remove('active'));
    const treeEl = document.getElementById(`treeNode_${mesh.uniqueId}`);
    if (treeEl) {
      treeEl.classList.add('active');
      treeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 4. Populate Material Inspector Card & Controls
    this.populateMaterialPanel(mesh, material);

    // 5. If Babylon Inspector is active, select it in the official tree
    if (this.scene.debugLayer.isVisible()) {
      try {
        this.scene.debugLayer.select(material, 'MATERIALS');
      } catch (e) {}
    }
  }

  private populateMaterialPanel(mesh: any, mat: any) {
    const badgeMesh = document.getElementById('badgeMeshName');
    const selectMat = document.getElementById('selectModelMaterials') as HTMLSelectElement;
    const badgeStatus = document.getElementById('badgeMatStatus');

    if (badgeMesh) badgeMesh.textContent = mesh.name;
    if (selectMat) selectMat.value = mat.name;

    // Cache original blender state if first time seen
    if (!this.blenderOriginals.has(mat.name)) {
      this.blenderOriginals.set(mat.name, {
        albedoColor: mat.albedoColor ? mat.albedoColor.clone() : new BABYLON.Color3(1, 1, 1),
        roughness: mat.roughness ?? 0.5,
        metallic: mat.metallic ?? 0.0,
        emissiveColor: mat.emissiveColor ? mat.emissiveColor.clone() : new BABYLON.Color3(0, 0, 0),
        emissiveIntensity: mat.emissiveIntensity ?? 1.0,
        alpha: mat.alpha ?? 1.0,
        transparencyMode: mat.transparencyMode ?? 0,
        backFaceCulling: mat.backFaceCulling ?? false,
        clearCoatEnabled: mat.clearCoat ? mat.clearCoat.isEnabled : false,
        clearCoatIntensity: mat.clearCoat ? mat.clearCoat.intensity : 0.8,
        clearCoatRoughness: mat.clearCoat ? mat.clearCoat.roughness : 0.0,
        albedoTexture: mat.albedoTexture,
        bumpTexture: mat.bumpTexture,
        metallicTexture: mat.metallicTexture,
        emissiveTexture: mat.emissiveTexture,
        ambientTexture: mat.ambientTexture
      });
    }

    // Status badge: "Personalizzato" vs "Originale Blender"
    if (badgeStatus) {
      if (this.materialOverrides.has(mat.name)) {
        badgeStatus.textContent = 'Personalizzato';
        badgeStatus.className = 'mat-status-tag tag-custom';
      } else {
        badgeStatus.textContent = 'Originale Blender';
        badgeStatus.className = 'mat-status-tag tag-original';
      }
    }

    // Albedo Color
    const inputColor = document.getElementById('matInputAlbedoColor') as HTMLInputElement;
    const hexColor = document.getElementById('hexAlbedoColor');
    if (inputColor && mat.albedoColor) {
      const hex = mat.albedoColor.toHexString ? mat.albedoColor.toHexString() : '#ffffff';
      inputColor.value = hex;
      if (hexColor) hexColor.textContent = hex.toUpperCase();
    }

    // Roughness
    const sliderRough = document.getElementById('sliderRoughness') as HTMLInputElement;
    const valRough = document.getElementById('valRoughness');
    if (sliderRough) {
      sliderRough.value = (mat.roughness ?? 0.5).toString();
      if (valRough) valRough.textContent = (mat.roughness ?? 0.5).toFixed(2);
    }

    // Metallic
    const sliderMetal = document.getElementById('sliderMetallic') as HTMLInputElement;
    const valMetal = document.getElementById('valMetallic');
    if (sliderMetal) {
      sliderMetal.value = (mat.metallic ?? 0.0).toString();
      if (valMetal) valMetal.textContent = (mat.metallic ?? 0.0).toFixed(2);
    }

    // Emissive Color & Intensity
    const inputEmissive = document.getElementById('matInputEmissiveColor') as HTMLInputElement;
    const hexEmissive = document.getElementById('hexEmissiveColor');
    const sliderEmissiveInt = document.getElementById('sliderEmissiveInt') as HTMLInputElement;
    const valEmissiveInt = document.getElementById('valEmissiveInt');

    if (inputEmissive && mat.emissiveColor) {
      const hexEm = mat.emissiveColor.toHexString ? mat.emissiveColor.toHexString() : '#000000';
      inputEmissive.value = hexEm;
      if (hexEmissive) hexEmissive.textContent = hexEm.toUpperCase();
    }
    if (sliderEmissiveInt) {
      sliderEmissiveInt.value = (mat.emissiveIntensity ?? 1.0).toString();
      if (valEmissiveInt) valEmissiveInt.textContent = (mat.emissiveIntensity ?? 1.0).toFixed(2);
    }

    // Alpha / Opacity
    const sliderAlpha = document.getElementById('sliderAlpha') as HTMLInputElement;
    const valAlpha = document.getElementById('valAlpha');
    if (sliderAlpha) {
      sliderAlpha.value = (mat.alpha ?? 1.0).toString();
      if (valAlpha) valAlpha.textContent = (mat.alpha ?? 1.0).toFixed(2);
    }

    // Transparency Mode
    const selectTrans = document.getElementById('selectTransparencyMode') as HTMLSelectElement;
    if (selectTrans) {
      selectTrans.value = (mat.transparencyMode ?? 0).toString();
    }

    // Double Sided (Backface Culling)
    const chkDouble = document.getElementById('chkDoubleSided') as HTMLInputElement;
    if (chkDouble) {
      chkDouble.checked = !mat.backFaceCulling;
    }

    // Clearcoat
    const chkClear = document.getElementById('chkClearcoat') as HTMLInputElement;
    const sliderClearInt = document.getElementById('sliderClearcoatInt') as HTMLInputElement;
    const valClearInt = document.getElementById('valClearcoatInt');
    const sliderClearRough = document.getElementById('sliderClearcoatRough') as HTMLInputElement;
    const valClearRough = document.getElementById('valClearcoatRough');

    if (chkClear && mat.clearCoat) {
      chkClear.checked = !!mat.clearCoat.isEnabled;
      if (sliderClearInt) sliderClearInt.value = (mat.clearCoat.intensity ?? 0.8).toString();
      if (valClearInt) valClearInt.textContent = (mat.clearCoat.intensity ?? 0.8).toFixed(2);
      if (sliderClearRough) sliderClearRough.value = (mat.clearCoat.roughness ?? 0.0).toString();
      if (valClearRough) valClearRough.textContent = (mat.clearCoat.roughness ?? 0.0).toFixed(2);
    }

    // Thumbnails for texture slots
    this.updateThumb('thumb_albedo', mat.albedoTexture);
    this.updateThumb('thumb_metallic', mat.metallicTexture);
    this.updateThumb('thumb_bump', mat.bumpTexture);
    this.updateThumb('thumb_emissive', mat.emissiveTexture);
    this.updateThumb('thumb_ambient', mat.ambientTexture);
  }

  private populateMaterialDropdown(materials: any[]) {
    const sel = document.getElementById('selectModelMaterials') as HTMLSelectElement;
    if (!sel) return;
    sel.innerHTML = '';

    for (const m of materials) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
  }

  private updateThumb(elId: string, texture: any) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (texture && texture.url) {
      el.style.backgroundImage = `url("${texture.url}")`;
    } else {
      el.style.backgroundImage = 'none';
    }
  }

  private markMaterialCustomized(matName: string) {
    const badgeStatus = document.getElementById('badgeMatStatus');
    if (badgeStatus) {
      badgeStatus.textContent = 'Personalizzato';
      badgeStatus.className = 'mat-status-tag tag-custom';
    }
  }

  private initMaterialPanelControls() {
    const selectMat = document.getElementById('selectModelMaterials') as HTMLSelectElement;
    selectMat?.addEventListener('change', () => {
      const matName = selectMat.value;
      const mat = this.scene.getMaterialByName(matName);
      if (mat && this.modelRoot) {
        const mesh = this.modelRoot.getChildMeshes().find((m: any) => m.material && (m.material === mat || m.material.name === matName));
        if (mesh) {
          this.selectMeshAndMaterial(mesh, mat, true);
        } else {
          this.selectedMaterial = mat;
          this.populateMaterialPanel({ name: 'Nessun oggetto' }, mat);
        }
      }
    });

    document.getElementById('btnPivotMesh')?.addEventListener('click', () => {
      if (this.selectedMesh) {
        this.pivotCameraToMesh(this.selectedMesh);
        this.showToast(`🎯 Camera centrata su '${this.selectedMesh.name}'`, 'info');
      }
    });

    // Albedo Color
    const inputColor = document.getElementById('matInputAlbedoColor') as HTMLInputElement;
    const hexColor = document.getElementById('hexAlbedoColor');
    inputColor?.addEventListener('input', () => {
      if (!this.selectedMaterial) return;
      this.selectedMaterial.albedoColor = BABYLON.Color3.FromHexString(inputColor.value);
      if (hexColor) hexColor.textContent = inputColor.value.toUpperCase();
      this.recordMaterialOverride(this.selectedMaterial.name, { albedoColor: inputColor.value });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Roughness
    const sliderRough = document.getElementById('sliderRoughness') as HTMLInputElement;
    const valRough = document.getElementById('valRoughness');
    sliderRough?.addEventListener('input', () => {
      if (!this.selectedMaterial) return;
      const v = parseFloat(sliderRough.value);
      if (valRough) valRough.textContent = v.toFixed(2);
      this.selectedMaterial.roughness = v;
      this.recordMaterialOverride(this.selectedMaterial.name, { roughness: v });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Apply current roughness to all materials of the model
    document.getElementById('btnApplyRoughnessToAll')?.addEventListener('click', () => {
      if (!sliderRough) return;
      const v = parseFloat(sliderRough.value);
      let count = 0;
      for (const m of this.scene.materials) {
        if (!m || m.name.includes('Helper') || m.name.includes('RectLight') || m.name.includes('lookdev')) continue;
        if ('roughness' in m) {
          m.roughness = v;
          this.recordMaterialOverride(m.name, { roughness: v });
          count++;
        }
      }
      this.saveCachedOverrides();
      this.showToast(`🌐 Rugosità ${v.toFixed(2)} applicata a tutti i materiali del prodotto (${count})`, 'info');
    });

    // Metallic
    const sliderMetal = document.getElementById('sliderMetallic') as HTMLInputElement;
    const valMetal = document.getElementById('valMetallic');
    sliderMetal?.addEventListener('input', () => {
      if (!this.selectedMaterial) return;
      const v = parseFloat(sliderMetal.value);
      if (valMetal) valMetal.textContent = v.toFixed(2);
      this.selectedMaterial.metallic = v;
      this.recordMaterialOverride(this.selectedMaterial.name, { metallic: v });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Emissive Color
    const inputEmissive = document.getElementById('matInputEmissiveColor') as HTMLInputElement;
    const hexEmissive = document.getElementById('hexEmissiveColor');
    inputEmissive?.addEventListener('input', () => {
      if (!this.selectedMaterial) return;
      this.selectedMaterial.emissiveColor = BABYLON.Color3.FromHexString(inputEmissive.value);
      if (hexEmissive) hexEmissive.textContent = inputEmissive.value.toUpperCase();
      this.recordMaterialOverride(this.selectedMaterial.name, { emissiveColor: inputEmissive.value });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Emissive Intensity
    const sliderEmissiveInt = document.getElementById('sliderEmissiveInt') as HTMLInputElement;
    const valEmissiveInt = document.getElementById('valEmissiveInt');
    sliderEmissiveInt?.addEventListener('input', () => {
      if (!this.selectedMaterial) return;
      const v = parseFloat(sliderEmissiveInt.value);
      if (valEmissiveInt) valEmissiveInt.textContent = v.toFixed(2);
      this.selectedMaterial.emissiveIntensity = v;
      this.recordMaterialOverride(this.selectedMaterial.name, { emissiveIntensity: v });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Double Sided (No Backface Culling)
    const chkDouble = document.getElementById('chkDoubleSided') as HTMLInputElement;
    chkDouble?.addEventListener('change', () => {
      if (!this.selectedMaterial) return;
      this.selectedMaterial.backFaceCulling = !chkDouble.checked;
      this.selectedMaterial.twoSidedLighting = chkDouble.checked;
      this.recordMaterialOverride(this.selectedMaterial.name, { backFaceCulling: this.selectedMaterial.backFaceCulling });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Alpha / Opacity
    const sliderAlpha = document.getElementById('sliderAlpha') as HTMLInputElement;
    const valAlpha = document.getElementById('valAlpha');
    sliderAlpha?.addEventListener('input', () => {
      if (!this.selectedMaterial) return;
      const v = parseFloat(sliderAlpha.value);
      if (valAlpha) valAlpha.textContent = v.toFixed(2);
      this.selectedMaterial.alpha = v;
      if (v < 1.0 && this.selectedMaterial.transparencyMode === 0) {
        this.selectedMaterial.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
        const selectTrans = document.getElementById('selectTransparencyMode') as HTMLSelectElement;
        if (selectTrans) selectTrans.value = '2';
      }
      this.recordMaterialOverride(this.selectedMaterial.name, { alpha: v });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Transparency Mode
    const selectTrans = document.getElementById('selectTransparencyMode') as HTMLSelectElement;
    selectTrans?.addEventListener('change', () => {
      if (!this.selectedMaterial) return;
      const mode = parseInt(selectTrans.value, 10);
      this.selectedMaterial.transparencyMode = mode;
      this.recordMaterialOverride(this.selectedMaterial.name, { transparencyMode: mode });
      this.markMaterialCustomized(this.selectedMaterial.name);
    });

    // Clearcoat
    const chkClear = document.getElementById('chkClearcoat') as HTMLInputElement;
    const sliderClearInt = document.getElementById('sliderClearcoatInt') as HTMLInputElement;
    const valClearInt = document.getElementById('valClearcoatInt');
    const sliderClearRough = document.getElementById('sliderClearcoatRough') as HTMLInputElement;
    const valClearRough = document.getElementById('valClearcoatRough');

    const updateClearcoat = () => {
      if (!this.selectedMaterial || !this.selectedMaterial.clearCoat) return;
      this.selectedMaterial.clearCoat.isEnabled = chkClear.checked;
      const intVal = parseFloat(sliderClearInt.value);
      const roughVal = parseFloat(sliderClearRough.value);
      if (valClearInt) valClearInt.textContent = intVal.toFixed(2);
      if (valClearRough) valClearRough.textContent = roughVal.toFixed(2);
      this.selectedMaterial.clearCoat.intensity = intVal;
      this.selectedMaterial.clearCoat.roughness = roughVal;
      this.recordMaterialOverride(this.selectedMaterial.name, {
        clearCoatEnabled: chkClear.checked,
        clearCoatIntensity: intVal,
        clearCoatRoughness: roughVal
      });
      this.markMaterialCustomized(this.selectedMaterial.name);
    };
    chkClear?.addEventListener('change', updateClearcoat);
    sliderClearInt?.addEventListener('input', updateClearcoat);
    sliderClearRough?.addEventListener('input', updateClearcoat);

    // Texture slot buttons
    this.bindTexSlot('albedo', 'btnBrowseTexAlbedo', 'inputTexAlbedo', 'btnClearTexAlbedo', 'thumb_albedo');
    this.bindTexSlot('metallicRoughness', 'btnBrowseTexMetallic', 'inputTexMetallic', 'btnClearTexMetallic', 'thumb_metallic');
    this.bindTexSlot('bump', 'btnBrowseTexBump', 'inputTexBump', 'btnClearTexBump', 'thumb_bump');
    this.bindTexSlot('emissive', 'btnBrowseTexEmissive', 'inputTexEmissive', 'btnClearTexEmissive', 'thumb_emissive');
    this.bindTexSlot('ambient', 'btnBrowseTexAmbient', 'inputTexAmbient', 'btnClearTexAmbient', 'thumb_ambient');

    // Reset this material to Blender
    document.getElementById('btnResetCurrentMat')?.addEventListener('click', () => {
      if (!this.selectedMaterial) return;
      const orig = this.blenderOriginals.get(this.selectedMaterial.name);
      if (orig) {
        this.selectedMaterial.albedoColor = orig.albedoColor.clone();
        this.selectedMaterial.roughness = orig.roughness;
        this.selectedMaterial.metallic = orig.metallic;
        this.selectedMaterial.emissiveColor = orig.emissiveColor ? orig.emissiveColor.clone() : new BABYLON.Color3(0, 0, 0);
        this.selectedMaterial.emissiveIntensity = orig.emissiveIntensity ?? 1.0;
        this.selectedMaterial.alpha = orig.alpha;
        this.selectedMaterial.transparencyMode = orig.transparencyMode ?? 0;
        this.selectedMaterial.backFaceCulling = orig.backFaceCulling;
        this.selectedMaterial.twoSidedLighting = !orig.backFaceCulling;

        if (orig.clearCoatEnabled !== undefined && this.selectedMaterial.clearCoat) {
          this.selectedMaterial.clearCoat.isEnabled = orig.clearCoatEnabled;
          this.selectedMaterial.clearCoat.intensity = orig.clearCoatIntensity;
          this.selectedMaterial.clearCoat.roughness = orig.clearCoatRoughness;
        }

        this.selectedMaterial.albedoTexture = orig.albedoTexture;
        this.selectedMaterial.metallicTexture = orig.metallicTexture;
        this.selectedMaterial.bumpTexture = orig.bumpTexture;
        this.selectedMaterial.emissiveTexture = orig.emissiveTexture;
        this.selectedMaterial.ambientTexture = orig.ambientTexture;

        this.materialOverrides.delete(this.selectedMaterial.name);
        this.saveCachedOverrides();
        this.populateMaterialPanel(this.selectedMesh, this.selectedMaterial);
        this.showToast(`Materiale '${this.selectedMaterial.name}' ripristinato a Blender`, 'info');
      }
    });
  }

  private bindTexSlot(slot: string, browseBtnId: string, inputId: string, clearBtnId: string, thumbId: string) {
    const btn = document.getElementById(browseBtnId);
    const input = document.getElementById(inputId) as HTMLInputElement;
    const clearBtn = document.getElementById(clearBtnId);

    btn?.addEventListener('click', () => {
      if (input) {
        input.value = '';
        input.click();
      }
    });

    input?.addEventListener('change', async () => {
      if (input.files && input.files[0] && this.selectedMaterial) {
        await this.assignTextureToMaterial(this.selectedMaterial.name, slot as any, input.files[0]);
        this.updateThumb(thumbId, (this.selectedMaterial as any)[slot + 'Texture']);
        this.markMaterialCustomized(this.selectedMaterial.name);
        this.showToast(`Texture assegnata allo slot ${slot}`, 'success');
      }
    });

    clearBtn?.addEventListener('click', () => {
      if (this.selectedMaterial) {
        if (slot === 'albedo') this.selectedMaterial.albedoTexture = null;
        if (slot === 'metallicRoughness') this.selectedMaterial.metallicTexture = null;
        if (slot === 'bump') this.selectedMaterial.bumpTexture = null;
        if (slot === 'emissive') this.selectedMaterial.emissiveTexture = null;
        if (slot === 'ambient') this.selectedMaterial.ambientTexture = null;
        this.updateThumb(thumbId, null);

        const current = this.materialOverrides.get(this.selectedMaterial.name);
        if (current) {
          (current as any)[slot + 'Texture'] = null;
          this.saveCachedOverrides();
        }
        this.markMaterialCustomized(this.selectedMaterial.name);
        this.showToast(`Texture rimossa dallo slot ${slot}`, 'info');
      }
    });
  }

  /**
   * Studio Lighting Controls: Presets, Softbox Dimensions, Angle, Directional Sun & Shadows
   */
  private initStudioLightingControls() {
    // Light presets
    const presetButtons = document.querySelectorAll('.btn-preset-light');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        presetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const preset = btn.getAttribute('data-preset') || 'key_right';
        this.setRectLightPositionPreset(preset);
        this.showToast(`Preset luci applicato: ${preset}`, 'info');
      });
    });

    // RectAreaLight enable switch
    const chkRect = document.getElementById('chkEnableRectLight') as HTMLInputElement;
    chkRect?.addEventListener('change', () => {
      this.studioLightSettings.rectEnabled = chkRect.checked;
      if (this.rectLight) this.rectLight.setEnabled(chkRect.checked);
      if (this.rectLightMesh) this.rectLightMesh.setEnabled(chkRect.checked && this.studioLightSettings.showLightGizmo);
      const btnEye = document.getElementById('btnToggleRectEye');
      btnEye?.classList.toggle('inactive', !chkRect.checked);
    });

    // Show Light Gizmo switch
    const chkGizmo = document.getElementById('chkShowLightGizmo') as HTMLInputElement;
    chkGizmo?.addEventListener('change', () => {
      this.studioLightSettings.showLightGizmo = chkGizmo.checked;
      if (this.rectLightMesh) {
        this.rectLightMesh.setEnabled(chkGizmo.checked && this.studioLightSettings.rectEnabled);
      }
    });

    // Rect Light Intensity
    const sliderInt = document.getElementById('sliderRectIntensity') as HTMLInputElement;
    const valInt = document.getElementById('valRectIntensity');
    sliderInt?.addEventListener('input', () => {
      const v = parseFloat(sliderInt.value);
      if (valInt) valInt.textContent = v.toFixed(2);
      this.studioLightSettings.rectIntensity = v;
      if (this.rectLight) this.rectLight.intensity = v;
    });

    // Width & Height
    const sliderW = document.getElementById('sliderRectWidth') as HTMLInputElement;
    const valW = document.getElementById('valRectWidth');
    sliderW?.addEventListener('input', () => {
      const v = parseFloat(sliderW.value);
      if (valW) valW.textContent = v.toFixed(2);
      this.studioLightSettings.rectWidth = v;
      this.updateRectLightTransform();
    });

    const sliderH = document.getElementById('sliderRectHeight') as HTMLInputElement;
    const valH = document.getElementById('valRectHeight');
    sliderH?.addEventListener('input', () => {
      const v = parseFloat(sliderH.value);
      if (valH) valH.textContent = v.toFixed(2);
      this.studioLightSettings.rectHeight = v;
      this.updateRectLightTransform();
    });

    // Distance
    const sliderDist = document.getElementById('sliderRectDistance') as HTMLInputElement;
    const valDist = document.getElementById('valRectDistance');
    sliderDist?.addEventListener('input', () => {
      const v = parseFloat(sliderDist.value);
      if (valDist) valDist.textContent = v.toFixed(2);
      this.studioLightSettings.rectDistance = v;
      this.updateRectLightTransform();
    });

    // Height Position
    const sliderHeightPos = document.getElementById('sliderRectHeightPos') as HTMLInputElement;
    const valHeightPos = document.getElementById('valRectHeightPos');
    sliderHeightPos?.addEventListener('input', () => {
      const v = parseFloat(sliderHeightPos.value);
      if (valHeightPos) valHeightPos.textContent = v.toFixed(2);
      this.studioLightSettings.rectHeightPos = v;
      this.updateRectLightTransform();
    });

    // Angle
    const sliderAngle = document.getElementById('sliderRectAngle') as HTMLInputElement;
    const valAngle = document.getElementById('valRectAngle');
    sliderAngle?.addEventListener('input', () => {
      const v = parseInt(sliderAngle.value, 10);
      if (valAngle) valAngle.textContent = `${v}°`;
      this.studioLightSettings.rectAngleDeg = v;
      this.updateRectLightTransform();
    });

    // Color Tint
    const inputColor = document.getElementById('rectLightColor') as HTMLInputElement;
    inputColor?.addEventListener('input', () => {
      this.studioLightSettings.rectColor = inputColor.value;
      if (this.rectLight) this.rectLight.diffuse = BABYLON.Color3.FromHexString(inputColor.value);
      if (this.rectLightMesh && this.rectLightMesh.material) {
        this.rectLightMesh.material.emissiveColor = BABYLON.Color3.FromHexString(inputColor.value);
      }
    });

    // Texture Emissiva HDR Softbox
    const fileTex = document.getElementById('inputRectTex') as HTMLInputElement;
    document.getElementById('btnBrowseRectTex')?.addEventListener('click', () => {
      fileTex.value = '';
      fileTex.click();
    });
    fileTex?.addEventListener('change', async () => {
      if (fileTex.files && fileTex.files[0]) {
        await this.loadRectLightTexture(fileTex.files[0]);
      }
    });
    document.getElementById('btnClearRectTex')?.addEventListener('click', () => {
      if (this.rectLightMesh && this.rectLightMesh.material) {
        this.rectLightMesh.material.emissiveTexture = null;
        this.updateThumb('thumb_rect_tex', null);
      }
    });

    // Directional Sun Switch
    const chkDir = document.getElementById('chkEnableDirLight') as HTMLInputElement;
    chkDir?.addEventListener('change', () => {
      this.studioLightSettings.dirEnabled = chkDir.checked;
      if (this.dirLight) this.dirLight.setEnabled(chkDir.checked);
      const btnEye = document.getElementById('btnToggleDirEye');
      btnEye?.classList.toggle('inactive', !chkDir.checked);
    });

    // Sun Shadows Switch
    const chkShadows = document.getElementById('chkDirShadows') as HTMLInputElement;
    chkShadows?.addEventListener('change', () => {
      this.studioLightSettings.castShadows = chkShadows.checked;
      if (chkShadows.checked) {
        if (!this.shadowGenerator && this.dirLight) {
          this.shadowGenerator = new BABYLON.ShadowGenerator(1024, this.dirLight);
          this.shadowGenerator.useBlurExponentialShadowMap = true;
          this.shadowGenerator.blurKernel = 32;
        }
        if (this.modelRoot) {
          for (const m of this.modelRoot.getChildMeshes()) {
            this.shadowGenerator.addShadowCaster(m);
          }
        }
      } else if (this.shadowGenerator) {
        this.shadowGenerator.dispose();
        this.shadowGenerator = null;
      }
    });

    // Sun Intensity
    const sliderDirInt = document.getElementById('sliderDirIntensity') as HTMLInputElement;
    const valDirInt = document.getElementById('valDirIntensity');
    sliderDirInt?.addEventListener('input', () => {
      const v = parseFloat(sliderDirInt.value);
      if (valDirInt) valDirInt.textContent = v.toFixed(2);
      this.studioLightSettings.dirIntensity = v;
      if (this.dirLight) this.dirLight.intensity = v;
    });
  }

  updateRectLightTransform() {
    if (!this.rectLightNode) return;

    const target = (this.camera && this.camera.target) ? this.camera.target : new BABYLON.Vector3(0, 0.5, 0);
    const d = this.studioLightSettings.rectDistance;
    const h = this.studioLightSettings.rectHeightPos;
    const rad = BABYLON.Tools.ToRadians(this.studioLightSettings.rectAngleDeg);

    const x = target.x + Math.sin(rad) * d;
    const z = target.z + Math.cos(rad) * d;
    const y = target.y + h;

    this.rectLightNode.position.set(x, y, z);
    this.rectLightNode.lookAt(target);

    if (this.rectLight) {
      this.rectLight.width = this.studioLightSettings.rectWidth;
      this.rectLight.height = this.studioLightSettings.rectHeight;
    }
    if (this.rectLightMesh) {
      this.rectLightMesh.scaling.x = this.studioLightSettings.rectWidth / 1.5;
      this.rectLightMesh.scaling.y = this.studioLightSettings.rectHeight / 1.5;
    }
  }

  setRectLightPositionPreset(preset: string) {
    this.studioLightSettings.rectPreset = preset;
    switch (preset) {
      case 'key_right':
        this.studioLightSettings.rectAngleDeg = 45;
        this.studioLightSettings.rectDistance = 3.2;
        this.studioLightSettings.rectHeightPos = 2.2;
        this.studioLightSettings.rectEnabled = true;
        this.studioLightSettings.dirEnabled = false;
        break;
      case 'three_point':
        this.studioLightSettings.rectAngleDeg = 45;
        this.studioLightSettings.rectDistance = 3.0;
        this.studioLightSettings.rectHeightPos = 2.0;
        this.studioLightSettings.rectEnabled = true;
        this.studioLightSettings.dirEnabled = true;
        break;
      case 'top_softbox':
        this.studioLightSettings.rectAngleDeg = 0;
        this.studioLightSettings.rectDistance = 0.2;
        this.studioLightSettings.rectHeightPos = 3.5;
        this.studioLightSettings.rectEnabled = true;
        this.studioLightSettings.dirEnabled = false;
        break;
      case 'solo_hdr':
        this.studioLightSettings.rectEnabled = false;
        this.studioLightSettings.dirEnabled = false;
        break;
    }

    if (this.rectLight) this.rectLight.setEnabled(this.studioLightSettings.rectEnabled);
    if (this.rectLightMesh) this.rectLightMesh.setEnabled(this.studioLightSettings.rectEnabled && this.studioLightSettings.showLightGizmo);
    if (this.dirLight) this.dirLight.setEnabled(this.studioLightSettings.dirEnabled);

    const chkRect = document.getElementById('chkEnableRectLight') as HTMLInputElement;
    if (chkRect) chkRect.checked = this.studioLightSettings.rectEnabled;
    const chkDir = document.getElementById('chkEnableDirLight') as HTMLInputElement;
    if (chkDir) chkDir.checked = this.studioLightSettings.dirEnabled;

    this.updateRectLightTransform();
  }

  async loadRectLightTexture(file: File) {
    try {
      this.showToast(`Caricamento texture Softbox: ${file.name}...`, 'info');
      const ext = file.name.split('.').pop()?.toLowerCase();

      let dataUrl: string;
      if (ext === 'exr') {
        const buffer = await file.arrayBuffer();
        const hdrBlob = convertExrToHdrBlob(buffer);
        dataUrl = URL.createObjectURL(hdrBlob);
      } else {
        dataUrl = await this.fileToDataUrl(file);
      }

      const tex = new BABYLON.Texture(dataUrl, this.scene);
      if (this.rectLightMesh && this.rectLightMesh.material) {
        this.rectLightMesh.material.emissiveTexture = tex;
        this.updateThumb('thumb_rect_tex', tex);
      }
      this.showToast('✅ Texture diffusore applicata al Softbox!', 'success');
    } catch (e: any) {
      this.showToast('Errore texture softbox: ' + e.message, 'error');
    }
  }

  /**
   * SSR Controls
   */
  private initSsrControls() {
    const chkEnable = document.getElementById('chkEnableSsr') as HTMLInputElement;
    chkEnable?.addEventListener('change', () => {
      if (this.ssrPipeline) {
        this.ssrPipeline.isEnabled = chkEnable.checked;
      }
      this.showToast(chkEnable.checked ? '✨ Screen Space Reflections (SSR) attivate' : 'SSR disattivate', 'info');
    });

    const sliderBlurDisp = document.getElementById('sliderSsrBlurDispersion') as HTMLInputElement;
    const valBlurDisp = document.getElementById('valSsrBlurDispersion');
    sliderBlurDisp?.addEventListener('input', () => {
      const v = parseFloat(sliderBlurDisp.value);
      if (valBlurDisp) valBlurDisp.textContent = v.toFixed(2);
      if (this.ssrPipeline) this.ssrPipeline.blurDispersionStrength = v;
    });

    const sliderRoughness = document.getElementById('sliderSsrRoughness') as HTMLInputElement;
    const valRoughness = document.getElementById('valSsrRoughness');
    sliderRoughness?.addEventListener('input', () => {
      const v = parseFloat(sliderRoughness.value);
      if (valRoughness) valRoughness.textContent = v.toFixed(2);
      if (this.ssrPipeline) this.ssrPipeline.roughnessFactor = v;
    });

    const sliderFalloff = document.getElementById('sliderSsrFalloff') as HTMLInputElement;
    const valFalloff = document.getElementById('valSsrFalloff');
    sliderFalloff?.addEventListener('input', () => {
      const v = parseFloat(sliderFalloff.value);
      if (valFalloff) valFalloff.textContent = v.toFixed(2);
      if (this.ssrPipeline) this.ssrPipeline.reflectionSpecularFalloffExponent = v;
    });

    const sliderStrength = document.getElementById('sliderSsrStrength') as HTMLInputElement;
    const valStrength = document.getElementById('valSsrStrength');
    sliderStrength?.addEventListener('input', () => {
      const v = parseFloat(sliderStrength.value);
      if (valStrength) valStrength.textContent = v.toFixed(2);
      if (this.ssrPipeline) this.ssrPipeline.strength = v;
    });

    const sliderThickness = document.getElementById('sliderSsrThickness') as HTMLInputElement;
    const valThickness = document.getElementById('valSsrThickness');
    sliderThickness?.addEventListener('input', () => {
      const v = parseFloat(sliderThickness.value);
      if (valThickness) valThickness.textContent = v.toFixed(2);
      if (this.ssrPipeline) this.ssrPipeline.thickness = v;
    });

    const selectStep = document.getElementById('selectSsrStep') as HTMLSelectElement;
    selectStep?.addEventListener('change', () => {
      const s = parseInt(selectStep.value, 10);
      if (this.ssrPipeline) this.ssrPipeline.step = s;
    });

    const chkFresnel = document.getElementById('chkSsrFresnel') as HTMLInputElement;
    chkFresnel?.addEventListener('change', () => {
      if (this.ssrPipeline) this.ssrPipeline.useFresnel = chkFresnel.checked;
    });

    const chkSmooth = document.getElementById('chkSsrSmooth') as HTMLInputElement;
    chkSmooth?.addEventListener('change', () => {
      if (this.ssrPipeline) this.ssrPipeline.enableSmoothReflections = chkSmooth.checked;
    });

    const chkDebug = document.getElementById('chkSsrDebug') as HTMLInputElement;
    chkDebug?.addEventListener('change', () => {
      if (this.ssrPipeline) this.ssrPipeline.debug = chkDebug.checked;
    });
  }

  /**
   * Ambient Occlusion (SSAO) Controls:
   * Real-time contact shadows and self-shadowing between model surfaces
   */
  private initSsaoControls() {
    // 1. Enable / Disable toggle
    const chkEnable = document.getElementById('chkEnableSsao') as HTMLInputElement;
    chkEnable?.addEventListener('change', () => {
      this.setSsaoEnabled(chkEnable.checked);
      this.showToast(
        chkEnable.checked
          ? '🌑 Ambient Occlusion (SSAO) attivata'
          : 'Ambient Occlusion disattivata',
        'info'
      );
    });

    // 2. Tree item click & eye toggle
    const nodeSsao = document.getElementById('nodeSsao');
    nodeSsao?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'btnToggleSsaoEye' || target.closest('#btnToggleSsaoEye')) {
        return; // Handled below
      }
      this.activateTab('tabScena');
      const sec = document.getElementById('secSSAO');
      if (sec) {
        sec.classList.add('expanded');
        sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    const btnEye = document.getElementById('btnToggleSsaoEye');
    btnEye?.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextState = !this.ssaoSettings.enabled;
      this.setSsaoEnabled(nextState);
      this.showToast(
        nextState
          ? '🌑 Ambient Occlusion (SSAO) attivata'
          : 'Ambient Occlusion disattivata',
        'info'
      );
    });

    // 3. Total Strength Slider
    const sliderStrength = document.getElementById('sliderSsaoStrength') as HTMLInputElement;
    const valStrength = document.getElementById('valSsaoStrength');
    sliderStrength?.addEventListener('input', () => {
      const v = parseFloat(sliderStrength.value);
      this.ssaoSettings.totalStrength = v;
      if (valStrength) valStrength.textContent = v.toFixed(2);
      if (this.ssaoPipeline) this.ssaoPipeline.totalStrength = v;
    });

    // 4. Sampling Radius Slider
    const sliderRadius = document.getElementById('sliderSsaoRadius') as HTMLInputElement;
    const valRadius = document.getElementById('valSsaoRadius');
    sliderRadius?.addEventListener('input', () => {
      const v = parseFloat(sliderRadius.value);
      this.ssaoSettings.radius = v;
      if (valRadius) valRadius.textContent = `${v.toFixed(2)} m`;
      if (this.ssaoPipeline) this.ssaoPipeline.radius = v;
    });

    // 5. Samples Dropdown
    const selectSamples = document.getElementById('selectSsaoSamples') as HTMLSelectElement;
    selectSamples?.addEventListener('change', () => {
      const s = parseInt(selectSamples.value, 10);
      this.ssaoSettings.samples = s;
      if (this.ssaoPipeline) this.ssaoPipeline.samples = s;
      this.showToast(`Campioni SSAO: ${s}`, 'info');
    });

    // 6. Base Occlusion Slider
    const sliderBase = document.getElementById('sliderSsaoBase') as HTMLInputElement;
    const valBase = document.getElementById('valSsaoBase');
    sliderBase?.addEventListener('input', () => {
      const v = parseFloat(sliderBase.value);
      this.ssaoSettings.base = v;
      if (valBase) valBase.textContent = v.toFixed(2);
      if (this.ssaoPipeline) this.ssaoPipeline.base = v;
    });

    // 7. Max Depth (Max Z) Slider
    const sliderMaxZ = document.getElementById('sliderSsaoMaxZ') as HTMLInputElement;
    const valMaxZ = document.getElementById('valSsaoMaxZ');
    sliderMaxZ?.addEventListener('input', () => {
      const v = parseFloat(sliderMaxZ.value);
      this.ssaoSettings.maxZ = v;
      if (valMaxZ) valMaxZ.textContent = `${v} m`;
      if (this.ssaoPipeline) this.ssaoPipeline.maxZ = v;
    });

    // 8. Expensive Bilateral Blur Toggle
    const chkExpensiveBlur = document.getElementById('chkSsaoExpensiveBlur') as HTMLInputElement;
    chkExpensiveBlur?.addEventListener('change', () => {
      this.ssaoSettings.expensiveBlur = chkExpensiveBlur.checked;
      if (this.ssaoPipeline) this.ssaoPipeline.expensiveBlur = chkExpensiveBlur.checked;
    });

    // 9. Bilateral Soften Slider
    const sliderBilateralSoften = document.getElementById('sliderSsaoBilateralSoften') as HTMLInputElement;
    const valBilateralSoften = document.getElementById('valSsaoBilateralSoften');
    sliderBilateralSoften?.addEventListener('input', () => {
      const v = parseFloat(sliderBilateralSoften.value);
      this.ssaoSettings.bilateralSoften = v;
      if (valBilateralSoften) valBilateralSoften.textContent = v.toFixed(2);
      if (this.ssaoPipeline) this.ssaoPipeline.bilateralSoften = v;
    });

    // 10. Texture Resolution Ratio Dropdown
    const selectRatio = document.getElementById('selectSsaoRatio') as HTMLSelectElement;
    selectRatio?.addEventListener('change', () => {
      const r = parseFloat(selectRatio.value);
      this.ssaoSettings.ratio = r;
      this.rebuildSsaoPipeline();
      this.showToast(`Risoluzione Texture AO impostata a ${selectRatio.options[selectRatio.selectedIndex].text}`, 'info');
    });
  }

  /**
   * Environment Controls: HDRI/EXR Upload, Rotation, Intensity, Skybox Blur
   */
  private initEnvironmentPanelControls() {
    const fileInput = document.getElementById('fileInputHdrExr') as HTMLInputElement;
    document.getElementById('btnUploadEnvFile')?.addEventListener('click', () => {
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    });

    fileInput?.addEventListener('change', async () => {
      if (fileInput.files && fileInput.files[0]) {
        await this.loadHdrFile(fileInput.files[0]);
      }
    });

    const sliderInt = document.getElementById('sliderEnvIntensity') as HTMLInputElement;
    const valInt = document.getElementById('valEnvIntensity');
    sliderInt?.addEventListener('input', () => {
      const v = parseFloat(sliderInt.value);
      if (valInt) valInt.textContent = v.toFixed(2);
      this.scene.environmentIntensity = v;
      this.envSettings.intensity = v;
    });

    const sliderRot = document.getElementById('sliderEnvRotation') as HTMLInputElement;
    sliderRot?.addEventListener('input', () => {
      const deg = parseInt(sliderRot.value, 10);
      this.setEnvironmentRotation(deg);
    });

    const chkSkybox = document.getElementById('chkShowSkybox') as HTMLInputElement;
    chkSkybox?.addEventListener('change', () => {
      this.envSettings.showSkybox = chkSkybox.checked;
      this.updateSkyboxVisibility();
    });

    const sliderBlur = document.getElementById('sliderSkyboxBlur') as HTMLInputElement;
    const valBlur = document.getElementById('valSkyboxBlur');
    sliderBlur?.addEventListener('input', () => {
      const b = parseFloat(sliderBlur.value);
      if (valBlur) valBlur.textContent = b.toFixed(2);
      this.envSettings.skyboxBlur = b;

      if (this.environmentHelper) {
        this.environmentHelper.skyboxBlur = b;
        if (this.environmentHelper.skyboxMaterial) {
          this.environmentHelper.skyboxMaterial.microSurface = Math.max(0.01, 1.0 - b);
        }
      }
    });
  }

  /**
   * Initializes HDRI-to-CubeMap Background Converter
   * Converts spherical HDRI images into 4x3 cross cubemaps in the background
   */
  private initHdriToCubemapConverter() {
    this.cubemapStatusInfo = document.getElementById('cubemapStatusInfo');
    this.cubemapStatusText = document.getElementById('cubemapStatusText');
    this.btnDownloadCubemapHdr = document.getElementById('btnDownloadCubemapHdr');

    const fileInputConvertHdr = document.getElementById('fileInputConvertHdr') as HTMLInputElement;
    const btnConvertHdriToCubemap = document.getElementById('btnConvertHdriToCubemap');

    // Trigger file chooser for explicit conversion & loading
    btnConvertHdriToCubemap?.addEventListener('click', () => {
      if (fileInputConvertHdr) {
        fileInputConvertHdr.value = '';
        fileInputConvertHdr.click();
      }
    });

    fileInputConvertHdr?.addEventListener('change', async () => {
      if (fileInputConvertHdr.files && fileInputConvertHdr.files[0]) {
        await this.loadHdrFile(fileInputConvertHdr.files[0]);
      }
    });

    // Download button
    this.btnDownloadCubemapHdr?.addEventListener('click', () => {
      if (this.lastCubemapResult) {
        downloadBlob(this.lastCubemapResult.blob, this.lastCubemapResult.fileName);
        this.showToast(`⬇️ Download avviato: ${this.lastCubemapResult.fileName}`, 'success');
      }
    });
  }

  /**
   * Autonomous Ingestion & Background Conversion Pipeline for HDRI (.hdr / .exr) -> 4x3 Cross Cubemap saved in .hdr format
   */
  async processHdriToCubemap(
    file: File,
    faceSize: number = 512,
    autoDownload: boolean = false
  ): Promise<CubemapCrossResult | null> {
    if (this.isConvertingCubemap) {
      console.warn('Conversione Cubemap già in corso...');
      return null;
    }

    try {
      this.isConvertingCubemap = true;
      this.showToast(`🔄 Conversione in background di ${file.name} in Cubemap 4x3 (${faceSize}px)...`, 'info');

      // Run background conversion
      const result = await convertHdrToCubemapCross(file, file.name, faceSize);
      this.lastCubemapResult = result;

      // Update UI in sidebar accordion
      if (this.cubemapStatusInfo && this.cubemapStatusText) {
        this.cubemapStatusInfo.style.display = 'block';
        this.cubemapStatusText.textContent = `Cubemap attiva: ${result.fileName} (${result.width}×${result.height}px)`;
      }

      if (this.btnDownloadCubemapHdr) {
        this.btnDownloadCubemapHdr.style.display = 'block';
      }

      // Autonomous Download if requested by switch
      if (autoDownload) {
        downloadBlob(result.blob, result.fileName);
      }

      this.showToast(`✨ Cubemap 4x3 (${result.width}×${result.height}px) pronta per il download!`, 'success');
      return result;
    } catch (err: any) {
      console.error('HDRI to Cubemap conversion error:', err);
      this.showToast(`Errore conversione Cubemap: ${err.message || err}`, 'error');
      return null;
    } finally {
      this.isConvertingCubemap = false;
    }
  }

  setEnvironmentRotation(deg: number) {
    this.envSettings.rotationDeg = deg;
    const rad = BABYLON.Tools.ToRadians(deg);

    if (this.scene.environmentTexture) {
      this.scene.environmentTexture.rotationY = rad;
    }
    if (this.environmentHelper && this.environmentHelper.skybox) {
      this.environmentHelper.skybox.rotation.y = rad;
    }

    const sliderRot = document.getElementById('sliderEnvRotation') as HTMLInputElement;
    const valRot = document.getElementById('valEnvRotation');
    if (sliderRot) sliderRot.value = deg.toString();
    if (valRot) valRot.textContent = `${Math.round(deg)}°`;
  }

  private updateSkyboxVisibility() {
    if (!this.environmentHelper) return;

    if (this.envSettings.showSkybox) {
      if (this.environmentHelper.skybox) this.environmentHelper.skybox.setEnabled(true);
      if (this.environmentHelper.skyboxMaterial) {
        this.environmentHelper.skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        this.environmentHelper.skyboxMaterial.reflectionTexture = this.scene.environmentTexture;
      }
      this.scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.07, 1.0);
    } else {
      if (this.environmentHelper.skybox) this.environmentHelper.skybox.setEnabled(false);
      const isDark = document.body.classList.contains('theme-dark');
      this.scene.clearColor = isDark ? new BABYLON.Color4(0.06, 0.07, 0.09, 1.0) : new BABYLON.Color4(0.97, 0.98, 0.99, 1.0);
    }
  }

  /**
   * Universal Tone Mapping Synchronizer:
   * Synchronizes scene image processing, post-process pipeline, background skybox, ground,
   * and all PBR materials across the entire scene!
   */
  public applyToneMapping() {
    const chkTone = document.getElementById('chkEnableToneMapping') as HTMLInputElement;
    const selectTone = document.getElementById('quickToneMapping') as HTMLSelectElement;
    const sliderExp = document.getElementById('quickExposure') as HTMLInputElement;
    const valExp = document.getElementById('valQuickExposure');
    const sliderContrast = document.getElementById('sliderToneContrast') as HTMLInputElement;
    const valContrast = document.getElementById('valToneContrast');

    const enabled = chkTone ? chkTone.checked : true;
    const typeVal = selectTone ? parseInt(selectTone.value, 10) : 2;
    const expVal = sliderExp ? parseFloat(sliderExp.value) : 1.0;
    const contrastVal = sliderContrast ? parseFloat(sliderContrast.value) : 1.0;

    // 1. Scene Image Processing Configuration
    const ipc = this.scene.imageProcessingConfiguration;
    ipc.isEnabled = true;
    if (typeVal === -1 || !enabled) {
      ipc.toneMappingEnabled = false;
    } else {
      ipc.toneMappingEnabled = true;
      ipc.toneMappingType = typeVal;
    }
    ipc.exposure = expVal;
    ipc.contrast = contrastVal;

    // 2. Default Rendering Pipeline Image Processing
    if (this.defaultPipeline) {
      this.defaultPipeline.imageProcessingEnabled = true;
      if (this.defaultPipeline.imageProcessing) {
        this.defaultPipeline.imageProcessing.toneMappingEnabled = ipc.toneMappingEnabled;
        this.defaultPipeline.imageProcessing.toneMappingType = ipc.toneMappingType;
        this.defaultPipeline.imageProcessing.exposure = expVal;
        this.defaultPipeline.imageProcessing.contrast = contrastVal;
      }
    }

    // 3. Skybox & Ground Materials (BackgroundMaterial)
    if (this.environmentHelper) {
      if (this.environmentHelper.skyboxMaterial) {
        if (this.environmentHelper.skyboxMaterial.imageProcessingConfiguration) {
          this.environmentHelper.skyboxMaterial.imageProcessingConfiguration = ipc;
        }
      }
      if (this.environmentHelper.groundMaterial) {
        if (this.environmentHelper.groundMaterial.imageProcessingConfiguration) {
          this.environmentHelper.groundMaterial.imageProcessingConfiguration = ipc;
        }
      }
    }

    // 4. All Scene Materials
    for (const mat of this.scene.materials) {
      if (!mat) continue;
      if (mat instanceof BABYLON.PBRMaterial) {
        mat.imageProcessingConfiguration = ipc;
      }
    }

    // 5. Update UI readouts
    if (valExp) valExp.textContent = expVal.toFixed(2);
    if (valContrast) valContrast.textContent = contrastVal.toFixed(2);
  }

  /**
   * Tone Mapping Controls
   */
  private initToneMappingControls() {
    const chkTone = document.getElementById('chkEnableToneMapping') as HTMLInputElement;
    const selectTone = document.getElementById('quickToneMapping') as HTMLSelectElement;
    const sliderExp = document.getElementById('quickExposure') as HTMLInputElement;
    const sliderContrast = document.getElementById('sliderToneContrast') as HTMLInputElement;

    chkTone?.addEventListener('change', () => {
      this.applyToneMapping();
      this.showToast(chkTone.checked ? 'Tone Mapping abilitato' : 'Tone Mapping disabilitato (Lineare)', 'info');
    });

    selectTone?.addEventListener('change', () => {
      const val = parseInt(selectTone.value, 10);
      if (val === -1 && chkTone) chkTone.checked = false;
      else if (chkTone) chkTone.checked = true;
      this.applyToneMapping();
      this.showToast(`Tone Mapping: ${selectTone.options[selectTone.selectedIndex].text}`, 'info');
    });

    sliderExp?.addEventListener('input', () => {
      this.applyToneMapping();
    });

    sliderContrast?.addEventListener('input', () => {
      this.applyToneMapping();
    });

    // Run initial sync on page startup
    this.applyToneMapping();
  }

  /**
   * File Loader & Demo Product Buttons
   */
  private initFileLoaderButtons() {
    const fileInputGlb = document.getElementById('fileInputGlb') as HTMLInputElement;
    const browseGlb = () => {
      if (fileInputGlb) {
        fileInputGlb.value = '';
        fileInputGlb.click();
      }
    };

    document.getElementById('btnBrowseGlb')?.addEventListener('click', browseGlb);
    document.getElementById('btnBrowseGlbCentral')?.addEventListener('click', browseGlb);

    // Clicking anywhere on center dropzone box (outside sample button) triggers file browser
    this.centerDropzone?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id !== 'btnLoadDemoProduct' && !target.closest('#btnLoadDemoProduct')) {
        browseGlb();
      }
    });

    fileInputGlb?.addEventListener('change', async () => {
      if (fileInputGlb.files && fileInputGlb.files[0]) {
        await this.loadModelFile(fileInputGlb.files[0]);
      }
    });

    // Delete / Remove current model
    document.getElementById('btnRemoveModel')?.addEventListener('click', () => {
      if (this.modelRoot) {
        this.highlightLayer?.removeAllMeshes();
        this.modelRoot.dispose(false, false);
        this.modelRoot = null;
        this.centerDropzone?.classList.remove('hidden');
        const pill = document.getElementById('loadedFilePill');
        if (pill) pill.style.display = 'none';
        if (this.modelTitle) this.modelTitle.textContent = 'NESSUN MODELLO';
        if (this.footerFileName) this.footerFileName.textContent = 'Nessun file aperto';
        if (this.statMeshes) this.statMeshes.textContent = '0 mesh';
        if (this.statVerts) this.statVerts.textContent = '0 vertici';
        const meshTree = document.getElementById('meshTreeList');
        if (meshTree) meshTree.innerHTML = '<div class="tree-subnode-empty">Nessun modello caricato</div>';
        this.showToast('Modello rimosso dalla scena', 'info');
      }
    });

    // Load Demo Product
    document.getElementById('btnLoadDemoProduct')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const res = await fetch('/sample_product.glb');
        const blob = await res.blob();
        const file = new File([blob], 'sample_product.glb', { type: 'model/gltf-binary' });
        await this.loadModelFile(file);
      } catch (e: any) {
        this.showToast('Errore caricamento modello demo: ' + e.message, 'error');
      }
    });
  }

  private initTextureAssignModal() {
    const choiceButtons = document.querySelectorAll('.modal-slot-choices .btn-slot-choice');
    choiceButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const slot = btn.getAttribute('data-slot') as any;
        if (!this.pendingTextureDrop || !slot) return;
        const target = this.pendingTextureDrop;
        this.textureAssignModal.close();

        await this.assignTextureToMaterial(target.materialName, slot, target.file);
        this.showToast(`Texture "${target.file.name}" assegnata allo slot [${slot}] di "${target.materialName}"`, 'success');
        this.pendingTextureDrop = null;
      });
    });

    document.getElementById('btnCloseModal')?.addEventListener('click', () => {
      this.textureAssignModal.close();
      this.pendingTextureDrop = null;
    });
  }

  private initDragAndDrop() {
    let dragCounter = 0;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (dragCounter === 1 && this.dropOverlay) {
        this.dropOverlay.classList.add('active');
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0 || (e.clientX === 0 && e.clientY === 0) || !e.relatedTarget) {
        dragCounter = 0;
        if (this.dropOverlay) {
          this.dropOverlay.classList.remove('active');
        }
      }
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      if (this.dropOverlay) {
        this.dropOverlay.classList.remove('active');
      }

      if (this.isDropBusy) return;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      this.isDropBusy = true;
      try {
        const file = files[0];
        const ext = file.name.split('.').pop()?.toLowerCase() || '';

        console.log('📦 File rilasciato nel configuratore:', file.name, 'Estensione:', ext, 'Dimensione:', file.size);

        // 1. Modello 3D (.glb, .gltf)
        if (ext === 'glb' || ext === 'gltf') {
          await this.loadModelFile(file);
          return;
        }

        // 2. Ambiente HDRI (.hdr, .exr, .env, .dds)
        if (ext === 'hdr' || ext === 'exr' || ext === 'env' || ext === 'dds') {
          await this.loadHdrFile(file);
          return;
        }

        // 3. Texture Drop su mesh 3D
        if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tga'].includes(ext)) {
          const pick = this.scene.pick(e.clientX, e.clientY);
          if (pick && pick.hit && pick.pickedMesh && pick.pickedMesh.material) {
            const mesh = pick.pickedMesh;
            const mat = mesh.material;
            this.pendingTextureDrop = { file, materialName: mat.name, meshName: mesh.name };
            const targetBadge = document.getElementById('modalMeshTarget');
            if (targetBadge) targetBadge.textContent = `${mesh.name} (${mat.name})`;
            this.textureAssignModal.showModal();
          } else if (this.selectedMaterial) {
            this.pendingTextureDrop = { file, materialName: this.selectedMaterial.name, meshName: this.selectedMesh?.name || 'Selezione' };
            const targetBadge = document.getElementById('modalMeshTarget');
            if (targetBadge) targetBadge.textContent = this.selectedMaterial.name;
            this.textureAssignModal.showModal();
          } else {
            this.showToast('Trascina la texture direttamente su un oggetto 3D per assegnarla!', 'warning');
          }
        }
      } catch (err: any) {
        console.error('Drop error:', err);
        this.showToast(`Errore durante il rilascio del file: ${err.message || err}`, 'error');
      } finally {
        this.isDropBusy = false;
      }
    };

    // Attach with capture phase on window so nothing can stop drop events
    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('dragend', () => {
      dragCounter = 0;
      if (this.dropOverlay) {
        this.dropOverlay.classList.remove('active');
      }
    }, true);
    window.addEventListener('drop', onDrop, true);

    // Also prevent default on document to completely disable browser navigation on dropped files
    document.addEventListener('dragover', (e) => { e.preventDefault(); }, false);
    document.addEventListener('drop', (e) => { e.preventDefault(); }, false);
  }

  /**
   * HOT SWAP MODEL LOADER:
   * Keeps camera position, studio lights, tone mapping, anti-aliasing, and customized materials intact!
   */
  async loadModelFile(file: File) {
    if (this.isLoadingModel) return;
    this.isLoadingModel = true;

    try {
      this.showToast(`Caricamento ${file.name}...`, 'info');

      // 1. Snapshot current camera state
      if (this.camera) {
        this.cachedCamera = {
          alpha: this.camera.alpha,
          beta: this.camera.beta,
          radius: this.camera.radius,
          target: this.camera.target.clone()
        };
      }

      // 2. Snapshot current active materials
      if (this.modelRoot) {
        this.snapshotSceneMaterials();
      }

      // 3. Clean up the previous model
      if (this.modelRoot) {
        this.highlightLayer?.removeAllMeshes();
        this.modelRoot.dispose(false, false);
        this.modelRoot = null;
      }

      // 4. Read file into memory
      const ext = file.name.split('.').pop()?.toLowerCase();
      let result: any;

      if (ext === 'glb') {
        try {
          result = await BABYLON.SceneLoader.ImportMeshAsync('', '', file, this.scene);
        } catch (directErr) {
          console.warn('Direct File load failed, falling back to ArrayBuffer:', directErr);
          const buffer = await file.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          result = await BABYLON.SceneLoader.ImportMeshAsync('', '', uint8, this.scene, null, '.glb');
        }
      } else if (ext === 'gltf') {
        try {
          result = await BABYLON.SceneLoader.ImportMeshAsync('', '', file, this.scene);
        } catch {
          const text = await file.text();
          result = await BABYLON.SceneLoader.ImportMeshAsync('', '', 'data:' + text, this.scene, null, '.gltf');
        }
      } else {
        throw new Error('Formato non supportato. Trascina un file .glb o .gltf');
      }

      // 5. Build clean root node preserving GLTF hierarchy
      this.modelRoot = new BABYLON.TransformNode('ImportedModelRoot', this.scene);

      if (result.meshes && result.meshes.length > 0) {
        const gltfRoot = result.meshes[0];
        gltfRoot.parent = this.modelRoot;
      }

      let totalVerts = 0;
      let totalMeshes = 0;

      for (const mesh of result.meshes) {
        if (mesh.name === '__root__') continue;
        mesh.receiveShadows = true;

        if (mesh.computeWorldMatrix) mesh.computeWorldMatrix(true);
        if (mesh.refreshBoundingInfo) mesh.refreshBoundingInfo();

        if (mesh.getTotalVertices && typeof mesh.getTotalVertices === 'function') {
          totalVerts += mesh.getTotalVertices();
        }
        if (mesh.geometry) totalMeshes++;
      }

      // 6. Fix materials: enable double-sided lighting and backface culling safety, apply Anti-Aliasing
      let materialsMatched = 0;
      const scannedMaterials = new Set<string>();
      const allMaterialsList: any[] = [];

      for (const mesh of result.meshes) {
        if (!mesh.material) continue;

        const mats = mesh.material.subMaterials || [mesh.material];
        for (const mat of mats) {
          if (!mat || scannedMaterials.has(mat.name)) continue;
          scannedMaterials.add(mat.name);
          allMaterialsList.push(mat);

          // Prevent backface culling
          mat.backFaceCulling = false;
          mat.twoSidedLighting = true;

          // Enable Specular Anti-Aliasing (Toksvig / normal variance filtering for brushed metal)
          if (mat instanceof BABYLON.PBRMaterial) {
            mat.enableSpecularAntiAliasing = this.aaSettings.specularAa;
            mat.imageProcessingConfiguration = this.scene.imageProcessingConfiguration;
            mat.cameraToneMappingEnabled = this.scene.imageProcessingConfiguration.toneMappingEnabled;
            mat.cameraExposure = this.scene.imageProcessingConfiguration.exposure;
            mat.cameraContrast = this.scene.imageProcessingConfiguration.contrast;
          }

          if (mat.alpha === 1.0) {
            mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_OPAQUE;
          }

          // Cache original Blender properties
          this.blenderOriginals.set(mat.name, {
            albedoColor: mat.albedoColor ? mat.albedoColor.clone() : new BABYLON.Color3(1, 1, 1),
            roughness: mat.roughness ?? 0.5,
            metallic: mat.metallic ?? 0.0,
            emissiveColor: mat.emissiveColor ? mat.emissiveColor.clone() : new BABYLON.Color3(0, 0, 0),
            emissiveIntensity: mat.emissiveIntensity ?? 1.0,
            alpha: mat.alpha ?? 1.0,
            transparencyMode: mat.transparencyMode ?? 0,
            backFaceCulling: mat.backFaceCulling ?? false,
            clearCoatEnabled: mat.clearCoat ? mat.clearCoat.isEnabled : false,
            clearCoatIntensity: mat.clearCoat ? mat.clearCoat.intensity : 0.8,
            clearCoatRoughness: mat.clearCoat ? mat.clearCoat.roughness : 0.0,
            albedoTexture: mat.albedoTexture,
            bumpTexture: mat.bumpTexture,
            metallicTexture: mat.metallicTexture,
            emissiveTexture: mat.emissiveTexture,
            ambientTexture: mat.ambientTexture
          });

          // Re-apply customization if matched
          const override = this.materialOverrides.get(mat.name);
          if (override) {
            this.applyCustomizationToPBR(mat, override);
            materialsMatched++;
          }
        }
      }

      // Apply texture filtering (16x Anisotropic & Trilinear) to any newly loaded textures
      this.applyAnisotropicFilteringToAll(this.aaSettings.anisotropicLevel);
      const isTrilinear = this.aaSettings.samplingMode === 'trilinear';
      this.applySamplingModeToAll(isTrilinear ? BABYLON.Texture.TRILINEAR_SAMPLINGMODE : BABYLON.Texture.BILINEAR_SAMPLINGMODE);

      // Populate material selector dropdown
      this.populateMaterialDropdown(allMaterialsList);

      // Build hierarchical Nodes tree in left sidebar
      this.buildNodesTree(result.meshes);

      // Reselect previously selected material if exists
      if (this.selectedMaterial && scannedMaterials.has(this.selectedMaterial.name)) {
        const matchingMesh = result.meshes.find((m: any) => m.material && (m.material === this.selectedMaterial || m.material.name === this.selectedMaterial.name));
        if (matchingMesh) {
          this.selectMeshAndMaterial(matchingMesh, matchingMesh.material, false);
        }
      }

      // Re-aim studio lights
      this.updateRectLightTransform();

      // Register shadow casters
      if (this.shadowGenerator) {
        for (const m of this.modelRoot.getChildMeshes()) {
          this.shadowGenerator.addShadowCaster(m);
        }
      }

      // 7. Camera handling: restore previous framing if hot swapping, or frame if first model
      if (this.cachedCamera && this.cachedCamera.radius > 0.05) {
        this.camera.alpha = this.cachedCamera.alpha;
        this.camera.beta = this.cachedCamera.beta;
        this.camera.radius = this.cachedCamera.radius;
        this.camera.setTarget(this.cachedCamera.target);
      } else {
        this.frameModel();
      }

      // 8. Sync Tone Mapping to all newly loaded materials
      this.applyToneMapping();

      // 9. Update UI badges and stats
      this.centerDropzone?.classList.add('hidden');
      const loadedFilePill = document.getElementById('loadedFilePill');
      if (loadedFilePill) loadedFilePill.style.display = 'flex';
      if (this.modelTitle) this.modelTitle.textContent = file.name.toUpperCase().replace(/\.[^/.]+$/, '');
      if (this.footerFileName) this.footerFileName.textContent = file.name;
      if (this.statMeshes) this.statMeshes.textContent = `${totalMeshes} mesh`;
      if (this.statVerts) this.statVerts.textContent = `${totalVerts.toLocaleString()} vertici`;

      if (materialsMatched > 0) {
        this.showToast(`✨ Modello aggiornato! ${materialsMatched} materiali ripristinati. Scena e camera intatte.`, 'success');
      } else {
        this.showToast(`✨ Modello ${file.name} caricato (${totalMeshes} parti, ${allMaterialsList.length} materiali).`, 'success');
      }
    } catch (err: any) {
      console.error('Import error:', err);
      this.showToast(`Errore caricamento modello: ${err.message || err}`, 'error');
    } finally {
      this.isLoadingModel = false;
    }
  }

  private snapshotSceneMaterials() {
    if (!this.modelRoot) return;

    const meshes = this.modelRoot.getChildMeshes();
    for (const mesh of meshes) {
      if (!mesh.material) continue;
      const mats = mesh.material.subMaterials || [mesh.material];
      for (const mat of mats) {
        if (!mat || !mat.name) continue;

        const current: MaterialCustomization = this.materialOverrides.get(mat.name) || {};

        if (mat.albedoColor) current.albedoColor = mat.albedoColor.clone ? mat.albedoColor.clone() : mat.albedoColor;
        if (mat.roughness !== undefined) current.roughness = mat.roughness;
        if (mat.metallic !== undefined) current.metallic = mat.metallic;
        if (mat.emissiveColor) current.emissiveColor = mat.emissiveColor.clone ? mat.emissiveColor.clone() : mat.emissiveColor;
        if (mat.emissiveIntensity !== undefined) current.emissiveIntensity = mat.emissiveIntensity;
        if (mat.alpha !== undefined) current.alpha = mat.alpha;
        if (mat.transparencyMode !== undefined) current.transparencyMode = mat.transparencyMode;
        if (mat.backFaceCulling !== undefined) current.backFaceCulling = mat.backFaceCulling;

        if (mat.clearCoat) {
          current.clearCoatEnabled = mat.clearCoat.isEnabled;
          current.clearCoatIntensity = mat.clearCoat.intensity;
          current.clearCoatRoughness = mat.clearCoat.roughness;
        }

        if (mat.albedoTexture) current.albedoTexture = mat.albedoTexture;
        if (mat.bumpTexture) current.bumpTexture = mat.bumpTexture;
        if (mat.metallicTexture) current.metallicTexture = mat.metallicTexture;
        if (mat.emissiveTexture) current.emissiveTexture = mat.emissiveTexture;
        if (mat.ambientTexture) current.ambientTexture = mat.ambientTexture;

        this.materialOverrides.set(mat.name, current);
      }
    }
  }

  private applyCustomizationToPBR(mat: any, custom: MaterialCustomization) {
    if (custom.albedoColor && mat.albedoColor) {
      if (typeof custom.albedoColor === 'string') {
        mat.albedoColor = BABYLON.Color3.FromHexString(custom.albedoColor);
      } else if (custom.albedoColor.clone) {
        mat.albedoColor = custom.albedoColor.clone();
      }
    }
    if (custom.roughness !== undefined && mat.roughness !== undefined) {
      mat.roughness = custom.roughness;
    }
    if (custom.metallic !== undefined && mat.metallic !== undefined) {
      mat.metallic = custom.metallic;
    }
    if (custom.emissiveColor && mat.emissiveColor) {
      if (typeof custom.emissiveColor === 'string') {
        mat.emissiveColor = BABYLON.Color3.FromHexString(custom.emissiveColor);
      } else if (custom.emissiveColor.clone) {
        mat.emissiveColor = custom.emissiveColor.clone();
      }
    }
    if (custom.emissiveIntensity !== undefined && mat.emissiveIntensity !== undefined) {
      mat.emissiveIntensity = custom.emissiveIntensity;
    }
    if (custom.alpha !== undefined && mat.alpha !== undefined) {
      mat.alpha = custom.alpha;
    }
    if (custom.transparencyMode !== undefined) {
      mat.transparencyMode = custom.transparencyMode;
    }

    if (custom.backFaceCulling !== undefined) {
      mat.backFaceCulling = custom.backFaceCulling;
      mat.twoSidedLighting = !custom.backFaceCulling;
    }

    if (custom.clearCoatEnabled !== undefined && mat.clearCoat) {
      mat.clearCoat.isEnabled = custom.clearCoatEnabled;
      if (custom.clearCoatIntensity !== undefined) mat.clearCoat.intensity = custom.clearCoatIntensity;
      if (custom.clearCoatRoughness !== undefined) mat.clearCoat.roughness = custom.clearCoatRoughness;
    }

    if (custom.albedoTexture) mat.albedoTexture = custom.albedoTexture;
    if (custom.bumpTexture) mat.bumpTexture = custom.bumpTexture;
    if (custom.metallicTexture) {
      mat.metallicTexture = custom.metallicTexture;
      mat.useRoughnessFromMetallicTextureAlpha = false;
      mat.useRoughnessFromMetallicTextureGreen = true;
      mat.useMetallnessFromMetallicTextureBlue = true;
    }
    if (custom.emissiveTexture) mat.emissiveTexture = custom.emissiveTexture;
    if (custom.ambientTexture) mat.ambientTexture = custom.ambientTexture;
  }

  private recordMaterialOverride(matName: string, partial: Partial<MaterialCustomization>) {
    const existing = this.materialOverrides.get(matName) || {};
    this.materialOverrides.set(matName, { ...existing, ...partial });
    this.saveCachedOverrides();
  }

  async assignTextureToMaterial(
    materialName: string,
    slot: 'albedo' | 'bump' | 'metallicRoughness' | 'emissive' | 'ambient',
    file: File
  ) {
    const dataUrl = await this.fileToDataUrl(file);
    const mat = this.scene.getMaterialByName(materialName);
    const tex = new BABYLON.Texture(dataUrl, this.scene);

    tex.anisotropicFilteringLevel = this.aaSettings.anisotropicLevel;
    if (this.aaSettings.samplingMode === 'trilinear') {
      tex.updateSamplingMode(BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    }

    if (mat) {
      switch (slot) {
        case 'albedo':
          mat.albedoTexture = tex;
          break;
        case 'bump':
          mat.bumpTexture = tex;
          break;
        case 'metallicRoughness':
          mat.metallicTexture = tex;
          mat.useRoughnessFromMetallicTextureAlpha = false;
          mat.useRoughnessFromMetallicTextureGreen = true;
          mat.useMetallnessFromMetallicTextureBlue = true;
          break;
        case 'emissive':
          mat.emissiveTexture = tex;
          break;
        case 'ambient':
          mat.ambientTexture = tex;
          break;
      }
    }

    const existing: MaterialCustomization = this.materialOverrides.get(materialName) || {};
    if (slot === 'albedo') existing.albedoTexture = tex;
    if (slot === 'bump') existing.bumpTexture = tex;
    if (slot === 'metallicRoughness') existing.metallicTexture = tex;
    if (slot === 'emissive') existing.emissiveTexture = tex;
    if (slot === 'ambient') existing.ambientTexture = tex;

    this.materialOverrides.set(materialName, existing);
    this.saveCachedOverrides();
  }

  /**
   * Loads Environment: supports .EXR (on the fly conversion), .HDR, .ENV, and .DDS!
   */
  async loadHdrFile(file: File) {
    try {
      this.showToast(`Caricamento ${file.name}...`, 'info');
      const ext = file.name.split('.').pop()?.toLowerCase();

      const onLoadedEnvironment = (customTex: any, label: string) => {
        // Safely dispose previously loaded custom environment texture (if any and different)
        if (this.currentCustomEnvTexture && this.currentCustomEnvTexture !== customTex) {
          try {
            this.currentCustomEnvTexture.dispose();
          } catch (err) {
            console.warn('Previous env texture dispose warning:', err);
          }
        }
        this.currentCustomEnvTexture = customTex;

        // Apply new environment texture to scene
        this.scene.environmentTexture = customTex;

        // Update skybox reflection texture without disposing or resetting background meshes
        if (this.environmentHelper && this.environmentHelper.skyboxMaterial) {
          this.environmentHelper.skyboxMaterial.reflectionTexture = customTex;
        }

        // Update SSR pipeline
        if (this.ssrPipeline) {
          this.ssrPipeline.environmentTexture = customTex;
        }

        // Mark active PBR materials texture bindings dirty so they immediately pick up new lighting
        for (const mat of this.scene.materials) {
          if (mat instanceof BABYLON.PBRMaterial) {
            mat.markAsDirty(BABYLON.Constants.MATERIAL_TextureDirtyFlag);
          }
        }

        this.setEnvironmentRotation(this.envSettings.rotationDeg);
        this.updateSkyboxVisibility();
        this.applyToneMapping();
        this.showToast(label, 'success');
      };

      if (ext === 'hdr' || ext === 'exr') {
        const selectSize = document.getElementById('selectCubemapFaceSize') as HTMLSelectElement;
        const faceSize = parseInt(selectSize?.value || '512', 10);
        const chkAutoConvert = document.getElementById('chkAutoConvertCubemapHdr') as HTMLInputElement;
        const autoDownload = chkAutoConvert?.checked || false;

        let hdrBuffer: ArrayBuffer;
        if (ext === 'exr') {
          this.showToast(`Conversione EXR in corso per ${file.name}...`, 'info');
          const buffer = await file.arrayBuffer();
          const hdrBlob = convertExrToHdrBlob(buffer);
          hdrBuffer = await hdrBlob.arrayBuffer();
        } else {
          hdrBuffer = await file.arrayBuffer();
        }

        // Decode HDR header & check dimensions
        const decoded = decodeHdr(hdrBuffer);
        const isCross = isCubemapCross(decoded.width, decoded.height);

        let envBlobUrl: string;
        let successLabel: string;

        if (isCross) {
          // Already a 4x3 Cross Cubemap: convert cross to equirectangular blob for Babylon's HDRCubeTexture
          this.showToast(`✨ Cubemap 4x3 (${decoded.width}×${decoded.height}px) rilevata! Applicazione illuminazione...`, 'info');
          const equiBlob = convertCubemapCrossToEquirectangularBlob(decoded.data, decoded.width, decoded.height, 2048, 1024);
          envBlobUrl = URL.createObjectURL(equiBlob);
          successLabel = `🌅 Cubemap 4x3 ${file.name} applicata all'ambiente 3D!`;

          this.lastCubemapResult = {
            blob: new Blob([hdrBuffer], { type: 'image/vnd.radiance' }),
            fileName: file.name,
            width: decoded.width,
            height: decoded.height,
            faceSize: Math.floor(decoded.width / 4),
            floatData: decoded.data,
            rgbeData: new Uint8Array(0)
          };

          if (this.cubemapStatusInfo && this.cubemapStatusText) {
            this.cubemapStatusInfo.style.display = 'block';
            this.cubemapStatusText.textContent = `Cubemap attiva: ${file.name} (${decoded.width}×${decoded.height}px)`;
          }
          if (this.btnDownloadCubemapHdr) {
            this.btnDownloadCubemapHdr.style.display = 'block';
          }
        } else {
          // Spherical equirectangular panorama: load into Babylon, and convert to 4x3 Cubemap in background
          const hdrBlob = new Blob([hdrBuffer], { type: 'image/vnd.radiance' });
          envBlobUrl = URL.createObjectURL(hdrBlob);
          successLabel = `🌅 Mappa HDR caricata e convertita in Cubemap per l'illuminazione!`;

          // Launch background conversion to 4x3 cross cubemap
          this.processHdriToCubemap(file, faceSize, autoDownload);
        }

        // Load into Babylon's HDRCubeTexture with prefiltering for PBR specular reflections
        const customTex = new BABYLON.HDRCubeTexture(
          envBlobUrl,
          this.scene,
          faceSize,
          false,
          true,
          false,
          true,
          () => {
            onLoadedEnvironment(customTex, successLabel);
          },
          (msg: any) => {
            console.error('HDRCubeTexture error:', msg);
            this.showToast('Errore durante il caricamento del file HDR', 'error');
          }
        );
      } else {
        // .env or .dds prefiltered data
        const forcedExt = ext === 'dds' ? '.dds' : '.env';
        const blobUrl = URL.createObjectURL(file);
        const customTex = BABYLON.CubeTexture.CreateFromPrefilteredData(blobUrl, this.scene, forcedExt, true);

        if (customTex.isReady && customTex.isReady()) {
          onLoadedEnvironment(customTex, `🌅 Ambiente ${file.name} applicato!`);
        } else if (customTex.onLoadObservable) {
          customTex.onLoadObservable.addOnce(() => {
            onLoadedEnvironment(customTex, `🌅 Ambiente ${file.name} applicato!`);
          });
        } else {
          onLoadedEnvironment(customTex, `🌅 Ambiente ${file.name} applicato!`);
        }
      }
    } catch (e: any) {
      console.error(e);
      this.showToast(`Errore caricamento HDRI/EXR: ${e.message}`, 'error');
    }
  }

  async exportGlb() {
    try {
      if (!this.modelRoot) {
        this.showToast('Nessun modello presente nella scena da esportare!', 'warning');
        return;
      }

      this.showToast('Esportazione GLB in corso (solo geometrie visibili)...', 'info');
      const filename = (this.modelTitle.textContent || 'modello').replace(/\.[^/.]+$/, '').trim() + '_custom';

      // Check if a mesh has actual visible geometry
      const isVisibleGeometryMesh = (node: any): boolean => {
        if (!node) return false;
        if (typeof node.isEnabled === 'function' && !node.isEnabled()) return false;
        if ('isVisible' in node && node.isVisible === false) return false;
        return !!(node.geometry && node.geometry.getTotalVertices() > 0);
      };

      // Check if node belongs to the loaded product model hierarchy
      const isDescendantOfModelRoot = (node: any): boolean => {
        if (!this.modelRoot || !node) return false;
        if (node === this.modelRoot) return true;
        let parent = node.parent;
        while (parent) {
          if (parent === this.modelRoot) return true;
          parent = parent.parent;
        }
        return false;
      };

      const shouldExportNode = (node: any): boolean => {
        // 1. Strictly exclude anything outside the product model root
        if (!node || !isDescendantOfModelRoot(node)) return false;

        // 2. Check if node itself is disabled (isEnabled = false) or hidden (isVisible = false)
        if (typeof node.isEnabled === 'function' && !node.isEnabled()) return false;
        if ('isVisible' in node && node.isVisible === false) return false;

        // 3. Exclude scene utilities, lights, cameras, helpers, softbox, lookdev
        const name = (node.name || '').toLowerCase();
        if (name.includes('skybox') || name.includes('ground') || name.includes('environment') || 
            name.includes('lookdev') || name.includes('softbox') || name.includes('light') || 
            name.includes('camera') || name.includes('gizmo')) {
          return false;
        }

        // 4. If it has geometry, ensure it is enabled and visible
        if (node.geometry) {
          return isVisibleGeometryMesh(node);
        }

        // 5. If it's a transform node (e.g. parent container), only export if it has at least one visible child geometry
        if (typeof node.getChildMeshes === 'function') {
          const visibleChildren = node.getChildMeshes(false, (child: any) => isVisibleGeometryMesh(child));
          return visibleChildren && visibleChildren.length > 0;
        }

        return false;
      };

      const glb = await BABYLON.GLTF2Export.GLBAsync(this.scene, filename, {
        shouldExportNode
      });

      glb.downloadFiles();
      this.showToast('✅ File GLB esportato con successo (solo geometrie visibili)!', 'success');
    } catch (e: any) {
      console.error('Export error:', e);
      this.showToast(`Errore esportazione: ${e.message}`, 'error');
    }
  }

  frameModel() {
    if (!this.modelRoot) return;

    const meshes = this.modelRoot.getChildMeshes();
    if (meshes.length === 0) return;

    let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    for (const m of meshes) {
      if (!m.isVisible || !m.isEnabled()) continue;
      const bInfo = m.getBoundingInfo();
      min = BABYLON.Vector3.Minimize(min, bInfo.boundingBox.minimumWorld);
      max = BABYLON.Vector3.Maximize(max, bInfo.boundingBox.maximumWorld);
    }

    const center = BABYLON.Vector3.Center(min, max);
    const distance = BABYLON.Vector3.Distance(min, max);

    this.camera.setTarget(center);
    this.camera.radius = Math.max(distance * 1.5, 0.5);
    this.camera.lowerRadiusLimit = Math.max(distance * 0.02, 0.02);
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

    toast.innerHTML = `<span>${iconMap[type]}</span><span>${message}</span>`;
    this.toastContainer?.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  private saveCachedOverrides() {
    try {
      const serializable: Record<string, any> = {};
      this.materialOverrides.forEach((val, key) => {
        serializable[key] = {
          albedoColor: val.albedoColor ? (val.albedoColor.toHexString ? val.albedoColor.toHexString() : val.albedoColor) : undefined,
          roughness: val.roughness,
          metallic: val.metallic,
          emissiveColor: val.emissiveColor ? (val.emissiveColor.toHexString ? val.emissiveColor.toHexString() : val.emissiveColor) : undefined,
          emissiveIntensity: val.emissiveIntensity,
          alpha: val.alpha,
          transparencyMode: val.transparencyMode,
          backFaceCulling: val.backFaceCulling,
          clearCoatEnabled: val.clearCoatEnabled,
          clearCoatIntensity: val.clearCoatIntensity,
          clearCoatRoughness: val.clearCoatRoughness
        };
      });
      localStorage.setItem('babylon_hotswap_overrides', JSON.stringify(serializable));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  private loadCachedOverrides() {
    try {
      const saved = localStorage.getItem('babylon_hotswap_overrides');
      if (saved) {
        const obj = JSON.parse(saved);
        for (const [key, val] of Object.entries(obj)) {
          this.materialOverrides.set(key, val as MaterialCustomization);
        }
      }
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
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

// Bootstrap when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  (window as any).app = new BabylonHotSwapSandbox();
  console.log('🪐 TREDO Studio Babylon Configurator ready!');
});

