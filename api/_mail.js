/**
 * Sending one kind of message: the code that unlocks an account whose
 * passcode has been got wrong six times.
 *
 * Nothing else in the app sends email — Creem writes its own receipts and
 * renewal notices, and the stores write theirs — so this is deliberately
 * one function over one REST call rather than a mail library.
 *
 * With no provider configured it says so instead of pretending to send.
 * The caller then tells the player to write to the support address, which
 * is a real way out rather than a dead end, and is where the five published
 * documents already point.
 */

const key = () => process.env.RESEND_API_KEY || '';
const from = () => process.env.MAIL_FROM || '';

export const mailConfigured = () => Boolean(key() && from());

export async function sendMail({ to, subject, text }) {
  if (!mailConfigured()) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: from(), to: [to], subject, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
