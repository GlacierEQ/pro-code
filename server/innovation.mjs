const DIMENSIONS = Object.freeze([
  'capability',
  'performance',
  'reliability',
  'security',
  'composability',
  'reach',
  'developerVelocity',
  'observability',
])

const DEFAULT_WEIGHTS = Object.freeze({
  capability: 0.22,
  performance: 0.16,
  reliability: 0.14,
  security: 0.14,
  composability: 0.12,
  reach: 0.10,
  developerVelocity: 0.07,
  observability: 0.05,
})

const MATURITY = Object.freeze({
  security: 1.0,
  stable: 1.0,
  release_candidate: 0.90,
  preview: 0.78,
  research: 0.62,
})

export const DEFAULT_INNOVATION_POLICY = Object.freeze({
  weights: DEFAULT_WEIGHTS,
  minimumConfidence: 0.65,
  minimumBoundaryFit: 0.60,
  maximumRegressionRisk: 0.55,
  minimumExperimentalReversibility: 0.70,
  implementationThreshold: 0.36,
  experimentThreshold: 0.18,
  riskPenalty: 0.22,
  costPenalty: 0.04,
  noveltyBonus: 0.10,
  boundaryBonus: 0.18,
})

function requireUnit(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${name} must be a finite number from 0 to 1`)
  }
}

function requireGain(name, value) {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new TypeError(`gain.${name} must be a finite number from -1 to 1`)
  }
}

export function validateInnovationPolicy(policy = DEFAULT_INNOVATION_POLICY) {
  const weightKeys = Object.keys(policy.weights).sort()
  const expectedKeys = [...DIMENSIONS].sort()
  if (JSON.stringify(weightKeys) !== JSON.stringify(expectedKeys)) {
    throw new TypeError('policy weights must define every gain dimension exactly once')
  }
  const total = Object.values(policy.weights).reduce((sum, value) => sum + value, 0)
  if (Math.abs(total - 1) > 1e-9) throw new TypeError('policy weights must sum to 1')
  if (policy.costPenalty >= policy.noveltyBonus || policy.costPenalty >= policy.boundaryBonus) {
    throw new TypeError('implementation cost may not dominate innovation or boundary advantage')
  }
  return policy
}

export function validateInnovationCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new TypeError('candidate is required')
  for (const name of ['id', 'technology', 'boundary', 'source', 'summary']) {
    if (typeof candidate[name] !== 'string' || candidate[name].trim() === '') {
      throw new TypeError(`${name} must be a non-empty string`)
    }
  }
  const url = new URL(candidate.source)
  if (url.protocol !== 'https:') throw new TypeError('source must use https')
  if (candidate.primarySource !== true) throw new TypeError('candidate must use a primary source')
  if (!(candidate.maturity in MATURITY)) throw new TypeError(`unsupported maturity: ${candidate.maturity}`)
  const published = Date.parse(candidate.publishedAt)
  if (!Number.isFinite(published)) throw new TypeError('publishedAt must be an ISO-compatible date')
  if (!candidate.gain || typeof candidate.gain !== 'object') throw new TypeError('gain is required')
  for (const name of DIMENSIONS) requireGain(name, candidate.gain[name] ?? 0)
  for (const name of ['confidence', 'boundaryFit', 'implementationCost', 'regressionRisk', 'reversibility', 'novelty']) {
    requireUnit(name, candidate[name])
  }
  return candidate
}

export function scoreInnovationCandidate(candidate, policy = DEFAULT_INNOVATION_POLICY) {
  validateInnovationPolicy(policy)
  validateInnovationCandidate(candidate)

  const blockers = []
  if (candidate.confidence < policy.minimumConfidence) blockers.push('insufficient_evidence_confidence')
  if (candidate.boundaryFit < policy.minimumBoundaryFit) blockers.push('insufficient_boundary_fit')
  if (candidate.regressionRisk > policy.maximumRegressionRisk) blockers.push('regression_risk_above_limit')
  if (
    ['preview', 'research'].includes(candidate.maturity)
    && candidate.reversibility < policy.minimumExperimentalReversibility
  ) blockers.push('experimental_path_not_reversible_enough')

  const weightedGain = DIMENSIONS.reduce(
    (sum, name) => sum + (candidate.gain[name] ?? 0) * policy.weights[name],
    0,
  )
  const score = (
    weightedGain * candidate.confidence * MATURITY[candidate.maturity]
    + policy.boundaryBonus * candidate.boundaryFit
    + policy.noveltyBonus * candidate.novelty
    - policy.riskPenalty * candidate.regressionRisk
    - policy.costPenalty * candidate.implementationCost
    - (candidate.alreadyPresent ? 0.08 : 0)
  )

  return Object.freeze({
    candidate,
    score: Number(score.toFixed(6)),
    coherent: blockers.length === 0,
    blockers: Object.freeze(blockers),
  })
}

export function selectMaximumCoherentAdvance(candidates, policy = DEFAULT_INNOVATION_POLICY) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array')
  const ranked = candidates
    .map((candidate) => scoreInnovationCandidate(candidate, policy))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
  const selected = ranked.find((item) => item.coherent) ?? null

  let action = 'hold'
  let reason = 'no evidence-backed coherent advance is currently executable'
  if (selected) {
    if (
      selected.score >= policy.implementationThreshold
      && ['stable', 'security'].includes(selected.candidate.maturity)
    ) {
      action = 'implement'
      reason = 'highest-scoring coherent stable advance'
    } else if (selected.score >= policy.experimentThreshold) {
      action = 'experiment'
      reason = 'highest-scoring coherent advance requires measured experiment'
    } else {
      reason = 'coherent candidate does not clear the advance threshold'
    }
  }

  return Object.freeze({
    schema: 'glaciereq.pro-code.maximum-coherent-advance.v1',
    action,
    reason,
    selected,
    ranked: Object.freeze(ranked),
  })
}

export function assertInnovationOutcome(outcome) {
  const allowed = new Set(['implemented', 'experiment_started', 'hold_with_reason', 'rejected_with_reason'])
  if (!outcome || !allowed.has(outcome.state)) {
    throw new TypeError('innovation cycle must end in a real state change or a measured hold/reject state')
  }
  if (['hold_with_reason', 'rejected_with_reason'].includes(outcome.state)) {
    if (typeof outcome.reason !== 'string' || outcome.reason.trim().length < 20) {
      throw new TypeError('hold/reject outcome requires a measured reason')
    }
  }
  return true
}
