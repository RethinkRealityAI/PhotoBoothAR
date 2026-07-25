import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamRecorder } from './recorder';

// StreamRecorder wiring tests (gate-0: default bitrate 10→5 Mbps + onError
// surfacing). pickVideoMimeType selection itself is covered in recorder.test.ts;
// here MediaRecorder/HTMLCanvasElement are stubbed so start() runs in node.

class FakeMediaRecorder {
  static supported: string[] = [];
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(t: string) {
    return FakeMediaRecorder.supported.includes(t);
  }
  state: 'recording' | 'inactive' = 'inactive';
  ondataavailable: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    public options: MediaRecorderOptions,
  ) {
    FakeMediaRecorder.instances.push(this);
  }
  start(_timesliceMs?: number) {
    this.state = 'recording';
  }
  requestData() {}
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

class FakeCanvas {}
(FakeCanvas.prototype as unknown as { captureStream: () => unknown }).captureStream = () => ({});

const globals = globalThis as unknown as { MediaRecorder?: unknown; HTMLCanvasElement?: unknown };
const fakeStream = {} as MediaStream;

/** start() arms real interval/timeout timers — track recorders and dispose. */
const live: StreamRecorder[] = [];
function startRecorder(opts?: ConstructorParameters<typeof StreamRecorder>[0]): FakeMediaRecorder {
  const r = new StreamRecorder(opts);
  live.push(r);
  r.start(fakeStream);
  return FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
}

beforeEach(() => {
  FakeMediaRecorder.supported = ['video/webm;codecs=vp9,opus'];
  FakeMediaRecorder.instances = [];
  globals.MediaRecorder = FakeMediaRecorder;
  globals.HTMLCanvasElement = FakeCanvas;
});

afterEach(() => {
  for (const r of live.splice(0)) r.dispose();
  delete globals.MediaRecorder;
  delete globals.HTMLCanvasElement;
});

describe('StreamRecorder options wiring', () => {
  it('defaults to 5 Mbps (quality/upload-size balance, was 10)', () => {
    const rec = startRecorder();
    expect(rec.options.videoBitsPerSecond).toBe(5_000_000);
  });

  it('passes an explicit videoBitsPerSecond through unchanged', () => {
    const rec = startRecorder({ videoBitsPerSecond: 2_500_000 });
    expect(rec.options.videoBitsPerSecond).toBe(2_500_000);
  });

  it('passes the picked mimeType, omitting it when nothing is supported', () => {
    const withSupport = startRecorder();
    expect(withSupport.options.mimeType).toBe('video/webm;codecs=vp9,opus');

    FakeMediaRecorder.supported = [];
    const withoutSupport = startRecorder();
    expect(withoutSupport.options.mimeType).toBeUndefined();
  });
});

describe('StreamRecorder onError', () => {
  it('forwards mid-recording MediaRecorder errors to opts.onError', () => {
    const onError = vi.fn();
    const rec = startRecorder({ onError });
    const evt = { type: 'error' } as unknown as Event;
    rec.onerror?.(evt);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(evt);
  });

  it('stays safe (old behavior) when no onError callback is given', () => {
    const rec = startRecorder();
    expect(() => rec.onerror?.({ type: 'error' })).not.toThrow();
  });
});
