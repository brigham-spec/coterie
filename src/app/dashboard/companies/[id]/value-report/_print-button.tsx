"use client";

// The only interactive bit of the otherwise-static report: trigger the browser's
// print dialog, from which the user picks "Save as PDF" (to email or drop into a
// deck) or a physical printer. Hidden in the printed output itself (print:hidden).

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-ink px-4 py-2 text-xs font-medium tracking-[0.04em] text-white uppercase hover:bg-ink/90 print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
