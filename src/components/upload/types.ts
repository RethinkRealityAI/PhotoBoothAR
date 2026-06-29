/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared types for the guest "Upload to Wall" flow.
 */
import { UploadCrop } from '../booth/capture';

export interface UploadItem {
  id: string;
  file: File;
  kind: 'image' | 'video';
  srcUrl: string;            // object URL (revoke when removed / on unmount)
  naturalW?: number;
  naturalH?: number;
  frameId: string | null;    // catalog Experience id; null = no frame
  crop: UploadCrop;
  message: string;
}
