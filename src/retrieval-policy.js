/**
 * Chosen on the calibration partition before held-out evaluation.
 * See evidence/evaluation.json. Do not tune these values against held-out cases.
 * Cosine similarity is not a probability that a stored fix is correct.
 */
export const RETRIEVAL_POLICY = Object.freeze({
  minSimilarity: 0.68,
  minMargin: 0.20,
  topK: 3,
});
