// Prospect Finder "Draft Outreach" (Finder 14, prototype Coterie.html ~L15342).
// Assembles a copy-paste cold-outreach email from a discovered target plus the
// sender's identity — no AI call, no persistence — so an operator can grab a
// personalizable starting draft in one click. Pure and DB-free so the copy in
// the client component stays a thin clipboard write and the template is
// unit-tested without a browser.

import type { ProspectTarget } from "@/lib/prospect-finder";

export type OutreachSender = { userName: string; orgName: string };

// The first word of a contact's name for a warm greeting; "there" when the
// target has no named contact.
function greetingName(contact: string): string {
  const first = contact.trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

// A subject + multi-paragraph body drawn from the target's fit rationale
// (why / theyGet / theyBring / whyNow). Missing fields are simply skipped so a
// sparse result still yields a coherent note.
export function buildOutreachDraft(
  target: ProspectTarget,
  sender: OutreachSender,
): string {
  const paras: string[] = [`Hi ${greetingName(target.contact)},`];

  const why = target.why.trim();
  paras.push(
    why
      ? `I'm ${sender.userName} with ${sender.orgName}. ${why}`
      : `I'm ${sender.userName} with ${sender.orgName}, and I've been following the work at ${target.org}.`,
  );

  const exchange: string[] = [];
  const theyGet = target.theyGet.trim();
  const theyBring = target.theyBring.trim();
  if (theyGet) exchange.push(`On our side, ${theyGet}.`);
  if (theyBring) exchange.push(`In turn, ${theyBring}.`);
  if (exchange.length > 0) paras.push(exchange.join(" "));

  const whyNow = target.whyNow.trim();
  if (whyNow) paras.push(whyNow);

  paras.push("Would you be open to a short call in the next week or two?");
  paras.push(`Best,\n${sender.userName}\n${sender.orgName}`);

  const subject = `${sender.orgName} \u2014 connecting with ${target.org}`;
  return `Subject: ${subject}\n\n${paras.join("\n\n")}`;
}
