// Settings for the on-device Live camera pipeline (src/live). It's separate from the server
// scanner on purpose: nothing here calls the API, so it works signed out and costs nothing to run.
//
// Boxes:  D-FINE-S trained on Objects365 (Apache-2.0), kept to its ~60 grocery and packaging
//         classes. It runs on every frame the worker can take (~5 fps on WebGPU).
// Names:  MobileCLIP-S0's image encoder, run once on each new box, matched against text
//         embeddings of the server's 65-query vocabulary (public/live-camera/labels.json).
// Chosen in the 2026-11 on-device bake-off: on the 24-check eval set this pair scores like OWLv2
// (14 vs 15) with about a third of the wrong items, and it runs in a browser.

const HF = 'https://huggingface.co';

/** Pinned to the revisions that were tested; labels.json is built against the same ones. */
export const DETECTOR_URL = `${HF}/onnx-community/dfine_s_obj365-ONNX/resolve/a61e4cdfe4f9d3188a305d91e37dbf38688ffbb8/onnx/model.onnx`;
/** fp16 weights: half the download and the same labels as fp32 (the int8 build is broken). */
export const CLASSIFIER_URL = `${HF}/Xenova/mobileclip_s0/resolve/757d59c9c6870a76a4b0306f05f5061bca15c39f/onnx/vision_model_fp16.onnx`;
export const LABELS_PATH = 'live-camera/labels.json';

/** Bump to drop model files cached by an older version of the app. */
export const MODEL_CACHE = 'pantry-chef-live-models-v1';

/**
 * ORT-web's WebGPU MatMul fails on these nodes (a 1-D second input), so they run on the CPU.
 * Found in the bake-off; without this the session fails with TensorShape::SizeToDimension.
 */
export const DETECTOR_CPU_NODES = [
  '/model/decoder/integral/MatMul',
  '/model/decoder/integral_1/MatMul',
  '/model/decoder/integral_2/MatMul',
];

/** The detector's square input side: 640 as trained on WebGPU; smaller on the slower WASM path. */
export const DETECTOR_SIZE = { webgpu: 640, wasm: 480 } as const;
/** Minimum sigmoid score for a box (bake-off best: 0.2 at 640 px; 480 px needs lower). */
export const DETECTOR_THRESHOLD = { webgpu: 0.2, wasm: 0.15 } as const;
export const CLASSIFIER_SIZE = 256;
/** Each crop takes the box plus this much of its size around it. */
export const CROP_MARGIN = 0.08;
/** CLIP's logit scale. */
export const LOGIT_SCALE = 100;
/** A detector grocery label wins when the classifier gives it at least this probability. */
export const KEEP_DETECTOR_FOOD = 0.1;
/** Below this mean probability a name is shown as unsure. */
export const UNSURE_BELOW = 0.5;
/** Most crops to name per frame, so one busy frame doesn't stall the boxes. */
export const MAX_CROPS_PER_FRAME = 3;
/**
 * Time for naming crops per frame: this share of the detector's own time, but at least `minMs`.
 * At least one crop is always named, so new boxes still get names on slow devices.
 */
export const NAMING_BUDGET = { share: 0.5, minMs: 80 } as const;
