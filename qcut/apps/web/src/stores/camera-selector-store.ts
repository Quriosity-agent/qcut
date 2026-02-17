import { create } from "zustand";
import { buildCameraPrompt } from "@/lib/camera-prompt-builder";

// ── Types ──────────────────────────────────────────────

export interface CameraBody {
  name: string;
  type: "DIGITAL" | "FILM";
  img: string;
}

export interface Lens {
  name: string;
  type: "SPHERICAL" | "ANAMORPHIC" | "SPECIAL";
  img: string;
}

export interface ApertureOption {
  label: string;
  img: string;
}

// ── Static data ────────────────────────────────────────

const IMG = "/images/camera-selector";

export const CAMERAS: CameraBody[] = [
  { name: "Red V-Raptor", type: "DIGITAL", img: `${IMG}/red-v-raptor.webp` },
  { name: "Sony Venice", type: "DIGITAL", img: `${IMG}/sony-venice.webp` },
  {
    name: "IMAX Film Camera",
    type: "FILM",
    img: `${IMG}/imax-film-camera.webp`,
  },
  {
    name: "Arri Alexa 35",
    type: "DIGITAL",
    img: `${IMG}/arri-alexa-35.webp`,
  },
  { name: "Arriflex 16SR", type: "FILM", img: `${IMG}/arriflex-16sr.webp` },
  {
    name: "Panavision Millennium DXL2",
    type: "FILM",
    img: `${IMG}/panavision-dxl2.webp`,
  },
];

export const LENSES: Lens[] = [
  { name: "Helios", type: "SPHERICAL", img: `${IMG}/helios.webp` },
  {
    name: "ARRI Signature",
    type: "SPHERICAL",
    img: `${IMG}/arri-signature-prime.webp`,
  },
  { name: "Cooke S4", type: "SPHERICAL", img: `${IMG}/cooke-s4.webp` },
  { name: "Hawk V-Lite", type: "ANAMORPHIC", img: `${IMG}/hawk-v-lite.webp` },
  { name: "Canon K-35", type: "SPHERICAL", img: `${IMG}/canon-k35.webp` },
  {
    name: "Panavision C",
    type: "ANAMORPHIC",
    img: `${IMG}/panavision-c-series.webp`,
  },
  {
    name: "Zeiss Ultra Prime",
    type: "SPHERICAL",
    img: `${IMG}/zeiss-ultra-prime.webp`,
  },
  { name: "Petzval", type: "SPHERICAL", img: `${IMG}/petzval.webp` },
  { name: "Lensbaby", type: "SPECIAL", img: `${IMG}/lensbaby.webp` },
  { name: "Laowa Macro", type: "SPHERICAL", img: `${IMG}/laowa-macro.webp` },
  {
    name: "JDC Xtal Xpress",
    type: "ANAMORPHIC",
    img: `${IMG}/jdc-xtal-xpress.webp`,
  },
];

export const FOCAL_LENGTHS: number[] = [8, 14, 35, 50];

export const APERTURE_OPTIONS: ApertureOption[] = [
  { label: "f/1.4", img: `${IMG}/aperture-f1.4.webp` },
  { label: "f/4", img: `${IMG}/aperture-f4.webp` },
  { label: "f/11", img: `${IMG}/aperture-f11.webp` },
];

// ── Store ──────────────────────────────────────────────

interface CameraSelectorState {
  cameraIndex: number;
  lensIndex: number;
  focalIndex: number;
  apertureIndex: number;
  setCameraIndex: (i: number) => void;
  setLensIndex: (i: number) => void;
  setFocalIndex: (i: number) => void;
  setApertureIndex: (i: number) => void;
  getCameraPrompt: (subject?: string) => string;
}

export const useCameraSelectorStore = create<CameraSelectorState>(
  (set, get) => ({
    cameraIndex: 0,
    lensIndex: 0,
    focalIndex: 3,
    apertureIndex: 0,
    setCameraIndex: (i) => set({ cameraIndex: i }),
    setLensIndex: (i) => set({ lensIndex: i }),
    setFocalIndex: (i) => set({ focalIndex: i }),
    setApertureIndex: (i) => set({ apertureIndex: i }),
    getCameraPrompt: (subject?: string): string => {
      const { cameraIndex, lensIndex, focalIndex, apertureIndex } = get();
      return buildCameraPrompt({
        cameraIndex,
        lensIndex,
        focalIndex,
        apertureIndex,
        subject,
      });
    },
  })
);
