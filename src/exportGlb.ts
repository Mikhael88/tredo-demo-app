import { Scene, Node } from '@babylonjs/core';
import { GLTF2Export } from '@babylonjs/serializers/glTF/2.0';

export async function exportSceneToGlb(scene: Scene, defaultName = 'model_customized'): Promise<void> {
  try {
    const glb = await GLTF2Export.GLBAsync(scene, defaultName, {
      shouldExportNode: (node: Node) => {
        const name = node.name.toLowerCase();
        // Exclude environment helper meshes like skybox, ground, background plane
        if (
          name.includes('skybox') ||
          name.includes('ground') ||
          name.includes('background') ||
          name.includes('environment') ||
          name.includes('light')
        ) {
          return false;
        }
        return true;
      }
    });

    glb.downloadFiles();
  } catch (err) {
    console.error('Failed to export GLB:', err);
    throw err;
  }
}
