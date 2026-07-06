import { SignIn } from "@clerk/nextjs";

// Custom sign-in page (build item 10 polish). Replaces Clerk's stock hosted
// Account Portal with an embedded <SignIn /> themed to Coterie's design system
// (warm editorial / "quiet luxury"): cream canvas, gold eyebrow, Playfair
// headline, then Clerk's card restyled to a Coterie Card. Clerk still owns the
// actual auth — this only controls the surrounding page and the widget's skin.
//
// The catch-all segment ([[...sign-in]]) lets Clerk handle its multi-step
// sub-routes (factor-one, SSO callback, …) under /sign-in. To make Clerk redirect
// here (instead of the hosted portal), set NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
// (documented in .env.example). /sign-in is public — proxy.ts only guards
// /dashboard(.*).

// Design tokens mirrored from globals.css (@theme). Clerk's appearance API takes
// concrete values, so the palette is referenced by hex; the font is pulled from
// the CSS variable next/font sets on <html>.
const appearance = {
  variables: {
    colorPrimary: "#18170f", // ink — drives the solid primary button
    colorText: "#18170f", // ink
    colorTextSecondary: "#6a6659", // ink-2
    colorBackground: "#ffffff", // surface
    colorInputBackground: "#ffffff", // surface
    colorInputText: "#18170f", // ink
    colorDanger: "#8b2020", // red
    borderRadius: "6px", // --radius-sm
    fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-dm-sans), system-ui, sans-serif",
    fontSize: "13px",
  },
  elements: {
    // Blend Clerk's card into the Coterie Card look (hairline border, soft
    // shadow) and drop its own header so we don't duplicate the headline above.
    // header is hidden via an inline-style object (not a class) because Clerk's
    // base stylesheet outranks an appended `hidden` class.
    rootBox: "w-full",
    cardBox: "shadow-none",
    card: "border border-line bg-surface shadow-card rounded-md",
    header: { display: "none" },
    // Solid dark-ink primary CTA, matching the app's <Button variant="primary">.
    formButtonPrimary:
      "bg-ink text-white hover:bg-[#2a2920] normal-case font-medium shadow-none",
    formFieldLabel:
      "text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase",
    formFieldInput: "border-line-2 focus:border-gold-line",
    footerActionLink: "text-gold-ink hover:text-gold",
    socialButtonsBlockButton: "border-line-2 hover:bg-surface-2",
    dividerLine: "bg-line",
    dividerText: "text-ink-3",
    // Keep Clerk's required attribution but tone it down.
    logoBox: "hidden",
  },
} as const;

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-12">
      <div className="mb-6 text-center">
        <div className="text-[9.5px] font-medium tracking-[0.16em] text-gold uppercase">
          Coterie
        </div>
        <h1 className="mt-2 font-serif text-2xl text-ink">Welcome back</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Sign in to your network.
        </p>
      </div>
      <SignIn appearance={appearance} />
    </main>
  );
}
