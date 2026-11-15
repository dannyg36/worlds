# fal findings for the skybox approach (checked 2026-11-15, before the switch to GMI)

These were read from each endpoint's llms.txt and OpenAPI schema on fal.ai. No fal call was made from this approach; FAL_KEY never reached this machine and the spike moved to GMI Cloud.

| Endpoint | Price line (llms.txt) | Notes |
| --- | --- | --- |
| fal-ai/hunyuan_world | "$0.15 per images" | Image to panorama (1920x960). The llms.txt answered once at 20:20 UTC, then the model page, llms.txt and OpenAPI schema all returned 404 / null from 20:22 on, and every id variant I tried (hunyuan-world, hunyuan_world/image-to-world, ...) was 404 too. Search results still index fal-ai/hunyuan_world/image-to-world. Treat it as possibly delisted. |
| fal-ai/flux-lora | "$0.035 per megapixels" | FLUX.1 dev + LoRA list (path, scale 0-4). 2048x1024 = 2.1 MP = ~$0.073. Works with MultiTrickFox/Flux-LoRA-Equirectangular-v3 (file equirectangular_flux_lora_v3_000003072.safetensors, base FLUX.1-dev, trigger "equirectangular 360 degree panorama", 2:1, weight 0.5-1.5, guidance 2.5 for realistic). |
| fal-ai/flux-2/klein/9b/lora | "$0.015 per megapixel" | Distilled Klein, 4-8 steps, up to 3 LoRAs. Both 360 LoRAs below were trained on FLUX.2-klein-base-9B, so the base endpoints are the better match. |
| fal-ai/flux-2/klein/9b/base/lora | "$0.02 per megapixels" | Base Klein, 4-50 steps (default 28), guidance 0-20, negative prompt. Match for crafiq/flux-2-klein-9b-360-panorama-lora (trigger "Equirectangular 360 panorama"). |
| fal-ai/flux-2/klein/9b/base/edit/lora | "$0.02 per megapixel of input and output" (input resized to 1 MP) | Image edit with LoRAs: the host nomadoor/flux-2-klein-9B-360-erp-outpaint-lora needs. Its README says distilled models "do not produce good results in most cases", so use base. Control image: 2048x1024 pure green (0,255,0) canvas with the reference projected from a pinhole view; trigger "Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges." tools/pano.py control builds that canvas. |
| fal-ai/nano-banana-2 | "$0.08 per image" (2K x1.5, 4K x2) | No 2:1 aspect ratio (enum: 21:9, 16:9, 4:1 ...), so a true equirect needs a resize. |
| openai/gpt-image-2 | token priced; medium 1920x1080 $0.040, 2560x1440 $0.056; high 1920x1080 $0.158 | Custom sizes: multiples of 16, max edge 3840, aspect <= 3:1, 0.66-8.3 MP, so 2048x1024 and 3840x1920 are legal. |
| fal-ai/seedvr/upscale/image/seamless | "$0.0025 per megapixels" | 2x factor or target 720p-2160p, "retaining seamless tiling". |
| fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d | "$0.225 per generation" (+$0.15 PBR) | input_image_url only; GLB or OBJ out. |
| fal-ai/trellis-2 | "$0.25 for 512p, $0.30 1024p, $0.35 1536p" | texture_size 1024/2048/4096, decimation_target default 500k. |
