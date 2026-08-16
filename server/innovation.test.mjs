import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertInnovationOutcome,
  assessCounterengineering,
  selectCeilingFirstAdvance,
  selectMaximumCoherentAdvance,
  validateInnovationPolicy,
} from './innovation.mjs'

function candidate(id, overrides = {}) {
  return {
    id,
    technology: id,
    boundary: 'execution-runtime',
    source: `https://example.org/${id}`,
    primarySource: true,
    publishedAt: '2026-08-15T00:00:00Z',
    summary: 'Primary-source frontier signal with measurable engineering value.',
    maturity: 'stable',
    confidence: 0.95,
    boundaryFit: 0.95,
    implementationCost: 0.5,
    regressionRisk: 0.15,
    reversibility: 0.95,
    novelty: 0.7,
    gain: {
      capability: 0,
      performance: 0,
      reliability: 0,
      security: 0,
      composability: 0,
      reach: 0,
      developerVelocity: 0,
      observability: 0,
    },
    ...overrides,
  }
}

test('maximum coherent advance prefers power over cheap smallness', () => {
  const powerful = candidate('powerful', {
    implementationCost: 0.95,
    gain: {
      capability: 0.95,
      performance: 0.9,
      reliability: 0.8,
      security: 0.8,
      composability: 0.9,
      reach: 0.85,
      developerVelocity: 0.7,
      observability: 0.7,
    },
  })
  const cheap = candidate('cheap', {
    implementationCost: 0.02,
    gain: {
      capability: 0.2,
      performance: 0.15,
      reliability: 0.2,
      security: 0.15,
      composability: 0.1,
      reach: 0.1,
      developerVelocity: 0.3,
      observability: 0.1,
    },
  })

  const decision = selectMaximumCoherentAdvance([cheap, powerful])
  assert.equal(decision.action, 'implement')
  assert.equal(decision.selected.candidate.id, 'powerful')
  assert.equal(decision.orientation, 'CEILING_FIRST')
})

test('unsafe raw gain cannot bypass coherence', () => {
  const unsafe = candidate('unsafe', {
    regressionRisk: 0.99,
    gain: {
      capability: 1,
      performance: 1,
      reliability: 1,
      security: -0.9,
      composability: 1,
      reach: 1,
      developerVelocity: 1,
      observability: 1,
    },
  })
  const safe = candidate('safe', {
    gain: {
      capability: 0.7,
      performance: 0.4,
      reliability: 0.8,
      security: 0.9,
      composability: 0.6,
      reach: 0.5,
      developerVelocity: 0.4,
      observability: 0.5,
    },
  })

  const decision = selectMaximumCoherentAdvance([unsafe, safe])
  assert.equal(decision.selected.candidate.id, 'safe')
  assert.ok(decision.ranked.find((item) => item.candidate.id === 'unsafe').blockers.includes('regression_risk_above_limit'))
})

test('preview capability becomes a reversible experiment', () => {
  const preview = candidate('preview', {
    maturity: 'preview',
    gain: {
      capability: 0.9,
      performance: 0.6,
      reliability: 0.4,
      security: 0.4,
      composability: 0.9,
      reach: 0.8,
      developerVelocity: 0.5,
      observability: 0.4,
    },
  })
  assert.equal(selectMaximumCoherentAdvance([preview]).action, 'experiment')
})

test('policy cannot optimize for cheapness over innovation', () => {
  assert.throws(
    () => validateInnovationPolicy({
      weights: {
        capability: 0.22,
        performance: 0.16,
        reliability: 0.14,
        security: 0.14,
        composability: 0.12,
        reach: 0.10,
        developerVelocity: 0.07,
        observability: 0.05,
      },
      minimumConfidence: 0.65,
      minimumBoundaryFit: 0.60,
      maximumRegressionRisk: 0.55,
      minimumExperimentalReversibility: 0.70,
      implementationThreshold: 0.36,
      experimentThreshold: 0.18,
      riskPenalty: 0.22,
      costPenalty: 0.20,
      noveltyBonus: 0.10,
      boundaryBonus: 0.18,
      ceilingBonus: 0.14,
      recoveryBonus: 0.18,
      recoveryCompositionBonus: 0.12,
      underRecoveryPenalty: 0.10,
    }),
    /cost may not dominate/,
  )
})

test('innovation cycle cannot disappear into a report-only no-op', () => {
  assert.equal(assertInnovationOutcome({ state: 'implemented' }), true)
  assert.equal(assertInnovationOutcome({ state: 'recovered' }), true)
  assert.equal(assertInnovationOutcome({ state: 'recovered_and_surpassed' }), true)
  assert.throws(() => assertInnovationOutcome({ state: 'reported' }), /real state change/)
  assert.throws(() => assertInnovationOutcome({ state: 'hold_with_reason', reason: 'no' }), /measured reason/)
})

test('artificial target shrink is incoherent even when raw gains look attractive', () => {
  const shrink = candidate('shrink', {
    gain: {
      capability: 0.95,
      performance: 0.95,
      reliability: 0.95,
      security: 0.95,
      composability: 0.95,
      reach: 0.95,
      developerVelocity: 0.95,
      observability: 0.95,
    },
    counterengineering: {
      targetEffect: 'shrink',
      realConstraintRequiresReduction: false,
      ceilingAlignment: 0.1,
    },
  })
  const preserve = candidate('preserve', {
    gain: {
      capability: 0.55,
      performance: 0.4,
      reliability: 0.7,
      security: 0.7,
      composability: 0.6,
      reach: 0.5,
      developerVelocity: 0.5,
      observability: 0.5,
    },
    counterengineering: {
      targetEffect: 'preserve',
      ceilingAlignment: 0.9,
    },
  })

  const decision = selectCeilingFirstAdvance([shrink, preserve])
  assert.equal(decision.selected.candidate.id, 'preserve')
  assert.ok(decision.ranked.find((item) => item.candidate.id === 'shrink').blockers.includes('artificial_target_shrink'))
})

test('local block cannot be promoted into a global system limit', () => {
  const blocked = candidate('blocked', {
    counterengineering: {
      localBlockGlobalized: true,
      targetEffect: 'preserve',
    },
  })
  const assessment = assessCounterengineering(blocked)
  assert.equal(assessment.coherent, false)
  assert.ok(assessment.blockers.includes('local_block_generalized_to_global'))
})

test('recovery-and-surpass is favored over parity-only under-recovery when composition is available', () => {
  const parity = candidate('parity', {
    gain: {
      capability: 0.7,
      performance: 0.5,
      reliability: 0.7,
      security: 0.7,
      composability: 0.5,
      reach: 0.5,
      developerVelocity: 0.4,
      observability: 0.5,
    },
    counterengineering: {
      contractionDetected: true,
      displacedCapability: 0.95,
      lineageValue: 0.95,
      ceilingAlignment: 0.9,
      compositionLeverage: 0.9,
      recoveryConfidence: 0.95,
      surpassPotential: 0.9,
      recoveryMode: 'recover',
      targetEffect: 'preserve',
    },
  })
  const surpass = candidate('surpass', {
    gain: {
      capability: 0.72,
      performance: 0.52,
      reliability: 0.72,
      security: 0.72,
      composability: 0.75,
      reach: 0.6,
      developerVelocity: 0.45,
      observability: 0.55,
    },
    counterengineering: {
      contractionDetected: true,
      displacedCapability: 0.95,
      lineageValue: 0.95,
      ceilingAlignment: 1,
      compositionLeverage: 0.95,
      recoveryConfidence: 0.95,
      surpassPotential: 0.95,
      recoveryMode: 'recover_and_surpass',
      targetEffect: 'expand',
    },
  })

  const decision = selectCeilingFirstAdvance([parity, surpass])
  assert.equal(decision.selected.candidate.id, 'surpass')
  assert.equal(decision.action, 'recover_and_surpass')
  const parityRank = decision.ranked.find((item) => item.candidate.id === 'parity')
  assert.ok(parityRank.counterengineering.underRecoveryRisk > 0)
})

test('verification cannot define the target ceiling', () => {
  const bad = candidate('proof-ceiling', {
    counterengineering: {
      verificationDefinesTarget: true,
      ceilingAlignment: 0.2,
    },
  })
  const assessment = assessCounterengineering(bad)
  assert.equal(assessment.coherent, false)
  assert.ok(assessment.blockers.includes('verification_scope_defines_target'))
})
