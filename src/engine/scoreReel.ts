export interface ScoreReel {
  setValue(value: number): void;
  /** `source` names what paid out ('4连 ×1.5', '整线'…), shown under the number. */
  showGain(amount: number, source?: string): void;
  reset(): void;
}

const GAIN_POP_MS = 1400;
/** 数字轮转一格多高（em）。和 style.css 的 --reel-step 必须一致。 */
const REEL_STEP = 1.1;

/** The slot-machine digit roll + floating "+N" gain popups shared by every board's HUD. */
export function createScoreReel(reelEl: HTMLElement, gainBadgeEl: HTMLElement): ScoreReel {
  let boxes: { box: HTMLElement; strip: HTMLElement }[] = [];
  const scoreCell = reelEl.closest<HTMLElement>('.score-cell');

  function makeDigitBox() {
    const box = document.createElement('div');
    box.className = 'digit-box';
    const strip = document.createElement('div');
    strip.className = 'digit-strip';
    for (let d = 0; d < 10; d++) {
      const s = document.createElement('span');
      s.textContent = String(d);
      strip.appendChild(s);
    }
    box.appendChild(strip);
    return { box, strip };
  }

  function setValue(value: number) {
    // Every character here becomes one digit strip, so the string must hold
    // nothing but digits. A fractional value used to slip through as "184.5":
    // the "." mapped to NaN, `translateY(-NaNem)` is invalid CSS and so was
    // silently dropped, and that column kept whatever digit it last showed —
    // the score read as 18445. Callers keep the score whole; this makes the
    // reel unable to misdraw even if one ever doesn't.
    const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    // The reel draws digits as CSS transforms over ten-digit strips, so its
    // text says nothing about the score. This is the readable copy, and the
    // multiplayer scoreboard reads the local player's score from it — the
    // settled number rather than whatever the animation is mid-way through.
    reelEl.dataset.score = String(safe);
    const digits = String(safe).split('').reverse().map(Number);
    while (boxes.length < digits.length) {
      const box = makeDigitBox();
      boxes.push(box);
      reelEl.insertBefore(box.box, reelEl.firstChild);
    }
    while (boxes.length > digits.length && digits.length > 0) {
      boxes.pop()!.box.remove();
    }
    digits.forEach((d, i) => {
      // 一格的高度：和 style.css 里 .score-reel 的 --reel-step 是同一个数，
      // 改一处必须改另一处（那边的注释里记着为什么是 1.1）。
      boxes[i].strip.style.transform = `translateY(-${d * REEL_STEP}em)`;
    });
  }

  /**
   * Every scoring action gets its own independent "+N" popup — never summed
   * into a running total — so a fast run of separate scores reads as a
   * sequence of distinct events instead of one merged number.
   */
  function showGain(amount: number, source?: string) {
    if (amount <= 0) return;
    const pop = document.createElement('span');
    pop.className = 'gain-pop';
    pop.textContent = '+' + amount;
    if (source) {
      const tag = document.createElement('span');
      tag.className = 'gain-pop-src';
      tag.textContent = source;
      pop.appendChild(tag);
    }
    gainBadgeEl.appendChild(pop);
    window.setTimeout(() => pop.remove(), GAIN_POP_MS);

    if (scoreCell) {
      scoreCell.classList.remove('score-flash');
      void scoreCell.offsetWidth; // restart the flash even if one is already mid-flight
      scoreCell.classList.add('score-flash');
    }
  }

  function reset() {
    gainBadgeEl.replaceChildren();
    scoreCell?.classList.remove('score-flash');
    boxes.forEach((b) => b.box.remove());
    boxes = [];
    setValue(0);
  }

  return { setValue, showGain, reset };
}
