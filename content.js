// Auto-picks answers on Microsoft Forms by matching question/option TEXT (option order is shuffled).
// Never submits: you review and press "Gửi"/"Submit" yourself.
(function () {
  const QUESTION_MIN = 0.6; // question similarity needed to trust a fuzzy match
  const OPTION_MIN = 0.5;

  const norm = (s) =>
    (s || "")
      .normalize("NFC")
      .toLowerCase()
      .replace(/^\s*(câu\s*)?\d+\s*[.:)]\s+/, "") // "12. " / "Câu 12: " prefix; needs the space so "4.000.000đ" survives
      .replace(/^\s*[a-e]\s*[.)]\s+/, "") // "A. " option prefix
      .replace(/[“”"'‘’.,:;!?()\[\]*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };

  // Dice coefficient on character bigrams: tolerant to small wording/diacritic differences.
  const similarity = (a, b) => {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a), B = bigrams(b);
    let hit = 0;
    for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
    return (2 * hit) / (a.length - 1 + b.length - 1);
  };

  const best = (target, items, key) => {
    let top = null, score = 0;
    for (const it of items) {
      const s = similarity(target, key(it));
      if (s > score) { score = s; top = it; }
    }
    return { item: top, score };
  };

  const bank = ANSWERS.map((a) => ({ ...a, q: norm(a.question), a: norm(a.answer) }));

  const text = (el) => (el ? el.innerText || el.textContent || "" : "");

  function questionBlocks() {
    const items = document.querySelectorAll('[data-automation-id="questionItem"]');
    if (items.length) return [...items];
    // Fallback for layout changes: the nearest wrapper around each radio/checkbox group.
    return [...document.querySelectorAll('[role="radiogroup"], [role="group"]')].map(
      (g) => g.closest('[class*="question"]') || g.parentElement
    );
  }

  function questionText(block) {
    const title = block.querySelector('[data-automation-id="questionTitle"]') || block.querySelector('[role="heading"]');
    const inner = title && title.querySelector(".text-format-content");
    return text(inner || title);
  }

  function choices(block) {
    return [...block.querySelectorAll('input[type="radio"], input[type="checkbox"]')].map((input) => {
      const item = input.closest('[data-automation-id="choiceItem"]') || input.closest("label") || input.parentElement;
      const label = item && item.querySelector(".text-format-content");
      return { input, text: norm(input.value || input.getAttribute("aria-label") || text(label || item)) };
    });
  }

  function mark(block, color, note) {
    block.style.outline = `3px solid ${color}`;
    block.style.outlineOffset = "4px";
    block.title = note;
  }

  function fill() {
    const stats = { done: 0, unverified: 0, missing: 0 };
    for (const block of questionBlocks()) {
      if (!block) continue;
      const opts = choices(block);
      if (!opts.length) continue;
      const q = norm(questionText(block));
      const exact = bank.find((b) => b.q === q);
      // Bank has near-duplicate questions with different answers, so a fuzzy hit must also have its answer among the options.
      const candidates = exact
        ? [exact]
        : bank.filter((b) => similarity(q, b.q) >= QUESTION_MIN).sort((x, y) => similarity(q, y.q) - similarity(q, x.q));
      let ans = null, choice = null;
      for (const c of candidates) {
        const o = opts.find((o) => o.text === c.a) || best(c.a, opts, (o) => o.text);
        const pick = o.input ? o : o.score >= OPTION_MIN ? o.item : null;
        if (pick) { ans = c; choice = pick; break; }
      }
      if (!choice) {
        stats.missing++;
        mark(block, "#e53935", candidates.length ? "Không khớp được phương án: " + candidates[0].answer : "Không tìm thấy câu hỏi trong file đáp án");
        continue;
      }
      if (!choice.input.checked) choice.input.click();
      if (ans.verified && exact) {
        stats.done++;
        mark(block, "#43a047", "Đã chọn: " + ans.answer);
      } else {
        stats.unverified++;
        mark(block, "#fb8c00", (exact ? "Đáp án CHƯA xác minh (suy luận): " : "Câu hỏi khớp gần đúng, kiểm tra lại: ") + ans.answer);
      }
    }
    return stats;
  }

  // Floating badge: shows result and lets you re-run on each page of the form.
  const badge = document.createElement("button");
  badge.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border:0;border-radius:8px;" +
    "background:#1565c0;color:#fff;font:14px/1.3 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer";
  const run = () => {
    const s = fill();
    if (s.done + s.unverified + s.missing === 0) {
      badge.textContent = "Điền đáp án";
      return;
    }
    badge.textContent = `✔ ${s.done} xanh · ⚠ ${s.unverified} cam (chưa chắc) · ✖ ${s.missing} đỏ (tự làm)`;
  };
  badge.onclick = run;
  (document.body || document.documentElement).appendChild(badge);

  // Forms is a SPA: re-run when new questions render (next page, lazy load). Only unchecked inputs get clicked.
  let timer;
  new MutationObserver((muts) => {
    if (muts.every((m) => badge.contains(m.target))) return;
    clearTimeout(timer);
    timer = setTimeout(run, 600);
  }).observe(document.documentElement, { childList: true, subtree: true });
  run();
})();
