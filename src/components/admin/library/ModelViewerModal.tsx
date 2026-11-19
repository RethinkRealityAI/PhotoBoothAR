/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full-size look at a library piece: drag to spin, pinch or scroll to zoom.
 * Uses the Studio's own ModelPreview (same loader, same lighting rig the guest
 * booth uses), so what the admin judges here is what a guest will see. A piece
 * with no 3D model (a frame, a filter) shows its picture instead.
 */
import { Box } from 'lucide-react';
import Modal from '../../ui/Modal';
import { ModelPreview } from '../../studio/DirectorCards';

export interface ViewerTarget {
  title: string;
  modelUrl: string | null;
  picture: string | null;
  note?: string;
}

export default function ModelViewerModal({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  return (
    <Modal title={target.title} onClose={onClose} maxWidthClass="max-w-3xl">
      {target.modelUrl ? (
        <>
          <ModelPreview url={target.modelUrl} height={Math.round(Math.min(560, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.58))} />
          <p className="mt-3 font-sans text-xs text-brand-muted/60">Drag to spin. Pinch or scroll to zoom.</p>
        </>
      ) : target.picture ? (
        <div className="rounded-xl border border-white/10 bg-[#05060B] flex items-center justify-center p-4">
          <img src={target.picture} alt="" className="max-h-[58vh] w-auto object-contain" />
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-10 text-center text-brand-muted/60">
          <Box className="w-8 h-8 mx-auto mb-2" aria-hidden />
          <p className="font-sans text-sm">Nothing to show for this one yet.</p>
        </div>
      )}
      {target.note && <p className="mt-3 font-sans text-xs text-brand-muted/60 leading-relaxed">{target.note}</p>}
    </Modal>
  );
}
