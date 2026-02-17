/**
 * Camera configuration and hierarchy for ViMax pipeline.
 *
 * Ported from: vimax/interfaces/camera.py
 */

export enum CameraType {
  MAIN = 'main',
  SECONDARY = 'secondary',
  DETAIL = 'detail',
  ACTION = 'action',
  DIALOGUE = 'dialogue',
}

export interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

export interface CameraConfig {
  camera_id: string;
  camera_type: CameraType;
  position: CameraPosition;
  look_at?: CameraPosition;
  focal_length: number;
  aperture: number;
  movement_type: string;
  movement_speed: number;
  settings: Record<string, unknown>;
}

export interface CameraHierarchy {
  scene_id: string;
  primary_camera: CameraConfig;
  secondary_cameras: CameraConfig[];
}

// -- Factory helpers --

export function createCameraPosition(
  partial?: Partial<CameraPosition>,
): CameraPosition {
  return { x: 0, y: 0, z: 0, ...partial };
}

export function createCameraConfig(
  partial: Partial<CameraConfig> & { camera_id: string },
): CameraConfig {
  return {
    camera_type: CameraType.MAIN,
    position: createCameraPosition(),
    focal_length: 50.0,
    aperture: 2.8,
    movement_type: 'static',
    movement_speed: 1.0,
    settings: {},
    ...partial,
  };
}

// -- Computed helpers --

export function getCameraFromHierarchy(
  hierarchy: CameraHierarchy,
  cameraId: string,
): CameraConfig | undefined {
  if (hierarchy.primary_camera.camera_id === cameraId) {
    return hierarchy.primary_camera;
  }
  return hierarchy.secondary_cameras.find((c) => c.camera_id === cameraId);
}

export function getAllCameras(hierarchy: CameraHierarchy): CameraConfig[] {
  return [hierarchy.primary_camera, ...hierarchy.secondary_cameras];
}
