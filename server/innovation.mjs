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

const TARGET_EFFECTS = new Set(['preserve', 'expand', 'shrink'])
const RECOVERY_MODES = new Set(['none', 'recover', 'recover_and_surpass', 'ignore'])

const DEFAULT_COUNTERENGINEERING = Object.freeze({
  contractionDetected: false,
  displacedCapability: 0,
  lineageValue: 0,
  ceilingAlignment: 0,
  compositionLeverage: 0,
  recoveryConfidence: 0,
  surpassPotential: 0,
  targetEffect: 'preserve',
  recoveryMode: 'none',
  realConstraintRequiresReduction: false,
  verificationDefinesTarget: false,
  localBlockGlobalized: false,
  destroysUniqueLineage: false,
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
  ceilingBonus: 0.14,
  recoveryBonus: 0.18,
  recoveryCompositionBonus: 0.12,
  underRecoveryPenalty: 0.10,
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

function normalizeCounterengineering(candidate) {
  const supplied = candidate.counterengineering ?? {}
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new TypeError('counterengineering must be an object when provided')
  }
  const counterengineering = { ...DEFAULT_COUNTERENGINEERING, ...supplied }
  for (const name of [
    'displacedCapability',
    'lineageValue',
    'ceilingAlignment',
    'compositionLeverage',
    'recoveryConfidence',
    'surpassPotential',
  ]) requireUnit(`counterengineering.${name}`, counterengineering[name])

  if (!TARGET_EFFECTS.has(counterengineering.targetEffect)) {
    throw new TypeError(`unsupported counterengineering.targetEffect: ${counterengineering.targetEffect}`)
  }
  if (!RECOVERY_MODES.has(counterengineering.recoveryMode)) {
    throw new TypeError(`unsupported counterengineering.recoveryMode: ${counterengineering.recoveryMode}`)
  }
  for (const name of [
    'contractionDetected',
    'realConstraintRequiresReduction',
    'verificationDefinesTarget',
    'localBlockGlobalized',
    'destroysUniqueLineage',
  ]) {
    if (typeof counterengineering[name] !== 'boolean') {
      throw new TypeError(`counterengineering.${name} must be boolean`)
    }
  }
  return Object.freeze(counterengineering)
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
  for (const name of ['ceilingBonus', 'recoveryBonus', 'recoveryCompositionBonus', 'underRecoveryPenalty']) {
    requireUnit(`policy.${name}`, policy[name])
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
  normalizeCounterengineering(candidate)
  return candidate
}

export function assessCounterengineering(candidate) {
  validateInnovationCandidate(candidate)
  const counterengineering = normalizeCounterengineering(candidate)
  const blockers = []

  if (
    counterengineering.targetEffect === 'shrink'
    && !counterengineering.realConstraintRequiresReduction
  ) blockers.push('artificial_target_shrink')
  if (counterengineering.verificationDefinesTarget) blockers.push('verification_scope_defines_target')
  if (counterengineering.localBlockGlobalized) blockers.push('local_block_generalized_to_global')
  if (counterengineering.destroysUniqueLineage) blockers.push('unique_lineage_value_destroyed')
  if (
    counterengineering.contractionDetected
    && counterengineering.recoveryMode === 'ignore'
  ) blockers.push('known_contraction_ignored')

  const recoveryValue = (
    counterengineering.displacedCapability
    * Math.max(counterengineering.lineageValue, counterengineering.recoveryConfidence)
  )
  const compositionRecoveryValue = (
    counterengineering.compositionLeverage
    * counterengineering.surpassPotential
  )
  const underRecoveryRisk = (
    counterengineering.contractionDetected
    && counterengineering.recoveryMode === 'recover'
    && counterengineering.surpassPotential > 0.5
  ) ? counterengineering.surpassPotential : 0

  return Object.freeze({
    counterengineering,
    coherent: blockers.length === 0,
    blockers: Object.freeze(blockers),
    recoveryValue: Number(recoveryValue.toFixed(6)),
    compositionRecoveryValue: Number(compositionRecoveryValue.toFixed(6)),
    underRecoveryRisk: Number(underRecoveryRisk.toFixed(6)),
  })
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

  const counter = assessCounterengineering(candidate)
  blockers.push(...counter.blockers)

  const weightedGain = DIMENSIONS.reduce(
    (sum, name) => sum + (candidate.gain[name] ?? 0) * policy.weights[name],
    0,
  )
  const score = (
    weightedGain * candidate.confidence * MATURITY[candidate.maturity]
    + policy.boundaryBonus * candidate.boundaryFit
    + policy.noveltyBonus * candidate.novelty
    + policy.ceilingBonus * counter.counterengineering.ceilingAlignment
    + policy.recoveryBonus * counter.recoveryValue
    + policy.recoveryCompositionBonus * counter.compositionRecoveryValue
    - policy.underRecoveryPenalty * counter.underRecoveryRisk
    - policy.riskPenalty * candidate.regressionRisk
    - policy.costPenalty * candidate.implementationCost
    - (candidate.alreadyPresent ? 0.08 : 0)
  )

  return Object.freeze({
    candidate,
    score: Number(score.toFixed(6)),
    coherent: blockers.length === 0,
    blockers: Object.freeze(blockers),
    counterengineering: counter,
  })
}

export function selectMaximumCoherentAdvance(candidates, policy = DEFAULT_INNOVATION_POLICY) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array')
  const ranked = candidates
    .map((candidate) => scoreInnovationCandidate(candidate, policy))
    .sort((a, b) => (
      b.score - a.score
      || b.counterengineering.compositionRecoveryValue - a.counterengineering.compositionRecoveryValue
      || b.counterengineering.recoveryValue - a.counterengineering.recoveryValue
      || a.candidate.id.localeCompare(b.candidate.id)
    ))
  const selected = ranked.find((item) => item.coherent) ?? null

  let action = 'hold'
  let reason = 'no evidence-backed coherent advance is currently executable'
  if (selected) {
    const recovery = selected.counterengineering.counterengineering
    if (
      recovery.contractionDetected
      && recovery.recoveryMode === 'recover_and_surpass'
      && selected.score >= policy.experimentThreshold
    ) {
      action = ['stable', 'security'].includes(selected.candidate.maturity) ? 'recover_and_surpass' : 'experiment'
      reason = action === 'recover_and_surpass'
        ? 'highest-scoring coherent advance restores displaced capability and surpasses the recovered ceiling'
        : 'recovery-and-surpass candidate requires a measured reversible experiment'
    } else if (
      recovery.contractionDetected
      && recovery.recoveryMode === 'recover'
      && selected.score >= policy.experimentThreshold
    ) {
      action = ['stable', 'security'].includes(selected.candidate.maturity) ? 'recover' : 'experiment'
      reason = action === 'recover'
        ? 'highest-scoring coherent advance restores displaced capability'
        : 'recovery candidate requires a measured reversible experiment'
    } else if (
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
    schema: 'glaciereq.pro-code.maximum-coherent-advance.v2',
    orientation: 'CEILING_FIRST',
    action,
    reason,
    selected,
    ranked: Object.freeze(ranked),
  })
}

export function selectCeilingFirstAdvance(candidates, policy = DEFAULT_INNOVATION_POLICY) {
  return selectMaximumCoherentAdvance(candidates, policy)
}

export function assertInnovationOutcome(outcome) {
  const allowed = new Set([
    'implemented',
    'experiment_started',
    'recovered',
    'recovered_and_surpassed',
    'hold_with_reason',
    'rejected_with_reason',
  ])
  if (!outcome || !allowed.has(outcome.state)) {
    throw new TypeError('innovation cycle must end in a real state change, recovery, or a measured hold/reject state')
  }
  if (['hold_with_reason', 'rejected_with_reason'].includes(outcome.state)) {
    if (typeof outcome.reason !== 'string' || outcome.reason.trim().length < 20) {
      throw new TypeError('hold/reject outcome requires a measured reason')
    }
  }
  return true
}
