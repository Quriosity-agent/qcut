import { cn } from "@/lib/utils";
import {
  APERTURE_OPTIONS,
  CAMERAS,
  FOCAL_LENGTHS,
  LENSES,
  useCameraSelectorStore,
  type ApertureOption,
  type CameraBody,
  type Lens,
} from "@/stores/camera-selector-store";
import { ScrollTrack } from "./scroll-track";

function CameraItem({ cam, selected }: { cam: CameraBody; selected: boolean }) {
  return (
    <>
      <div className="w-[52px] h-[52px] flex items-center justify-center">
        <img
          src={cam.img}
          alt={cam.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
      <span className="text-[8px] text-muted-foreground/60 tracking-[0.5px] bg-white/5 px-1.5 py-px rounded">
        {cam.type}
      </span>
      <span
        className={cn(
          "text-[11px] font-medium transition-colors",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {cam.name}
      </span>
    </>
  );
}

function LensItem({ lens, selected }: { lens: Lens; selected: boolean }) {
  return (
    <>
      <div className="w-[52px] h-[52px] flex items-center justify-center">
        <img
          src={lens.img}
          alt={lens.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
      <span className="text-[8px] text-muted-foreground/60 tracking-[0.5px] bg-white/5 px-1.5 py-px rounded">
        {lens.type}
      </span>
      <span
        className={cn(
          "text-[11px] font-medium transition-colors",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {lens.name}
      </span>
    </>
  );
}

function FocalItem({ focal, selected }: { focal: number; selected: boolean }) {
  return (
    <>
      <span
        className={cn(
          "text-[28px] font-light leading-tight transition-colors",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {focal}
      </span>
      <span className="text-[10px] text-muted-foreground/60">mm</span>
    </>
  );
}

function ApertureItem({
  apt,
  selected,
}: {
  apt: ApertureOption;
  selected: boolean;
}) {
  return (
    <>
      <div className="w-[44px] h-[44px] rounded-full overflow-hidden">
        <img
          src={apt.img}
          alt={apt.label}
          className="w-full h-full object-cover"
        />
      </div>
      <span
        className={cn(
          "text-[11px] font-medium transition-colors",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {apt.label}
      </span>
    </>
  );
}

export function CameraSelectorView() {
  const {
    cameraIndex,
    lensIndex,
    focalIndex,
    apertureIndex,
    setCameraIndex,
    setLensIndex,
    setFocalIndex,
    setApertureIndex,
  } = useCameraSelectorStore();

  const selectedCamera = CAMERAS[cameraIndex];
  const selectedFocal = FOCAL_LENGTHS[focalIndex];

  return (
    <div className="p-4" data-testid="camera-selector-panel">
      {/* Current Setup Display */}
      <div className="flex items-center justify-center gap-5 p-4 bg-muted/40 rounded-xl mb-4">
        <div className="w-14 h-14">
          <img
            src={selectedCamera.img}
            alt={selectedCamera.name}
            className="w-full h-full object-contain brightness-[0.85]"
          />
        </div>
        <span className="text-[42px] font-light text-muted-foreground">
          {selectedFocal}
        </span>
      </div>

      {/* Camera Track */}
      <ScrollTrack
        label="Camera"
        items={CAMERAS}
        selectedIndex={cameraIndex}
        onSelect={setCameraIndex}
        renderItem={(cam, _i, sel) => <CameraItem cam={cam} selected={sel} />}
      />

      {/* Lens Track */}
      <ScrollTrack
        label="Lens"
        items={LENSES}
        selectedIndex={lensIndex}
        onSelect={setLensIndex}
        renderItem={(lens, _i, sel) => <LensItem lens={lens} selected={sel} />}
      />

      {/* Focal Length Track */}
      <ScrollTrack
        label="Focal Length"
        items={FOCAL_LENGTHS}
        selectedIndex={focalIndex}
        onSelect={setFocalIndex}
        renderItem={(focal, _i, sel) => (
          <FocalItem focal={focal} selected={sel} />
        )}
      />

      {/* Aperture Track */}
      <ScrollTrack
        label="Aperture"
        items={APERTURE_OPTIONS}
        selectedIndex={apertureIndex}
        onSelect={setApertureIndex}
        renderItem={(apt, _i, sel) => <ApertureItem apt={apt} selected={sel} />}
      />
    </div>
  );
}
