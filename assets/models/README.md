# Metric depth models

`da2-metric-indoor` and `da2-metric-outdoor` are the official
[Depth Anything V2 Metric (Small)](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth)
checkpoints (`depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf` and `...-Outdoor-Small-hf`),
exported to ONNX with a dynamic input size and 8-bit dynamic quantisation for in-browser use with
Transformers.js. The export matches the PyTorch output exactly before quantisation; quantisation changes
depth by about 1-4% (median) on test photos.

They are used by the "Measure distance" tool on `/3d-lab/`.

# Other models (copied unchanged from Hugging Face)

- `onnx-community/depth-anything-v2-small`: Depth Anything V2 Small (Apache-2.0), used for the 3D relief.
  `model_quantized.onnx` runs on the CPU (WebAssembly), `model_fp16.onnx` on WebGPU.
- `Xenova/slimsam-77-uniform`: SlimSAM, a compressed Segment Anything (Apache-2.0), used to cut out the
  object in "Full object" mode.

Each folder keeps its original `README.md` (model card and licence). The Transformers.js runtime and
three.js are in `/assets/lib/` with their licences, so the 3D Lab needs no outside services.
