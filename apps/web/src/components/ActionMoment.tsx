import type { ActionMoment as Moment, Participant } from "../eventPresentation";
import { assetUrl } from "../runtimeConfig";

function Actor({ actor, label }: { actor: Participant; label: string }) {
  return <div className="moment-actor">
    <small>{label}</small>
    {actor.athleteId ? <img src={assetUrl(`assets/racer-tokens/${actor.athleteId}.webp`)} alt="" /> : <span className="moment-symbol" aria-hidden="true">{actor.name === "骰子" ? "⚄" : "◇"}</span>}
    <strong>{actor.name}</strong><small>{actor.owner}</small>
  </div>;
}

export function ActionMoment({ moment }: { moment: Moment }) {
  return <aside className="action-moment" role="status" aria-live="polite">
    <p>{moment.cause}</p>
    <div className="moment-flow">
      <Actor actor={moment.source} label="触发来源" />
      <div className="moment-effect"><span aria-hidden="true">⟶</span><strong>{moment.effect}</strong>
        {moment.from !== undefined && moment.to !== undefined && <div className="moment-positions"><b>{moment.from}</b><span>→</span><b>{moment.to}</b><small>格</small></div>}
      </div>
      <Actor actor={moment.target} label="受影响" />
    </div>
  </aside>;
}
