export interface ScoreReel {
  setValue(value: number): void;
  showGain(amount: number): void;
  reset(): void;
}

/** The slot-machine digit roll + floating "+N" gain badge shared by every board's HUD. */
export function createScoreReel(reelEl: HTMLElement, gainBadgeEl: HTMLElement): ScoreReel {
  let boxes: { box: HTMLElement; strip: HTMLElement }[] = [];
  let pendingGain = 0;
  let gainTimer: number | undefined;

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
    const digits = String(value).split('').reverse().map(Number);
    while (boxes.length < digits.length) {
      const box = makeDigitBox();
      boxes.push(box);
      reelEl.insertBefore(box.box, reelEl.firstChild);
    }
    while (boxes.length > digits.length && digits.length > 0) {
      boxes.pop()!.box.remove();
    }
    digits.forEach((d, i) => {
      boxes[i].strip.style.transform = `translateY(-${d * 1.5}em)`;
    });
  }

  function showGain(amount: number) {
    if (amount <= 0) return;
    pendingGain += amount;
    gainBadgeEl.textContent = '+' + pendingGain;
    gainBadgeEl.classList.add('show');
    clearTimeout(gainTimer);
    gainTimer = window.setTimeout(() => {
      gainBadgeEl.classList.remove('show');
      pendingGain = 0;
    }, 10000);
  }

  function reset() {
    clearTimeout(gainTimer);
    pendingGain = 0;
    gainBadgeEl.classList.remove('show');
    boxes.forEach((b) => b.box.remove());
    boxes = [];
    setValue(0);
  }

  return { setValue, showGain, reset };
}
