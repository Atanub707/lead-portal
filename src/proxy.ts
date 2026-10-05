import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Clerk owns authentication now (sign-in, invitations, password resets).
// Everything except the auth screens and assets requires a session.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/billing/webhook",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (userId) return;

  const url = new URL(request.url);
  const status = url.searchParams.get("__clerk_status");
  const ticket = url.searchParams.get("__clerk_ticket");

  // Invitation / handshake links arrive as query params (Clerk appends
  // __clerk_status=sign_up&__clerk_ticket=… to the redirect URL). Forward them to
  // the matching Clerk page so <SignUp /> / <SignIn /> can consume the ticket.
  if (ticket || status === "sign_up" || status === "sign_in") {
    const target = new URL(status === "sign_in" ? "/sign-in" : "/sign-up", request.url);
    url.searchParams.forEach((value, key) => {
      if (key.startsWith("__clerk") || key === "redirect_url") {
        target.searchParams.set(key, value);
      }
    });
    return NextResponse.redirect(target);
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("redirect_url", request.url);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    // Everything except static assets, PWA files (manifest/service worker),
    // and images.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|webmanifest|woff2?)$).*)",
    "/__clerk/:path*",
  ],
};
