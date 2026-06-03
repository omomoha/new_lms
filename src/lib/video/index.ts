/**
 * Canonical export for VideoService.
 * Swap the implementation class here to change video provider globally.
 */
import { FirebaseStorageVideoService } from "./FirebaseStorageVideoService";
import type { VideoService } from "./VideoService";

export const videoService: VideoService = new FirebaseStorageVideoService();
export type { VideoService, UploadProgress } from "./VideoService";
