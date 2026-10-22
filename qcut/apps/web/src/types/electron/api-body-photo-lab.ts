export type {
	BodyPhotoLabAPI,
	BodyPhotoLabStatus,
} from "../../../../../electron/body-photo/body-photo-contract";
import type { BodyPhotoLabAPI } from "../../../../../electron/body-photo/body-photo-contract";

export interface ElectronBodyPhotoLabOps {
	bodyPhotoLab?: BodyPhotoLabAPI;
}
