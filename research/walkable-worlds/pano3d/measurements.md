| day | method | depth CPU s (per crop) | split + fuse + post s | overlap residual | depth range m | far px | download MB (pano + depth + bg + bgdepth) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hackathon | MoGe-2 ViT-L x14 crops | 329.4 (36.61) | 1.9 + 1.4 + 2 | 4.2% | 0.78-8.0 | 0% | 1.81 (1.02 + 0.63 + 0.04 + 0.12) |
| hackathon | DA2 metric-S x14 crops | 10.3 (0.74) | 1.9 + 1.3 + 2.2 | 4.13% | 1.03-6.2 | 0% | 1.88 (1.02 + 0.69 + 0.05 + 0.13) |
| hackathon | DA2 metric-S one-shot equirect | 6.1 | 0 + 0 + 2 | n/a | 1.39-6.7 | n/a | 1.93 (1.02 + 0.74 + 0.05 + 0.13) |
| santa-cruz | DA2 metric-S x14 crops | 48.3 (3.45) | 2.1 + 1.1 + 1.3 | 15.4% | 1.42-27.3 | 0% | 2.02 (1.16 + 0.70 + 0.03 + 0.13) |
| santa-cruz | DA2 metric-S one-shot equirect | 5.6 | 0 + 0 + 1.4 | n/a | 1.33-18.2 | n/a | 2.05 (1.16 + 0.74 + 0.02 + 0.12) |
