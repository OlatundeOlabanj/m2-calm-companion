/* "My read": a guess about how you are, built from the camera's expression reading and your body numbers.
   It is always offered as a guess for you to correct, never as a fact, and never as a diagnosis. Pure functions. */
(function (root) {
  const NEGATIVE = ['angry', 'contempt', 'disgust', 'fear', 'sad'];
  const LABEL = { angry: 'angry', contempt: 'dismissive', disgust: 'put off', fear: 'worried', sad: 'sad', happy: 'happy', surprise: 'surprised', neutral: 'neutral' };

  const usable = (e) => !!(e && e.stable && Number.isFinite(e.conf));

  // Small nudge (0 to 12 points) added to tension when the face reads clearly negative.
  function faceNudge(expr) {
    if (!usable(expr) || !NEGATIVE.includes(expr.type) || expr.conf < 55) return 0;
    return Math.min(12, ((expr.conf - 50) / 50) * 12 + 2);
  }

  // Returns { key, text, sub } or null. key changes only when the guess changes, so M² does not repeat itself.
  function readRoom({ tension, expr, talking, hasBase }) {
    if (!hasBase) return null;
    const neg = usable(expr) && NEGATIVE.includes(expr.type) && expr.conf >= 55;
    const t = tension || 0;
    if (neg && t >= 35) {
      return { key: 'neg-high-' + expr.type, text: 'My guess: you look ' + LABEL[expr.type] + ', and your breathing is above your calm.', sub: 'Am I close?' };
    }
    if (neg) {
      return { key: 'neg-low-' + expr.type, text: 'My camera reading leans ' + LABEL[expr.type] + ', though your body looks steady.', sub: 'Am I close?' };
    }
    if (t >= 45 && !talking) {
      return { key: 'high', text: 'Your body is running faster than your calm, though your face is hard to read.', sub: 'Am I close?' };
    }
    if (usable(expr) && expr.type === 'happy' && expr.conf >= 60 && t < 25) {
      return { key: 'happy', text: 'You look light right now.', sub: 'Good. Hold on to that.' };
    }
    return null;
  }

  const api = { faceNudge, readRoom, NEGATIVE, LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
