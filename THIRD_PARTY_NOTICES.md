# Third-party components

Groundhog's original application code is MIT-licensed. Dependencies retain their own licenses.

- Transformers.js: Apache-2.0. https://github.com/huggingface/transformers.js
- ONNX Runtime: MIT. https://github.com/microsoft/onnxruntime
- Xenova/all-MiniLM-L6-v2: Apache-2.0 ONNX conversion of sentence-transformers/all-MiniLM-L6-v2. https://huggingface.co/Xenova/all-MiniLM-L6-v2
- Original sentence-transformers model and training description: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- Vite: MIT. https://github.com/vitejs/vite
- Noto Serif: SIL Open Font License 1.1. https://github.com/googlei18n/noto-fonts . Latin-subset WOFF assets derived from installed distro font files; notices retained in public/fonts/NOTO-LICENSE.txt.
- Open Sans: the bundled installed version is Apache-2.0. https://www.opensans.com/ . Latin-subset WOFF assets derived from installed distro font files; notices and license retained in public/fonts/.

The embedding model is downloaded separately when explicitly enabled. Its weights are not original Groundhog work. The model is a general-purpose English-oriented sentence embedding model, not a model trained or certified to diagnose CI failures.

Demo incidents and reports are synthetic examples created for this project. They are not copied from private repositories or presented as real production history.

Development involved AI assistance for implementation, tests, interface design, and documentation. Validation claims refer only to recorded executions, not assumed results or unperformed human review.
