import {
  USER_OP_PHASE_LADDER,
  UserOpPhase,
  phaseReached,
} from '../lib/userop'

/** Horizontal UserOp lifecycle: preparing → signing → submitted → bundled. */
export const PhaseTimeline = ({
  phase,
}: {
  phase: UserOpPhase
}): JSX.Element => (
  <div className="phase-timeline">
    {USER_OP_PHASE_LADDER.map((milestone) => (
      <span
        key={milestone}
        className={
          phase === UserOpPhase.failed
            ? 'phase failed'
            : phaseReached(phase, milestone)
              ? 'phase reached'
              : 'phase'
        }
      >
        {milestone}
      </span>
    ))}
    {phase === UserOpPhase.failed && <span className="phase failed">failed</span>}
  </div>
)
