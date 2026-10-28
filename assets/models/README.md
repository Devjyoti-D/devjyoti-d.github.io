# Metric depth models

`da2-metric-indoor` and `da2-metric-outdoor` are the official
[Depth Anything V2 Metric (Small)](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth)
checkpoints (`depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf` and `...-Outdoor-Small-hf`),
exported to ONNX with a dynamic input size and 8-bit dynamic quantisation for in-browser use with
Transformers.js. The export matches the PyTorch output exactly before quantisation; quantisation changes
depth by about 1-4% (median) on test photos.

They are used by the "Measure distance" tool on `/3d-lab/`.
