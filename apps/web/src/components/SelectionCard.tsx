import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { athleteText } from "../i18n/athletes";
import type { AthleteCard } from "../protocol";
import { assetUrl } from "../runtimeConfig";

interface Props {
  athlete: AthleteCard;
  accent: string;
  selected?: boolean;
  disabled?: boolean;
  reason?: string;
  used?: boolean;
  recruit?: boolean;
  onChoose: () => void;
}

export function SelectionCard({ athlete, accent, selected = false, disabled = false, reason, used = false, recruit = false, onChoose }: Props) {
  const { t } = useTranslation();
  const card = athleteText(t, athlete);
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 981px) and (hover: hover) and (pointer: fine)").matches);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const anchor = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const hideSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => {
    const query = window.matchMedia("(min-width: 981px) and (hover: hover) and (pointer: fine)");
    const update = () => { setDesktop(query.matches); setOpen(false); };
    query.addEventListener("change", update);
    return () => { query.removeEventListener("change", update); clearTimeout(closeTimer.current); };
  }, []);
  useLayoutEffect(() => {
    if (!open || !desktop) return;
    const place = () => {
      if (!anchor.current || !floating.current) return;
      const card = anchor.current.getBoundingClientRect(), panel = floating.current.getBoundingClientRect();
      const right = card.right + 10;
      setPosition({ left: Math.max(12, right + panel.width <= window.innerWidth - 12 ? right : card.left - panel.width - 10), top: Math.max(12, Math.min(card.top, window.innerHeight - panel.height - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", escape);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("keydown", escape); };
  }, [open, desktop]);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const unavailable = disabled || used;
  const action = used ? t("racer.selectable.retired")
    : unavailable ? reason ?? t("racer.selectable.blocked")
      : recruit ? t("racer.selectable.recruit")
        : selected ? t("racer.selectable.deselect") : t("racer.selectable.select");
  useEffect(() => {
    if (!open || desktop) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; trigger?.focus({ preventScroll: true }); };
  }, [open, desktop]);
  const choose = () => { if (!unavailable) { setOpen(false); onChoose(); } };
  const image = assetUrl(`assets/racer-tokens/${athlete.id}.webp`);
  return <div ref={anchor} onPointerEnter={(event) => { if (desktop && event.pointerType !== "touch") show(); }} onPointerLeave={() => { if (desktop) hideSoon(); }}
    onFocus={(event) => { if (desktop && event.target.matches(":focus-visible")) show(); }} onBlur={(event) => { if (desktop && !event.currentTarget.contains(event.relatedTarget)) hideSoon(); }} className={`selection-card-wrap ${used ? "retired" : ""}`} style={{ "--selection-accent": accent } as CSSProperties}>
    <button type="button" className="selection-card" aria-pressed={recruit ? undefined : selected} disabled={unavailable} onClick={choose}>
      <span className="selection-art"><img src={image} alt="" /><span className="selection-check" aria-hidden="true">{used ? "—" : selected ? "✓" : ""}</span></span>
      <span className="selection-copy"><strong>{card.name}</strong><span className="selection-skill">{card.abilityTitle}</span><span className="selection-summary">{card.summary}</span>{used && <span className="selection-retired">{t("racer.retired")}</span>}</span>
    </button>
    <button type="button" className="selection-details" aria-label={t("racer.selectable.detailsLabel", { name: card.name })} aria-haspopup={desktop ? undefined : "dialog"} aria-expanded={open} aria-describedby={open && desktop ? titleId : undefined} onClick={show}>{t("racer.selectable.details")}</button>
    {open && desktop && createPortal(<div ref={floating} id={titleId} className="selection-rule-popover" role="tooltip" style={position} onPointerEnter={show} onPointerLeave={hideSoon}>
      <strong>{card.name} · {card.abilityTitle}</strong><p className="athlete-sheet-summary">{card.summary}</p>{card.details && <p>{card.details}</p>}
    </div>, document.body)}
    {open && !desktop && createPortal(<dialog className="athlete-sheet" ref={dialog} aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY > bounds.bottom || event.clientX < bounds.left || event.clientX > bounds.right) dialog.current?.close();
    }}>
      <header className="athlete-sheet-header"><img src={image} alt="" /><div><h2 id={titleId}>{card.name}</h2><span>{card.abilityTitle}</span></div><button type="button" className="athlete-sheet-close" aria-label={t("racer.selectable.closeDetails")} onClick={() => dialog.current?.close()}>×</button></header>
      <div className="athlete-sheet-content"><p className="athlete-sheet-summary">{card.summary}</p>{card.details && <><h3>{t("racer.selectable.fullRules")}</h3><p>{card.details}</p></>}</div>
      <div className="athlete-sheet-actions">{unavailable && <p>{used ? t("racer.usedUp") : reason}</p>}<button type="button" className="selection-confirm" disabled={unavailable} onClick={choose}>{action}</button></div>
    </dialog>, document.body)}
  </div>;
}
